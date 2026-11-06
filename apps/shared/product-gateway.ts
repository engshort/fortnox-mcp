import {
  oauthProviderAuthServerMetadata,
  verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import type { Connections } from "@fortnox-mcp/core";
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
          scopes_supported: ["mcp:read", "offline_access"],
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
      try {
        await requireOwner(auth, config.state, request.headers);
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
      return safeResponse(
        '<!doctype html><html lang="sv"><meta charset="utf-8"><title>Godkänn klient</title><h1>Godkänn klient</h1><p>Klienten får läsa de anslutna testföretagen. Inga skrivverktyg aktiveras. Förnybar åtkomst kräver mcp:read och offline_access.</p><button id="accept">Godkänn läsåtkomst till aktuella företag</button><p id="status" role="status"></p><script src="/consent.js"></script></html>',
        200,
        "text/html; charset=utf-8",
      );
    }
    if (request.method === "GET" && url.pathname === "/consent.js")
      return safeResponse(
        `document.querySelector('#accept').onclick=async()=>{const r=await fetch('/auth/oauth2/consent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accept:true,oauth_query:location.search.slice(1)})});const d=await r.json();if(r.ok&&d.url)location.assign(d.url);else document.querySelector('#status').textContent='Godkännandet misslyckades. Ny registrering kan krävas.';};`,
        200,
        "text/javascript",
      );
    if (authRoutes.has(`${request.method} ${url.pathname}`)) {
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
            .object({ accept: z.boolean(), oauth_query: z.string().max(12000) })
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
              await config.connections.grant(
                session.user.id,
                client,
                (await config.connections.list(session.user.id))
                  .filter((c) => c.state === "active")
                  .map((c) => c.id),
              );
            } catch {
              return safeResponse(
                '{"error":"NEW_CLIENT_REGISTRATION_REQUIRED"}',
                409,
              );
            }
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
