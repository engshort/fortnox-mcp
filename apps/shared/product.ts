import {
  Bookkeeping,
  baseScopes,
  type ClientFile,
  type CompanyGrant,
  Connections,
  CredentialVault,
  DomainError,
  FinancialAnalysis,
  LiquidityAnalysis,
  OpenItems,
  PayrollInputs,
  type PayrollOperation,
  payrollOperationIds,
  previewProgram,
  programChange,
  programStatus,
  proposalReference,
  ReceiptAttachments,
  ReceiptFileError,
  type ReceiptFileStore,
  ReceiptFiles,
  Receipts,
  ReceiptWorkflow,
  type RegisterOperation,
  type RegisterResource,
  Registers,
  registerOperationIds,
  registerScope,
  SalesDocuments,
  salesOperationIds,
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
  type FinancialMapping,
  type FinancialReadOperation,
  FortnoxAccounting,
  FortnoxConnections,
  FortnoxConsentError,
  FortnoxFinancialReads,
  FortnoxOpenItems,
  FortnoxPayrollReads,
  FortnoxPayrollWrites,
  FortnoxReceiptFiles,
  FortnoxRegisters,
  FortnoxSalesDocuments,
  financialReadOperations,
  type OpenItemReadOperation,
  openItemReadOperations,
  type PayrollWriteProfile,
  payrollReadOperationIds,
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
// A separately built, one-hour test entry supplies this profile. Ordinary ENV
// cannot enable unverified register writes or broaden provider consent.
export interface ProductBusinessTest {
  sourceCommit: string;
  until: number;
  operations: readonly RegisterOperation[];
  documentReads?: readonly string[];
  consentScopes?: readonly string[];
  payrollReads?: readonly PayrollOperation[];
  payrollWrites?: {
    operations: readonly PayrollOperation[];
    profiles: readonly PayrollWriteProfile[];
  };
  financialReads?: readonly FinancialReadOperation[];
  financialMappings?: readonly {
    company_id: string;
    financial_year: number;
    mapping: FinancialMapping;
    cash_account_numbers: readonly number[];
  }[];
  openItemReads?: readonly OpenItemReadOperation[];
  now?: () => number;
}
export function requestedFortnoxScopes(
  settings: Pick<
    ProductSettings,
    "testMode" | "accountingReferences" | "receiptProviderConsent"
  >,
) {
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
  const accountingReferences = true;
  const receiptProviderConsent = true;
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
  businessTest?: ProductBusinessTest,
) {
  const now = fileTest?.now ?? businessTest?.now ?? Date.now;
  // All finite implemented operations are available in the ordinary product.
  // Separate acceptance entries retain their explicit operation selections.
  const profile = businessTest ?? {
    operations: registerOperationIds,
    documentReads: salesOperationIds,
    payrollReads: payrollReadOperationIds,
    payrollWrites: {
      operations: payrollOperationIds.filter((id) =>
        /\.(create|update|delete)$/.test(id),
      ),
      profiles: [],
    },
    financialReads: financialReadOperations,
    openItemReads: openItemReadOperations,
  };
  const profileActive = () => !businessTest || now() < businessTest.until;
  const financialReads = profile.financialReads ?? [];
  const openItemReads = profile.openItemReads ?? [];
  if (
    new Set(openItemReads).size !== openItemReads.length ||
    openItemReads.some((id) => !openItemReadOperations.includes(id))
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  if (
    new Set(financialReads).size !== financialReads.length ||
    financialReads.some((id) => !financialReadOperations.includes(id))
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  const payrollReads = profile.payrollReads ?? [];
  if (
    payrollReads.length > 4 ||
    new Set(payrollReads).size !== payrollReads.length ||
    payrollReads.some(
      (id) => !(payrollReadOperationIds as readonly string[]).includes(id),
    )
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  const documentReads = profile.documentReads ?? [];
  const payrollWriteOperations = profile.payrollWrites?.operations ?? [];
  if (
    new Set(payrollWriteOperations).size !== payrollWriteOperations.length ||
    payrollWriteOperations.some(
      (op) =>
        ![
          "salary_transaction.create",
          "salary_transaction.update",
          "salary_transaction.delete",
        ].includes(op),
    ) ||
    (businessTest?.payrollWrites &&
      (payrollWriteOperations.length === 0 ||
        businessTest.payrollWrites.profiles.length === 0 ||
        !payrollReads.includes("payroll_employee.get") ||
        !payrollReads.includes("salary_transaction.get")))
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  const payrollOperations = [...payrollReads, ...payrollWriteOperations];
  if (
    businessTest &&
    (fileTest ||
      !settings.testMode ||
      settings.testTenants.length !== 2 ||
      new Set(settings.testTenants).size !== 2 ||
      !/^[a-f0-9]{40}$/.test(businessTest.sourceCommit) ||
      /^0+$/.test(businessTest.sourceCommit) ||
      !Number.isSafeInteger(businessTest.until) ||
      businessTest.until <= now() ||
      businessTest.until > now() + 3600000 ||
      businessTest.operations.some((id) => !registerOperationIds.includes(id)))
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  if (
    businessTest &&
    (documentReads.length > 6 ||
      new Set(documentReads).size !== documentReads.length ||
      documentReads.some(
        (id) =>
          ![
            "offer.list",
            "offer.get",
            "order.list",
            "order.get",
            "invoice.list",
            "invoice.get",
          ].includes(id),
      ))
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  if (
    businessTest?.consentScopes?.some(
      (scope) =>
        ![
          "offer",
          "order",
          "invoice",
          "supplierinvoice",
          "payment",
          "connectfile",
          "inbox",
          "salary",
        ].includes(scope),
    )
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
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
  const programGates = () => ({
    payrollConsent:
      !businessTest ||
      (now() < businessTest.until &&
        businessTest.consentScopes?.includes("salary") === true),
    references: true,
    receiptConsent: true,
    registerScopes: profileActive()
      ? [
          ...new Set(
            profile.operations.map((id) =>
              registerScope(id.split(".")[0] as RegisterResource),
            ),
          ),
        ]
      : [],
  });
  const provider = new FortnoxConnections({
    origin: settings.origin,
    connections,
    fetch: fetcher,
    ...(businessTest || fileTest ? { testTenants: settings.testTenants } : {}),
    scopes: baseScopes,
    programGates,
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
  // Owner-authorized activation is separate from acceptance evidence. Review
  // still requires the UI-only capability in a conforming MCP Apps host.
  const accountingGates = {
    references: true,
    writes: !fileTest && !businessTest,
    reviewHost: !fileTest && !businessTest,
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
  const registers = !fileTest
    ? new Registers(
        connections,
        new FortnoxRegisters(
          connections,
          provider,
          profile.operations,
          now,
          profileActive,
        ),
        profile.operations,
      )
    : undefined;
  const financialProvider =
    !fileTest && financialReads.length
      ? new FortnoxFinancialReads(
          connections,
          provider,
          financialReads,
          profileActive,
          now,
          (company, year) =>
            businessTest?.financialMappings?.find(
              (m) => m.company_id === company && m.financial_year === year,
            )?.mapping,
        )
      : undefined;
  const financial = financialProvider
    ? {
        provider: financialProvider,
        service: new FinancialAnalysis(connections, financialProvider, true),
      }
    : undefined;
  const openItems =
    !fileTest && openItemReads.length
      ? new OpenItems(
          connections,
          new FortnoxOpenItems(
            connections,
            provider,
            openItemReads,
            profileActive,
            now,
          ),
          (["receivable", "payable"] as const).filter((kind) =>
            openItemReads.includes(
              kind === "receivable"
                ? "open_receivable.list"
                : "open_payable.list",
            ),
          ),
          now,
        )
      : undefined;
  const liquidity =
    financial &&
    openItems &&
    openItems.enabled.length === 2 &&
    (["financial.accounts", "financial.year", "financial.sie4"] as const).every(
      (op) => financialReads.includes(op),
    )
      ? new LiquidityAnalysis(
          connections,
          financial.service,
          openItems,
          true,
          now,
          (company, year) => {
            const profile = businessTest?.financialMappings?.find(
              (m) => m.company_id === company && m.financial_year === year,
            );
            return profile
              ? {
                  account_numbers: profile.cash_account_numbers,
                  version: profile.mapping.version,
                  sha256: profile.mapping.sha256,
                }
              : undefined;
          },
        )
      : undefined;
  const payroll =
    !fileTest && payrollReads.length
      ? new PayrollInputs(
          connections,
          profile.payrollWrites
            ? new FortnoxPayrollWrites(
                connections,
                provider,
                profile.payrollWrites.profiles,
                payrollOperations,
                profileActive,
                now,
                !businessTest,
              )
            : new FortnoxPayrollReads(
                connections,
                provider,
                payrollReads,
                profileActive,
                now,
              ),
          payrollOperations,
          now,
        )
      : undefined;
  const salesDocuments =
    documentReads.length && registers
      ? new SalesDocuments(
          connections,
          new FortnoxSalesDocuments(
            connections,
            provider,
            documentReads,
            profileActive,
            now,
          ),
          registers,
          accountingProvider,
          documentReads,
          null,
          now,
        )
      : undefined;
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
        !businessTest,
      )
    : undefined;
  const receipts = receiptFiles
    ? new Receipts(bookkeeping, receiptFiles, !fileTest && !businessTest)
    : undefined;
  const receiptAttachments = receipts
    ? new ReceiptAttachments(
        receipts,
        new FortnoxReceiptFiles(connections, provider, accountingProvider, {
          upload: !fileTest && !businessTest,
          link: !fileTest && !businessTest,
          connectionRead: !fileTest && !businessTest,
          inboxRead: !fileTest && !businessTest,
          formats: ["application/pdf", "image/png", "image/jpeg"],
          rejectedWithoutEffect: { inbox_upload: [], voucher_file_link: [] },
        }),
        {
          upload: !fileTest && !businessTest,
          link: !fileTest && !businessTest,
          retrieve: !fileTest && !businessTest,
        },
      )
    : undefined;
  const receiptWorkflow = receiptAttachments
    ? new ReceiptWorkflow(receiptAttachments, !fileTest && !businessTest)
    : undefined;
  const gateway = createProductGateway(config, (identity) =>
    companyServer({
      identity,
      connections,
      provider,
      testMode: true,
      diagnostics: !fileTest,
      ...(!fileTest ? { bookkeeping } : {}),
      ...(registers ? { registers } : {}),
      ...(payroll ? { payroll } : {}),
      ...(openItems ? { openItems } : {}),
      ...(liquidity ? { liquidity } : {}),
      ...(financial ? { financial } : {}),
      ...(salesDocuments ? { salesDocuments } : {}),
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
    if (url.pathname === "/mcp" && businessTest && now() >= businessTest.until)
      return safeResponse('{"error":"BUSINESS_TEST_EXPIRED"}', 503);
    if (url.pathname === "/health" && request.method === "GET")
      return safeResponse(
        JSON.stringify({
          ok: true,
          product: "experimental",
          provider: businessTest || fileTest ? "test_only" : "enabled",
          ...(businessTest
            ? {
                register_test: {
                  source_commit: businessTest.sourceCommit,
                  expires_at: new Date(businessTest.until).toISOString(),
                  active: now() < businessTest.until,
                  operations: businessTest.operations,
                  document_operations: businessTest.documentReads ?? [],
                  payroll_operations: payrollOperations,
                  financial_read_operations: financialReads,
                  open_item_read_operations: openItemReads,
                  financial_writes: false,
                },
              }
            : {}),
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
      url.pathname === "/admin/clients" ||
      url.pathname.startsWith("/admin/companies/") ||
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
      if (url.pathname === "/admin/clients" && request.method === "GET") {
        const rows = await runtime.state.list<CompanyGrant>(
          "company-grants",
          101,
        );
        const companies = await connections.list(session.user.id);
        return safeResponse(
          JSON.stringify({
            clients: rows
              .slice(0, 100)
              .filter(
                (r) =>
                  r.value.ownerId === session.user.id &&
                  !r.id.startsWith("owner-recovery:"),
              )
              .map((r) => ({
                client_id: r.id,
                companies: Object.entries(r.value.companies).map(
                  ([id, generation]) => ({
                    company_id: id,
                    name: companies.find((c) => c.id === id)?.name ?? id,
                    current: companies.some(
                      (c) =>
                        c.id === id &&
                        c.generation === generation &&
                        c.state === "active",
                    ),
                  }),
                ),
              })),
            partial: rows.length > 100,
          }),
        );
      }
      const businessReconcile =
        /^\/admin\/companies\/([^/]+)\/business\/([^/]+)\/reconcile$/.exec(
          url.pathname,
        );
      if (businessReconcile) {
        if (request.method !== "POST")
          return safeResponse('{"error":"METHOD_NOT_ALLOWED"}', 405);
        if (request.headers.get("origin") !== settings.origin)
          return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
        try {
          z.object({})
            .strict()
            .parse(await boundedJson(request));
          if (!profileActive()) throw new DomainError("CAPABILITY_UNAVAILABLE");
          const companyId = z.string().uuid().parse(businessReconcile[1]);
          const executionId = z.string().uuid().parse(businessReconcile[2]);
          const company = (await connections.list(session.user.id)).find(
            (c) => c.id === companyId,
          );
          if (!company) throw new DomainError("COMPANY_FORBIDDEN");
          const execution = company.business?.executions.find(
            (e) => e.id === executionId,
          );
          const service =
            execution &&
            [registers?.writes, salesDocuments?.writes, payroll?.writes].find(
              (s) => s?.operations[execution.operation],
            );
          if (!service) throw new DomainError("CAPABILITY_UNAVAILABLE");
          const result = await service.reconcileOwner(
            session.user.id,
            companyId,
            executionId,
          );
          return safeResponse(JSON.stringify(result));
        } catch (error) {
          return connectionFailure(error, "owner_reconciliation");
        }
      }
      const programRoute =
        /^\/admin\/companies\/([^/]+)\/programs(?:\/(preview|start|disable))?$/.exec(
          url.pathname,
        );
      if (programRoute) {
        try {
          const companyId = z.string().uuid().parse(programRoute[1]);
          const company = (await connections.list(session.user.id)).find(
            (c) => c.id === companyId,
          );
          if (!company) throw new DomainError("COMPANY_FORBIDDEN");
          const gates = programGates();
          if (!programRoute[2] && request.method === "GET")
            return safeResponse(
              JSON.stringify({
                ...programStatus(company, gates),
                pending: (await provider.pending(session.user.id)).includes(
                  companyId,
                ),
              }),
            );
          if (request.method !== "POST" || !programRoute[2])
            return safeResponse('{"error":"NOT_FOUND"}', 404);
          if (request.headers.get("origin") !== settings.origin)
            return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
          const body = await boundedJson(request);
          if (programRoute[2] === "disable") {
            const input = programChange.omit({ features: true }).parse(body);
            await connections.disableProgram(
              session.user.id,
              companyId,
              input.program,
              input.expected_revision,
            );
            return safeResponse('{"ok":true}');
          }
          const input = programChange.parse(body);
          const preview = previewProgram(company, input, gates);
          if (programRoute[2] === "preview")
            return safeResponse(JSON.stringify(preview));
          const credentials = await connections.credentials(
            session.user.id,
            company,
          );
          return safeResponse(
            JSON.stringify({
              url: await provider.start(
                session.user.id,
                session.session.id,
                {
                  mode: company.mode,
                  clientId: credentials.clientId,
                  clientSecret: credentials.clientSecret,
                },
                companyId,
                input,
              ),
            }),
          );
        } catch (error) {
          return connectionFailure(error, "program_connection");
        }
      }
      if (request.method === "GET" && url.pathname === "/admin/state") {
        const companies = await connections.list(session.user.id);
        const pending = await provider.pending(session.user.id);
        return safeResponse(
          JSON.stringify({
            owner: { email: session.user.email },
            integration: await integration.status(session.user.id, connections),
            callback: `${settings.origin}/admin/fortnox/callback`,
            mcp_url: `${settings.origin}/mcp`,
            test_mode: !!businessTest || !!fileTest,
            restore:
              (await runtime.state.get("installation", "restore"))?.value ??
              null,
            capabilities: {
              business_reconciliation: !!registers && profileActive(),
              writes: accountingGates.writes,
              provider_files: receiptAttachments?.gates.upload === true,
              review_host: accountingGates.reviewHost,
              files:
                receiptFiles?.enabled === true &&
                (!fileTest || fileTestActive()),
            },
            companies: companies.map((c) => ({
              company_id: c.id,
              name: c.name,
              state: c.state,
              mode: c.mode,
              review: c.review,
              read_only: c.readOnly,
              policy_version: c.policyVersion,
              organization_number: c.organizationNumber,
              programs: {
                ...programStatus(c, programGates()),
                pending: pending.includes(c.id),
              },
            })),
            uncertain_outcomes: companies.flatMap((c) => [
              ...(c.bookkeeping?.executions ?? [])
                .filter((e) =>
                  ["submitting", "outcome_unknown"].includes(e.state),
                )
                .map((e) => ({
                  company_id: c.id,
                  company_name: c.name,
                  kind: "bookkeeping",
                  id: e.id,
                })),
              ...(c.business?.executions ?? [])
                .filter((e) =>
                  ["submitting", "outcome_unknown"].includes(e.state),
                )
                .map((e) => ({
                  company_id: c.id,
                  company_name: c.name,
                  kind: "business",
                  id: e.id,
                })),
              ...(c.receiptBatches ?? []).flatMap((b) =>
                b.items
                  .filter((item) =>
                    Object.values(item.steps).some((step) =>
                      ["submitting", "outcome_unknown"].includes(step.state),
                    ),
                  )
                  .map((item) => ({
                    company_id: c.id,
                    company_name: c.name,
                    kind: "receipt",
                    id: item.id,
                  })),
              ),
            ]),
            observed_differences: companies.flatMap((c) =>
              (c.business?.executions ?? [])
                .filter(
                  (e) =>
                    e.state === "applied_different" &&
                    e.difference &&
                    e.reference,
                )
                .map((e) => ({
                  company_id: c.id,
                  company_name: c.name,
                  id: e.id,
                  operation: e.operation,
                  reference: e.reference,
                  difference: e.difference,
                })),
            ),
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
              `<li><strong>${escapeHtml(c.name)}</strong> – ${escapeHtml(c.state)} (${escapeHtml(c.mode)})<form data-action="/admin/fortnox/disconnect"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><button>Koppla från</button></form>${c.state !== "active" ? `<form data-action="/admin/fortnox/start"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><input type="hidden" name="mode" value="${c.mode}"><button>Återanslut</button></form>` : `<form data-action="/admin/fortnox/policy"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><input type="hidden" name="policy_version" value="${c.policyVersion}"><label>Manuella verifikationer <select name="review"><option value="review_required" ${c.review === "review_required" ? "selected" : ""}>Mänsklig granskning krävs</option><option value="client_managed" ${c.review === "client_managed" ? "selected" : ""}>Klientens godkännanden</option></select></label><label>Åtkomst <select name="read_only"><option value="true" ${c.readOnly ? "selected" : ""}>Skrivskyddad</option><option value="false" ${!c.readOnly ? "selected" : ""}>Tillåt skrivoperationer</option></select></label><button>Spara policy och ogiltigförklara gamla förslag</button></form>`}<p>Policyversion ${c.policyVersion}. Nya skrivningar följer den sparade policyn.</p></li>`,
          )
          .join("");
        return safeResponse(
          `<!doctype html><html lang="sv"><meta charset="utf-8"><title>Företagsanslutningar</title><h1>Företagsanslutningar</h1><p>${fileTest ? `M14-filprov till ${escapeHtml(new Date(fileTest.until).toISOString())}. Endast tillfällig filstaging och originalhämtning kan provas. Bokföring, Fortnox-filer och granskningskörning är avstängda.` : "Funktioner använder företagets Fortnox-behörigheter och sparade policy."} Nya eller återanslutna företag kräver nytt MCP-klientgodkännande.</p><ul>${rows}</ul><form data-action="/admin/fortnox/start"><label>Anslutningstyp <select name="mode"><option value="service">Servicekonto</option><option value="user">Användare</option></select></label><button>Anslut företag</button></form>${investigations ? `<h2>Utred okända utfall</h2>${investigations}` : ""}<p id="status" role="status"></p><p>Fortnox callback: ${escapeHtml(settings.origin)}/admin/fortnox/callback</p><script src="/admin/connections.js"></script></html>`,
          200,
          "text/html; charset=utf-8",
        );
      }
      if (request.method === "POST") {
        if (request.headers.get("origin") !== settings.origin)
          return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
        try {
          const body = await boundedJson(request);
          if (url.pathname === "/admin/fortnox/forget-configuration") {
            const input = z
              .object({ revision: z.number().int().positive().safe() })
              .strict()
              .parse(body);
            await integration.forget(session.user.id, input.revision);
            await provider.cancelPending(session.user.id, null);
            return safeResponse('{"ok":true}');
          }
          if (url.pathname === "/admin/fortnox/cancel-consent") {
            z.object({}).strict().parse(body);
            await provider.cancelPending(session.user.id, session.session.id);
            return safeResponse('{"ok":true}');
          }
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
                    testMode: true,
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
        try {
          const company = await provider.finish(
            session.user.id,
            session.session.id,
            url,
          );
          return new Response(null, {
            status: 303,
            headers: {
              location: `${settings.origin}/admin/companies/${company.id}`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          });
        } catch (error) {
          if (request.headers.get("accept")?.includes("text/html"))
            return new Response(null, {
              status: 303,
              headers: {
                location: `${settings.origin}/admin/companies?connection_error=failed`,
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
              },
            });
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
