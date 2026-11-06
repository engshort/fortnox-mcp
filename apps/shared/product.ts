import { Connections, CredentialVault, DomainError } from "@fortnox-mcp/core";
import { FortnoxConnections, FortnoxConsentError } from "@fortnox-mcp/fortnox";
import { z } from "zod";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { boundedJson, safeResponse } from "./admin.js";
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
      !env.FORTNOX_CLIENT_ID ||
      !env.FORTNOX_CLIENT_SECRET)
  )
    throw new Error(
      "Two distinct test tenants and private integration configuration required",
    );
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
  runtime: Pick<AuthConfig, "database" | "state">,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
) {
  const connections = new Connections(
    runtime.state,
    new CredentialVault(settings.keys, settings.activeKey),
  );
  const provider = new FortnoxConnections({
    origin: settings.origin,
    connections,
    fetch: fetcher,
    testTenants: settings.testTenants,
  });
  const config = {
    ...runtime,
    origin: settings.origin,
    secret: settings.secret,
    redirects: settings.redirects,
    connections,
  };
  const gateway = createProductGateway(config, (identity) =>
    companyServer({
      identity,
      connections,
      provider,
      testMode: settings.testMode,
    }),
  );
  async function fetchRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== settings.origin)
      return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
    if (url.pathname === "/health" && request.method === "GET")
      return safeResponse(
        JSON.stringify({
          ok: true,
          product: "experimental",
          provider: settings.testMode ? "test_only" : "disabled",
        }),
      );
    if (url.pathname === "/admin/connections.js" && request.method === "GET")
      return safeResponse(
        `const status=document.querySelector('#status');for(const form of document.querySelectorAll('form[data-action]'))form.addEventListener('submit',async e=>{e.preventDefault();const input=Object.fromEntries(new FormData(form));const r=await fetch(form.dataset.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const d=await r.json();if(r.ok&&d.url)location.assign(d.url);else if(r.ok)location.reload();else status.textContent='Åtgärden misslyckades: '+(d.error||'Okänt fel');});`,
        200,
        "text/javascript",
      );
    if (
      url.pathname === "/admin" ||
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
      if (request.method === "GET" && url.pathname === "/admin") {
        const companies = await connections.list(session.user.id);
        const rows = companies
          .map(
            (c) =>
              `<li><strong>${escapeHtml(c.name)}</strong> – ${escapeHtml(c.state)} (${escapeHtml(c.mode)})<form data-action="/admin/fortnox/disconnect"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><button>Koppla från</button></form>${c.state !== "active" ? `<form data-action="/admin/fortnox/start"><input type="hidden" name="company_id" value="${escapeHtml(c.id)}"><input type="hidden" name="mode" value="${c.mode}"><button>Återanslut</button></form>` : ""}</li>`,
          )
          .join("");
        return safeResponse(
          `<!doctype html><html lang="sv"><meta charset="utf-8"><title>Företagsanslutningar</title><h1>Företagsanslutningar</h1><p>Testinstallation. Bokföring och filer är avstängda. Nya eller återanslutna företag kräver nytt MCP-klientgodkännande.</p><ul>${rows}</ul><form data-action="/admin/fortnox/start"><label>Anslutningstyp <select name="mode"><option value="service">Servicekonto</option><option value="user">Användare</option></select></label><button ${settings.testMode ? "" : "disabled"}>Anslut testföretag</button></form><p id="status" role="status"></p><p>Fortnox callback: ${escapeHtml(settings.origin)}/admin/fortnox/callback</p><script src="/admin/connections.js"></script></html>`,
          200,
          "text/html; charset=utf-8",
        );
      }
      if (request.method === "POST") {
        if (request.headers.get("origin") !== settings.origin)
          return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
        try {
          const body = await boundedJson(request);
          if (url.pathname === "/admin/fortnox/disconnect") {
            const input = z
              .object({ company_id: z.string().uuid() })
              .strict()
              .parse(body);
            await connections.disconnect(session.user.id, input.company_id);
            return safeResponse('{"ok":true}');
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
                    clientId: settings.clientId,
                    clientSecret: settings.clientSecret,
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
  return { fetch: fetchRequest, connections, provider, auth: gateway.auth };
}
