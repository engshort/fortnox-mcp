import {
  Bookkeeping,
  type ClientFile,
  Connections,
  CredentialVault,
  DomainError,
  proposalReference,
  ReceiptAttachments,
  ReceiptFileError,
  type ReceiptFileStore,
  ReceiptFiles,
  Receipts,
  ReceiptWorkflow,
  voucherReference,
} from "@fortnox-mcp/core";
import {
  fileValidator,
  type ReceiptSourceSettings,
  receiptSourceSettings,
} from "@fortnox-mcp/files";
import {
  diagnoseConnection,
  diagnosisInput,
  FortnoxAccounting,
  FortnoxConnections,
  FortnoxConsentError,
  FortnoxReceiptFiles,
} from "@fortnox-mcp/fortnox";
import { z } from "zod";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { boundedJson, safeResponse } from "./admin.js";
import {
  IntegrationSettings,
  integrationInput,
} from "./integration-settings.js";
import { type AdminAssets, ownerWeb } from "./owner-web.js";
import { type AuthConfig, requireOwner } from "./product-auth.js";
import { createProductGateway } from "./product-gateway.js";

export interface ProductSettings {
  origin: string;
  secret: string;
  keys: Record<string, string>;
  activeKey: string;
  redirects: string[];
  testMode: boolean;
  clientId: string;
  clientSecret: string;
  testTenants: string[];
  accountingReferences?: boolean;
  receiptProviderConsent?: boolean;
  receiptSource?: ReceiptSourceSettings;
}
// Supplied only by the separately built M14 experiment entry, never read from
// normal product ENV. This permits client evidence collection, not activation.
export interface ProductFileTest {
  sourceCommit: string;
  until: number;
  now?: () => number;
}
export function requestedFortnoxScopes(
  settings: Pick<
    ProductSettings,
    "testMode" | "accountingReferences" | "receiptProviderConsent"
  >,
) {
  if (
    settings.receiptProviderConsent &&
    (!settings.testMode || !settings.accountingReferences)
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  return [
    "companyinformation",
    "profile",
    ...(settings.accountingReferences
      ? ["bookkeeping", "settings", "costcenter", "project"]
      : []),
    ...(settings.receiptProviderConsent ? ["inbox", "connectfile"] : []),
  ];
}
export function productSettings(
  env: Record<string, string | undefined>,
): ProductSettings {
  const origin = new URL(env.PUBLIC_ORIGIN ?? "");
  if (
    origin.href !== `${origin.origin}/` ||
    (origin.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
  )
    throw new Error("Invalid PUBLIC_ORIGIN");
  const secret = z.string().min(32).parse(env.AUTH_SECRET);
  const keys = z
    .record(z.string(), z.string())
    .parse(JSON.parse(env.CREDENTIAL_KEYS ?? "{}"));
  const activeKey = z.string().min(1).parse(env.CREDENTIAL_ACTIVE_KEY);
  if (!keys[activeKey] || atob(keys[activeKey]).length !== 32)
    throw new Error("Invalid encryption configuration");
  const redirects = z
    .array(z.url())
    .min(1)
    .max(4)
    .parse(JSON.parse(env.MCP_REDIRECT_URIS ?? "[]"));
  if (redirects.some((uri) => !uri.startsWith("https://")))
    throw new Error("HTTPS client redirects required");
  const testMode = env.FORTNOX_TEST_MODE === "true";
  const testTenants = (env.FORTNOX_TEST_TENANTS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (
    testMode &&
    (new Set(testTenants).size !== 2 ||
      testTenants.some((t) => !/^\d{1,15}$/.test(t)) ||
      !!env.FORTNOX_CLIENT_ID !== !!env.FORTNOX_CLIENT_SECRET)
  )
    throw new Error(
      "Two distinct test tenants and private integration configuration required",
    );
  const accountingReferences =
    testMode && env.ACCOUNTING_REFERENCES_ENABLED === "true";
  const receiptProviderConsent = env.FORTNOX_RECEIPT_CONSENT === "true";
  requestedFortnoxScopes({
    testMode,
    accountingReferences,
    receiptProviderConsent,
  });
  return {
    origin: origin.origin,
    secret,
    keys,
    activeKey,
    redirects,
    testMode,
    clientId: env.FORTNOX_CLIENT_ID ?? "",
    clientSecret: env.FORTNOX_CLIENT_SECRET ?? "",
    testTenants,
    accountingReferences,
    receiptProviderConsent,
    receiptSource: receiptSourceSettings(env, testMode),
  };
}
const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function connectionFailure(error: unknown, stage: string) {
  return safeResponse(
    JSON.stringify({
      error: "CONNECTION_REQUEST_FAILED",
      reason:
        error instanceof DomainError
          ? error.code
          : error instanceof z.ZodError
            ? "VALIDATION_FAILED"
            : "UPSTREAM_UNAVAILABLE",
      stage: error instanceof FortnoxConsentError ? error.stage : stage,
      ...(error instanceof FortnoxConsentError
        ? {
            provider_error: error.providerError,
            provider_status: error.providerStatus,
          }
        : {}),
    }),
    400,
  );
}
export function createProductApplication(
  settings: ProductSettings,
  runtime: Pick<AuthConfig, "database" | "state"> & {
    assets?: AdminAssets;
    receiptFiles?: ReceiptFileStore;
    fileSource?: (
      input: ClientFile,
    ) => Promise<{ bytes: Uint8Array; contentType: string | undefined }>;
  },
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  fileTest?: ProductFileTest,
) {
  const now = fileTest?.now ?? Date.now;
  if (
    fileTest &&
    (!settings.testMode ||
      new Set(settings.testTenants).size !== 2 ||
      settings.testTenants.length !== 2 ||
      !/^[a-f0-9]{40}$/.test(fileTest.sourceCommit) ||
      /^0+$/.test(fileTest.sourceCommit) ||
      !Number.isSafeInteger(fileTest.until) ||
      fileTest.until <= 0 ||
      fileTest.until > now() + 60 * 60_000 ||
      !runtime.receiptFiles ||
      !runtime.fileSource)
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  const fileTestActive = () => !!fileTest && now() < fileTest.until;
  const connections = new Connections(
    runtime.state,
    new CredentialVault(settings.keys, settings.activeKey),
  );
  const provider = new FortnoxConnections({
    origin: settings.origin,
    connections,
    fetch: fetcher,
    testTenants: settings.testTenants,
    scopes: requestedFortnoxScopes(settings),
  });
  const integration = new IntegrationSettings(
    runtime.state,
    connections.vault,
    settings,
  );
  const config = {
    ...runtime,
    origin: settings.origin,
    secret: settings.secret,
    redirects: settings.redirects,
    connections,
  };
  // G02/#32 and G06/G07 require current, operation-specific evidence. An ENV flag
  // must not be able to turn an unverified host or provider into an approved one.
  const accountingGates = {
    references: settings.accountingReferences === true && settings.testMode,
    writes: false,
    reviewHost: false,
  };
  const accountingProvider = new FortnoxAccounting(
    connections,
    provider,
    accountingGates,
  );
  const bookkeeping = new Bookkeeping(
    connections,
    accountingProvider,
    accountingGates,
  );
  const receiptFiles = runtime.receiptFiles
    ? new ReceiptFiles(
        connections,
        runtime.receiptFiles,
        async (input) => {
          if (fileTest && !fileTestActive())
            throw new ReceiptFileError("FILE_EXPIRED");
          if (!runtime.fileSource)
            throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
          const result = await runtime.fileSource(input);
          if (fileTest && !fileTestActive()) {
            result.bytes.fill(0);
            throw new ReceiptFileError("FILE_EXPIRED");
          }
          return result;
        },
        fileValidator,
        // G03/#33 and product file acceptance are not established by an ENV flag.
        !!fileTest,
      )
    : undefined;
  const receipts = receiptFiles
    ? new Receipts(bookkeeping, receiptFiles, false)
    : undefined;
  const receiptAttachments = receipts
    ? new ReceiptAttachments(
        receipts,
        new FortnoxReceiptFiles(connections, provider, accountingProvider, {
          upload: false,
          link: false,
          connectionRead: false,
          inboxRead: false,
          formats: [],
          rejectedWithoutEffect: { inbox_upload: [], voucher_file_link: [] },
        }),
        { upload: false, link: false, retrieve: false },
      )
    : undefined;
  const receiptWorkflow = receiptAttachments
    ? new ReceiptWorkflow(receiptAttachments, false)
    : undefined;
  const gateway = createProductGateway(config, (identity) =>
    companyServer({
      identity,
      connections,
      provider,
      testMode: settings.testMode,
      diagnostics: !fileTest,
      ...(!fileTest ? { bookkeeping } : {}),
      ...(receiptFiles ? { receiptFiles } : {}),
      ...(receipts ? { receipts } : {}),
      ...(receiptAttachments ? { receiptAttachments } : {}),
      ...(receiptWorkflow ? { receiptWorkflow } : {}),
    }),
  );
  async function fetchRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== settings.origin)
      return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
    if (url.pathname === "/mcp" && fileTest && !fileTestActive())
      return safeResponse('{"error":"FILE_TEST_EXPIRED"}', 503);
    if (url.pathname === "/health" && request.method === "GET")
      return safeResponse(
        JSON.stringify({
          ok: true,
          product: "experimental",
          provider: settings.testMode ? "test_only" : "disabled",
          ...(fileTest
            ? {
                file_test: {
                  kind: "m14-staging-readback",
                  source_commit: fileTest.sourceCommit,
                  expires_at: new Date(fileTest.until).toISOString(),
                  active: fileTestActive(),
                  financial_writes: false,
                  provider_file_writes: false,
                  review_host_verified: false,
                },
              }
            : {}),
        }),
      );
    if (url.pathname === "/admin/connections.js" && request.method === "GET")
      return safeResponse(
        `const status=document.querySelector('#status');for(const form of document.querySelectorAll('form[data-action]'))form.addEventListener('submit',async e=>{e.preventDefault();let input=Object.fromEntries(new FormData(form));if(form.dataset.action.endsWith('/policy')){input.policy_version=Number(input.policy_version);input.read_only=input.read_only==='true';}if(form.dataset.action.endsWith('/attest-reference')){input={proposal:{company_id:input.company_id,proposal_id:input.proposal_id,proposal_hash:input.proposal_hash},reference:{financial_year:Number(input.financial_year),series:input.series,number:Number(input.number)}};}const r=await fetch(form.dataset.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const d=await r.json();if(r.ok&&d.url)location.assign(d.url);else if(r.ok)location.reload();else status.textContent='Åtgärden misslyckades: '+(d.error||'Okänt fel');});`,
        200,
        "text/javascript",
      );
    if (
      url.pathname === "/admin" ||
      url.pathname === "/admin/state" ||
      url.pathname.startsWith("/admin/fortnox/")
    ) {
      let session: Awaited<ReturnType<typeof requireOwner>>;
      try {
        session = await requireOwner(
          gateway.auth,
          runtime.state,
          request.headers,
        );
      } catch {
        return safeResponse('{"error":"AUTH_REQUIRED"}', 401);
      }
      if (request.method === "GET" && url.pathname === "/admin/state") {
        const companies = await connections.list(session.user.id);
        return safeResponse(
          JSON.stringify({
            owner: { email: session.user.email },
            integration: await integration.status(session.user.id),
            callback: `${settings.origin}/admin/fortnox/callback`,
            mcp_url: `${settings.origin}/mcp`,
            test_mode: settings.testMode,
            capabilities: {
              writes: false,
              provider_files: false,
              review_host: false,
              files: fileTestActive(),
            },
            companies: companies.map((c) => ({
              company_id: c.id,
              name: c.name,
              state: c.state,
              mode: c.mode,
              review: c.review,
              read_only: c.readOnly,
              policy_version: c.policyVersion,
            })),
            investigations: companies.flatMap((c) =>
              (c.bookkeeping?.executions ?? [])
                .filter(
                  (e) =>
                    ["submitting", "outcome_unknown"].includes(e.state) &&
                    e.generation === c.generation,
                )
                .map((e) => ({
                  company_id: c.id,
                  proposal_id: e.id,
                  proposal_hash: e.hash,
                })),
            ),
          }),
        );
      }
      if (request.method === "GET" && url.pathname === "/admin") {
        const companies = await connections.list(session.user.id);
        const investigations = companies
          .flatMap((c) =>
            (c.bookkeeping?.executions ?? [])
              .filter(
                (e) =>
                  ["submitting", "outcome_unknown"].includes(e.state) &&
                  e.generation === c.generation,
              )
              .map(
                (e) =>
                  `<section><h3>${escapeHtml(c.name)}</h3><p>Okänt utfall: ${escapeHtml(e.id)}. Kontrollera den faktiska verifikationen i Fortnox. Datum och belopp räcker inte som identitetsbevis.</p><form data-action="/admin/fortnox/attest-reference"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><input type="hidden" name="proposal_id" value="${escapeHtml(e.id)}"><input type="hidden" name="proposal_hash" value="${escapeHtml(e.hash)}"><label>Fortnox räkenskapsårs-ID <input type="number" min="1" name="financial_year" required></label><label>Verifierad serie <input name="series" pattern="[A-Z0-9]{1,8}" required></label><label>Verifierat verifikationsnummer <input type="number" min="1" name="number" required></label><button>Registrera kontrollerad referens för avstämning</button></form><p>Referensen skickar ingen ny bokföring. Kör avstämning; endast exakt matchning löser utfallet.</p></section>`,
              ),
          )
          .join("");
        const rows = companies
          .map(
            (c) =>
              `<li><strong>${escapeHtml(c.name)}</strong> – ${escapeHtml(c.state)} (${escapeHtml(c.mode)})<form data-action="/admin/fortnox/disconnect"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><button>Koppla från</button></form>${c.state !== "active" ? `<form data-action="/admin/fortnox/start"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><input type="hidden" name="mode" value="${c.mode}"><button>Återanslut</button></form>` : `<form data-action="/admin/fortnox/policy"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><input type="hidden" name="policy_version" value="${c.policyVersion}"><label>Manuella verifikationer <select name="review"><option value="review_required" ${c.review === "review_required" ? "selected" : ""}>Mänsklig granskning krävs</option><option value="client_managed" ${c.review === "client_managed" ? "selected" : ""}>Klientens godkännanden</option></select></label><label>Åtkomst <select name="read_only"><option value="true" ${c.readOnly ? "selected" : ""}>Skrivskyddad</option><option value="false" ${!c.readOnly ? "selected" : ""}>Tillåt verifierade skrivoperationer</option></select></label><button>Spara policy och ogiltigförklara gamla förslag</button></form>`}<p>Policyversion ${c.policyVersion}. Ändring aktiverar ingen overifierad operation.</p></li>`,
          )
          .join("");
        return safeResponse(
          `<!doctype html><html lang="sv"><meta charset="utf-8"><title>Företagsanslutningar</title><h1>Företagsanslutningar</h1><p>${fileTest ? `M14-filprov till ${escapeHtml(new Date(fileTest.until).toISOString())}. Endast tillfällig filstaging och originalhämtning kan provas. Bokföring, Fortnox-filer och granskningskörning är avstängda.` : "Testinstallation. Bokföring och filer är avstängda."} Nya eller återanslutna företag kräver nytt MCP-klientgodkännande.</p><ul>${rows}</ul><form data-action="/admin/fortnox/start"><label>Anslutningstyp <select name="mode"><option value="service">Servicekonto</option><option value="user">Användare</option></select></label><button ${settings.testMode ? "" : "disabled"}>Anslut testföretag</button></form>${investigations ? `<h2>Utred okända utfall</h2>${investigations}` : ""}<p id="status" role="status"></p><p>Fortnox callback: ${escapeHtml(settings.origin)}/admin/fortnox/callback</p><script src="/admin/connections.js"></script></html>`,
          200,
          "text/html; charset=utf-8",
        );
      }
      if (request.method === "POST") {
        if (request.headers.get("origin") !== settings.origin)
          return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
        try {
          const body = await boundedJson(request);
          if (url.pathname === "/admin/fortnox/configuration") {
            await integration.save(
              session.user.id,
              integrationInput.parse(body),
            );
            return safeResponse('{"ok":true}');
          }
          if (url.pathname === "/admin/fortnox/disconnect") {
            const input = z
              .object({ company_id: z.string().uuid() })
              .strict()
              .parse(body);
            await connections.disconnect(session.user.id, input.company_id);
            return safeResponse('{"ok":true}');
          }
          if (url.pathname === "/admin/fortnox/policy") {
            const input = z
              .object({
                company_id: z.string().uuid(),
                policy_version: z.number().int().positive().safe(),
                review: z.enum(["review_required", "client_managed"]),
                read_only: z.boolean(),
              })
              .strict()
              .parse(body);
            await connections.setAccountingPolicy(
              session.user.id,
              input.company_id,
              input.policy_version,
              input.review,
              input.read_only,
            );
            return safeResponse('{"ok":true}');
          }
          if (url.pathname === "/admin/fortnox/attest-reference") {
            const input = z
              .object({
                proposal: proposalReference,
                reference: voucherReference,
              })
              .strict()
              .parse(body);
            await bookkeeping.attestReference(
              session.user.id,
              input.proposal,
              input.reference,
            );
            return safeResponse('{"ok":true}');
          }
          if (url.pathname === "/admin/fortnox/diagnose") {
            const input = diagnosisInput.parse(body);
            return safeResponse(
              JSON.stringify(
                await diagnoseConnection(
                  {
                    owner: session.user.id,
                    connections,
                    provider,
                    testMode: settings.testMode,
                    authorize: async (id) => {
                      const company = (
                        await connections.list(session.user.id)
                      ).find((c) => c.id === id);
                      if (!company) throw new DomainError("COMPANY_FORBIDDEN");
                      return company;
                    },
                  },
                  input.company_id,
                ),
              ),
            );
          }
          if (url.pathname === "/admin/fortnox/start") {
            if (!settings.testMode)
              return safeResponse('{"error":"CAPABILITY_UNAVAILABLE"}', 403);
            const input = z
              .object({
                mode: z.enum(["service", "user"]),
                company_id: z.string().uuid().optional(),
              })
              .strict()
              .parse(body);
            return safeResponse(
              JSON.stringify({
                url: await provider.start(
                  session.user.id,
                  session.session.id,
                  {
                    mode: input.mode,
                    ...((await integration.credentials(session.user.id)) ?? {
                      clientId: "",
                      clientSecret: "",
                    }),
                  },
                  input.company_id,
                ),
              }),
            );
          }
        } catch (error) {
          return connectionFailure(error, "consent_start");
        }
      }
      if (
        request.method === "GET" &&
        url.pathname === "/admin/fortnox/callback"
      ) {
        if (!settings.testMode)
          return safeResponse('{"error":"CAPABILITY_UNAVAILABLE"}', 403);
        try {
          await provider.finish(session.user.id, session.session.id, url);
          return new Response(null, {
            status: 303,
            headers: {
              location: `${settings.origin}/admin`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          });
        } catch (error) {
          return connectionFailure(error, "flow_validation");
        }
      }
      return safeResponse('{"error":"NOT_FOUND"}', 404);
    }
    try {
      return await gateway.fetch(request);
    } catch {
      return safeResponse('{"error":"REQUEST_FAILED"}', 503);
    }
  }
  const web = ownerWeb(
    async (request) => {
      if (new URL(request.url).origin !== settings.origin)
        return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
      return fetchRequest(request);
    },
    (request) => requireOwner(gateway.auth, runtime.state, request.headers),
    runtime.assets,
  );
  return {
    fetch: async (request: Request) => {
      if (
        new URL(request.url).origin !== settings.origin ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !== settings.origin)
      )
        return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
      const response = await web.fetch(request);
      if (
        fileTest &&
        new URL(request.url).pathname === "/mcp" &&
        !fileTestActive()
      ) {
        await response.body?.cancel();
        return safeResponse('{"error":"FILE_TEST_EXPIRED"}', 503);
      }
      return response;
    },
    connections,
    provider,
    bookkeeping,
    auth: gateway.auth,
    receiptFiles,
    receipts,
    receiptAttachments,
    receiptWorkflow,
  };
}
