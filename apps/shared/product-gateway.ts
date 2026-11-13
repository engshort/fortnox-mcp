import {
  oauthProviderAuthServerMetadata,
  verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import {
  type Connections,
  featureLabels,
  programSelection,
} from "@fortnox-mcp/core";
import {
  createMcpHandler,
  isLegacyRequest,
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  boundedJson,
  createAdmin,
  privateHeaders,
  safeResponse,
} from "./admin.js";
import { type AuthConfig, requireOwner } from "./product-auth.js";
export interface McpIdentity {
  ownerId: string;
  clientId: string;
  scopes: string[];
}
const publicMessage = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.enum([
    "initialize",
    "notifications/initialized",
    "tools/list",
    "server/discover",
  ]),
});
const publicRequest = z.union([
  publicMessage,
  z.array(publicMessage).min(1).max(8),
]);
const authRoutes = new Set([
  "GET /auth/oauth2/authorize",
  "POST /auth/oauth2/token",
  "POST /auth/oauth2/register",
  "POST /auth/oauth2/consent",
  "POST /auth/oauth2/continue",
  "POST /auth/oauth2/revoke",
]);
export function createProductGateway(
  config: AuthConfig & {
    redirects: readonly string[];
    connections: Connections;
  },
  server: (identity: McpIdentity | null) => McpServer,
) {
  const admin = createAdmin(config);
  const auth = admin.auth;
  const challenge = () =>
    new Response("OAuth required", {
      status: 401,
      headers: {
        ...privateHeaders,
        "www-authenticate": `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:read offline_access"`,
      },
    });
  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.origin !== config.origin ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !== config.origin)
    )
      return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
    if (
      request.method === "GET" &&
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ].includes(url.pathname)
    )
      return safeResponse(
        JSON.stringify({
          resource: `${config.origin}/mcp`,
          authorization_servers: [`${config.origin}/auth`],
          scopes_supported: [
            "mcp:read",
            "mcp:write",
            "mcp:files",
            "offline_access",
          ],
          bearer_methods_supported: ["header"],
        }),
      );
    if (
      request.method === "GET" &&
      [
        "/auth/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/auth",
        "/.well-known/oauth-authorization-server",
      ].includes(url.pathname)
    )
      return oauthProviderAuthServerMetadata(auth)(request);
    if (request.method === "GET" && url.pathname === "/consent") {
      let ownerId: string;
      try {
        ownerId = (await requireOwner(auth, config.state, request.headers)).user
          .id;
        if (
          !(await verifyOAuthQueryParams(
            url.search.slice(1),
            (
              await auth.$context
            ).secret,
          ))
        )
          throw new Error();
      } catch {
        return challenge();
      }
      const escapeHtml = (value: string) =>
        value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll('"', "&quot;");
      const companies = (await config.connections.list(ownerId)).filter(
        (c) => c.state === "active",
      );
      const companyChoices = companies
        .map(
          (c) =>
            `<label><input type="checkbox" name="company" checked value="${escapeHtml(JSON.stringify({ id: c.id, generation: c.generation, access_revision: c.accessRevision ?? 0 }))}">${escapeHtml(c.name)}<small> — ${escapeHtml(
              programSelection(c)
                .features.map((id) => featureLabels[id].sv)
                .join(", ") || "Företagsuppgifter",
            )}</small></label>`,
        )
        .join("<br>");
      return safeResponse(
        `<!doctype html><html lang="sv"><meta charset="utf-8"><title>Godkänn klient</title><h1>Godkänn klient</h1><p>${(url.searchParams.get("scope") ?? "").split(" ").includes("mcp:files") ? "Klienten begär även filåtkomst. Valda filer kan hämtas, tillfälligt lagras krypterade och återläsas inom 55 minuter för uttryckligen behöriga företag. Normal rensning sker inom en timme när installationens schemalagda jobb körs; driftavbrott kan fördröja fysisk radering. Filåtkomst följer företagets behörigheter och policy." : ""}</p><p>${(url.searchParams.get("scope") ?? "").split(" ").includes("mcp:write") ? "Klienten begär även skrivbehörighet. Bokföring följer företagets aktuella policy, skrivskydd och krav på granskning." : "Klienten begär läsåtkomst till anslutna företag. Befintliga behörigheter utökas inte automatiskt."}</p><fieldset><legend>Välj företag för detta godkännande</legend>${companyChoices}</fieldset><button id="accept">Godkänn begärda behörigheter till valda företag</button><p id="status" role="status"></p><script src="/consent.js"></script></html>`,
        200,
        "text/html; charset=utf-8",
      );
    }
    if (request.method === "GET" && url.pathname === "/consent.js")
      return safeResponse(
        `document.querySelector('#accept').onclick=async()=>{const r=await fetch('/auth/oauth2/consent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accept:true,oauth_query:location.search.slice(1),companies:[...document.querySelectorAll('input[name=company]:checked')].map(c=>JSON.parse(c.value))})});const d=await r.json();if(r.ok&&d.url)location.assign(d.url);else document.querySelector('#status').textContent='Godkännandet misslyckades. Öppna anslutningen igen i klienten och försök på nytt.';};`,
        200,
        "text/javascript",
      );
    if (authRoutes.has(`${request.method} ${url.pathname}`)) {
      if (
        request.method === "GET" &&
        url.pathname === "/auth/oauth2/authorize"
      ) {
        // Every approval must display the concrete current company selection.
        url.searchParams.set("prompt", "consent");
        request = new Request(url, request);
      }
      let parsed: unknown;
      if (request.method === "POST") {
        const browser = [
          "/auth/oauth2/consent",
          "/auth/oauth2/continue",
        ].includes(url.pathname);
        if (browser) {
          if (request.headers.get("origin") !== config.origin)
            return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
          try {
            await requireOwner(auth, config.state, request.headers);
          } catch {
            return challenge();
          }
        }
        try {
          if (
            request.headers
              .get("content-type")
              ?.startsWith("application/x-www-form-urlencoded")
          ) {
            const text = await boundedText(request);
            parsed = Object.fromEntries(new URLSearchParams(text));
            request = new Request(request.url, {
              method: "POST",
              headers: request.headers,
              body: text,
            });
          } else {
            parsed = await boundedJson(request);
            request = new Request(request.url, {
              method: "POST",
              headers: request.headers,
              body: JSON.stringify(parsed),
            });
          }
        } catch {
          return safeResponse('{"error":"VALIDATION_FAILED"}', 400);
        }
        if (url.pathname === "/auth/oauth2/register") {
          const body = z
            .object({ redirect_uris: z.array(z.string()).min(1).max(4) })
            .safeParse(parsed);
          if (
            !body.success ||
            body.data.redirect_uris.some(
              (uri) => !config.redirects.includes(uri),
            )
          )
            return safeResponse('{"error":"REDIRECT_DENIED"}', 400);
        }
        if (url.pathname === "/auth/oauth2/consent") {
          const body = z
            .object({
              accept: z.boolean(),
              oauth_query: z.string().max(12000),
              companies: z
                .array(
                  z
                    .object({
                      id: z.string().uuid(),
                      generation: z.number().int().nonnegative(),
                      access_revision: z.number().int().nonnegative(),
                    })
                    .strict(),
                )
                .max(50),
            })
            .safeParse(parsed);
          if (
            !body.success ||
            !(await verifyOAuthQueryParams(
              body.data.oauth_query,
              (
                await auth.$context
              ).secret,
            ))
          )
            return safeResponse('{"error":"CONSENT_DENIED"}', 400);
          const client = new URLSearchParams(body.data.oauth_query).get(
            "client_id",
          );
          if (!client) return safeResponse('{"error":"CONSENT_DENIED"}', 400);
          if (body.data.accept) {
            const session = await requireOwner(
              auth,
              config.state,
              request.headers,
            );
            try {
              // Let the maintained OAuth implementation validate/consume the
              // signed consent first. No grant is changed for denied consent.
              const response = await auth.handler(request);
              if (!response.ok) return response;
              const result = (await response.clone().json()) as {
                url?: string;
              };
              const code = result.url
                ? new URL(result.url).searchParams.get("code")
                : null;
              if (!code) return safeResponse('{"error":"CONSENT_DENIED"}', 400);
              const grant = await config.connections.renewGrant(
                session.user.id,
                client,
                body.data.companies,
              );
              await auth.api.bindProductCode({
                body: {
                  code,
                  owner: session.user.id,
                  client,
                  revision: grant.revision as number,
                },
              });
              return response;
            } catch {
              return safeResponse('{"error":"CONSENT_CONFLICT"}', 409);
            }
          }
        }
        if (url.pathname === "/auth/oauth2/token") {
          const body = z
            .object({
              client_id: z.string().optional(),
              grant_type: z.enum(["authorization_code", "refresh_token"]),
              code: z.string().optional(),
              refresh_token: z.string().optional(),
            })
            .safeParse(parsed);
          if (!body.success)
            return safeResponse('{"error":"invalid_grant"}', 400);
          let client = body.data.client_id;
          if (
            !client &&
            /^Basic /i.test(request.headers.get("authorization") ?? "")
          ) {
            try {
              client = decodeURIComponent(
                atob(
                  (request.headers.get("authorization") ?? "").slice(6),
                ).split(":")[0] ?? "",
              );
            } catch {
              return safeResponse('{"error":"invalid_client"}', 400);
            }
          }
          if (!client) return safeResponse('{"error":"invalid_client"}', 400);
          try {
            await auth.api.verifyProductExchange({
              body: {
                client,
                type: body.data.grant_type,
                token:
                  (body.data.grant_type === "authorization_code"
                    ? body.data.code
                    : body.data.refresh_token) ?? "",
              },
            });
          } catch {
            return safeResponse('{"error":"invalid_grant"}', 400);
          }
          const response = await auth.handler(request);
          if (!response.ok) return response;
          try {
            const tokens = (await response.clone().json()) as {
              access_token: string;
            };
            await auth.api.retainProductTokens({
              body: { token: tokens.access_token },
            });
            await auth.api.verifyProductToken({
              body: { token: tokens.access_token },
            });
            return response;
          } catch {
            return safeResponse('{"error":"invalid_grant"}', 400);
          }
        }
      }
      return auth.handler(request);
    }
    if (url.pathname !== "/mcp") return admin.fetch(request);
    if (url.search) return challenge();
    let body: unknown;
    if (request.method === "POST") {
      try {
        body = await boundedJson(request);
      } catch {
        return safeResponse('{"error":"VALIDATION_FAILED"}', 400);
      }
      request = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(body),
      });
    }
    const authorization = request.headers.get("authorization");
    let identity: McpIdentity | null = null;
    if (authorization) {
      try {
        if (!/^Bearer [^\s]+$/i.test(authorization)) throw new Error();
        identity = await auth.api.verifyProductToken({
          body: { token: authorization.slice(7) },
        });
        if (identity.clientId.startsWith("owner-recovery:")) throw new Error();
      } catch {
        return challenge();
      }
    } else if (
      request.method !== "POST" ||
      !publicRequest.safeParse(body).success
    )
      return challenge();
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    const build = () => server(identity);
    if (
      !(await isLegacyRequest(request, body, { maxRequestBodySize: 16384 }))
    ) {
      const handler = createMcpHandler(build, {
        legacy: "reject",
        responseMode: "auto",
        maxRequestBodySize: 16384,
      });
      try {
        return await handler.fetch(request, { parsedBody: body });
      } finally {
        await handler.close();
      }
    }
    const instance = build();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 16384,
    });
    try {
      await instance.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await instance.close();
    }
  }
  return { auth, fetch };
}
async function boundedText(request: Request) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 16384) {
          await reader.cancel();
          throw new Error("VALIDATION_FAILED");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(out);
}
