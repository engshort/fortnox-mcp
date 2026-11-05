import {
  oauthProviderAuthServerMetadata,
  verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { createProbeAuth, type ProbeConfig } from "./auth.js";
import type { McpRequestDiagnostic } from "./diagnostics.js";
import { syntheticCompany } from "./files.js";
import { page, script, style } from "./pages.js";
import { createProbeServer } from "./server.js";

const authRoutes = new Set([
  "GET /auth/oauth2/authorize",
  "POST /auth/oauth2/token",
  "POST /auth/oauth2/register",
  "POST /auth/oauth2/consent",
  "POST /auth/oauth2/continue",
  "POST /auth/oauth2/revoke",
  "POST /auth/one-time-token/verify",
  "POST /auth/sign-out",
  "GET /auth/get-session",
]);
const browserPosts = new Set([
  "/auth/oauth2/consent",
  "/auth/oauth2/continue",
  "/auth/one-time-token/verify",
  "/auth/sign-out",
]);
const securityHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

export interface ProtocolNegotiation {
  requestedProtocol: string;
  negotiatedProtocol: string;
}
const protocolVersion = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const initializeProbe = z.object({
  method: z.literal("initialize"),
  params: z.object({ protocolVersion: z.string() }),
});
const initializedProbe = z.object({
  result: z.object({ protocolVersion }),
});
const publicMetadataMessage = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.enum([
    "initialize",
    "notifications/initialized",
    "tools/list",
    "server/discover",
  ]),
});
const publicMetadataRequest = z.union([
  publicMetadataMessage,
  z.array(publicMetadataMessage).min(1).max(8),
]);
const rpcMessage = z.object({ jsonrpc: z.literal("2.0"), method: z.string() });
const rpcRequest = z.union([rpcMessage, z.array(rpcMessage).min(1)]);
const discoveryMethod = z.enum([
  "server/discover",
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
]);
export interface PublicDiscoveryDiagnostic {
  methods: string[];
  jsonRpc2: boolean[];
}

export function createProbeHandler(
  config: ProbeConfig & {
    testRedirectUri?: string;
    onProtocolNegotiated?: (event: ProtocolNegotiation) => void;
    onPublicDiscovery?: (event: PublicDiscoveryDiagnostic) => void;
    onMcpRequest?: (event: McpRequestDiagnostic) => void;
  },
) {
  const origin = new URL(config.origin).origin;
  const auth = createProbeAuth(config);
  const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:read offline_access"`;
  const respond = (
    body: BodyInit | null,
    status = 200,
    contentType = "text/plain; charset=utf-8",
  ) =>
    new Response(body, {
      status,
      headers: { ...securityHeaders, "content-type": contentType },
    });

  async function handle(
    request: Request,
    diagnostic?: McpRequestDiagnostic,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== origin) return respond("Host forbidden", 403);
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== origin
    )
      return respond("Origin forbidden", 403);
    if (request.method === "POST") {
      if (
        browserPosts.has(url.pathname) &&
        request.headers.get("origin") !== origin
      )
        return respond("Origin required", 403);
      // Consume at most 16 KiB, then forward a fresh body to the SDK/library.
      const reader = request.body?.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      if (reader)
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 16 * 1024) {
            await reader.cancel();
            return respond("Request too large", 413);
          }
          chunks.push(next.value);
        }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      request = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp")
    ) {
      return respond(
        JSON.stringify({
          resource: `${origin}/mcp`,
          authorization_servers: [`${origin}/auth`],
          scopes_supported: [
            "mcp:read",
            "offline_access",
            ...(config.review ? ["mcp:review"] : []),
            ...(config.files ? ["mcp:files"] : []),
          ],
          bearer_methods_supported: ["header"],
        }),
        200,
        "application/json",
      );
    }
    if (
      request.method === "GET" &&
      [
        "/auth/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/auth",
        "/.well-known/oauth-authorization-server",
      ].includes(url.pathname)
    ) {
      return oauthProviderAuthServerMetadata(auth)(request);
    }
    if (
      request.method === "GET" &&
      ["/", "/sign-in", "/consent"].includes(url.pathname)
    ) {
      if (
        url.search &&
        !(await verifyOAuthQueryParams(
          url.search.slice(1),
          (
            await auth.$context
          ).secret,
        ))
      )
        return respond("Invalid OAuth query", 400);
      if (url.pathname === "/consent") {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session?.user.id !== config.ownerId)
          return respond("Owner session required", 401);
      }
      return respond(
        page(
          url.pathname === "/"
            ? "home"
            : url.pathname === "/sign-in"
              ? "sign-in"
              : "consent",
          Boolean(config.review),
        ),
        200,
        "text/html; charset=utf-8",
      );
    }
    if (request.method === "GET" && url.pathname === "/page.js")
      return respond(script, 200, "text/javascript; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/style.css")
      return respond(style, 200, "text/css; charset=utf-8");
    if (authRoutes.has(`${request.method} ${url.pathname}`)) {
      if (url.pathname === "/auth/oauth2/register") {
        let body: { redirect_uris?: unknown };
        try {
          body = await request.clone().json();
        } catch {
          return respond("Invalid registration", 400);
        }
        if (
          !Array.isArray(body.redirect_uris) ||
          !body.redirect_uris.length ||
          body.redirect_uris.length > 4 ||
          !body.redirect_uris.every(
            (uri: unknown) =>
              typeof uri === "string" &&
              (uri ===
                "https://chatgpt.com/connector_platform_oauth_redirect" ||
                uri === config.testRedirectUri),
          )
        ) {
          return respond(
            "Redirect URI not permitted by this test installation",
            400,
          );
        }
      }
      if (
        browserPosts.has(url.pathname) &&
        url.pathname !== "/auth/one-time-token/verify"
      ) {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session?.user.id !== config.ownerId)
          return respond("Owner session required", 401);
      }
      return auth.handler(request);
    }
    if (url.pathname !== "/mcp") return respond("Not found", 404);
    const authorization = request.headers.get("authorization");
    // Only fixed public protocol/tool metadata may be discovered anonymously.
    // Classify every message in a batch; a supplied bad credential never falls
    // back to public access. Resources, tool calls and unknown methods remain
    // behind the same owner/resource/scope verification.
    const rpcBody =
      request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    if (diagnostic) {
      const messages = (Array.isArray(rpcBody) ? rpcBody : [rpcBody]).slice(
        0,
        8,
      );
      diagnostic.methods = messages.map((message) => {
        const parsed = z.object({ method: discoveryMethod }).safeParse(message);
        return parsed.success ? parsed.data.method : "other";
      });
    }
    const publicDiscovery =
      request.method === "POST" &&
      authorization === null &&
      !url.search &&
      publicMetadataRequest.safeParse(rpcBody).success;
    if (config.onPublicDiscovery && authorization === null) {
      const messages = (Array.isArray(rpcBody) ? rpcBody : [rpcBody]).slice(
        0,
        8,
      );
      const methodOnly = z.object({ method: discoveryMethod });
      const rpc2Only = z.object({ jsonrpc: z.literal("2.0") });
      try {
        config.onPublicDiscovery({
          methods: messages.map((message) => {
            const parsed = methodOnly.safeParse(message);
            return parsed.success ? parsed.data.method : "other";
          }),
          jsonRpc2: messages.map(
            (message) => rpc2Only.safeParse(message).success,
          ),
        });
      } catch {
        // Diagnostics do not affect authorization or transport behavior.
      }
    }
    if (
      request.method === "POST" &&
      authorization === null &&
      !url.search &&
      !rpcRequest.safeParse(rpcBody).success
    ) {
      // Invalid protocol framing cannot invoke a tool. Report the bounded
      // JSON-RPC error instead of treating a metadata preflight as a login.
      return respond(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid Request" },
        }),
        400,
        "application/json",
      );
    }
    if (
      (!publicDiscovery && !authorization?.match(/^Bearer [^\s]+$/i)) ||
      url.search
    ) {
      return new Response("OAuth required", {
        status: 401,
        headers: { ...securityHeaders, "www-authenticate": challenge },
      });
    }
    let reviewAuthorized = false;
    let filesAuthorized = false;
    if (!publicDiscovery) {
      try {
        const verified = await auth.api.verifyProbeToken({
          body: { token: authorization?.slice(7) ?? "" },
        });
        reviewAuthorized = verified.scopes.includes("mcp:review");
        filesAuthorized = verified.scopes.includes("mcp:files");
        if (diagnostic) diagnostic.authorization = "verified";
      } catch {
        return new Response("Invalid or expired authorization", {
          status: 401,
          headers: { ...securityHeaders, "www-authenticate": challenge },
        });
      }
    }
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    // Both protocol eras share this authorization result and server factory.
    // The maintained SDK classifies/validates the wire envelope; never infer
    // authorization from client capabilities or the requested protocol era.
    const buildServer = () =>
      createProbeServer(
        config.review
          ? {
              store: config.review,
              origin,
              owner: config.ownerId,
              authorized: reviewAuthorized,
            }
          : undefined,
        config.files
          ? {
              authorized: filesAuthorized,
              origin,
              context: {
                ...config.files,
                owner: config.ownerId,
                secret: config.secret,
                company: syntheticCompany,
              },
            }
          : undefined,
      );
    if (
      !(await isLegacyRequest(request, rpcBody, {
        maxRequestBodySize: 16 * 1024,
      }))
    ) {
      if (diagnostic) diagnostic.transport = "modern";
      const modern = createMcpHandler(buildServer, {
        legacy: "reject",
        responseMode: "auto",
        maxRequestBodySize: 16 * 1024,
      });
      try {
        return await modern.fetch(request, { parsedBody: rpcBody });
      } finally {
        await modern.close();
      }
    }
    // Preserve the earlier stateless JSON response contract for legacy hosts.
    if (diagnostic) diagnostic.transport = "legacy";
    const server = buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 16 * 1024,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      if (config.onProtocolNegotiated && response.status === 200) {
        const initialized = initializeProbe.safeParse(rpcBody);
        if (initialized.success) {
          // Opt-in operator diagnostics expose only version strings. Never
          // forward IDs, client metadata, credentials or raw RPC bodies.
          try {
            const result = initializedProbe.safeParse(
              await response.clone().json(),
            );
            if (result.success) {
              config.onProtocolNegotiated({
                requestedProtocol: protocolVersion.safeParse(
                  initialized.data.params.protocolVersion,
                ).success
                  ? initialized.data.params.protocolVersion
                  : "other",
                negotiatedProtocol: result.data.result.protocolVersion,
              });
            }
          } catch {
            // A diagnostic failure must not change the protocol response.
          }
        }
      }
      return response;
    } finally {
      await server.close();
    }
  }
  return {
    auth,
    fetch: async (request: Request) => {
      if (!config.onMcpRequest || new URL(request.url).pathname !== "/mcp")
        return handle(request);
      const contentType = request.headers.get("content-type");
      const requested = protocolVersion.safeParse(
        request.headers.get("mcp-protocol-version"),
      );
      const diagnostic: McpRequestDiagnostic = {
        method:
          request.method === "POST"
            ? "POST"
            : request.method === "GET"
              ? "GET"
              : "other",
        contentType:
          contentType === null
            ? "absent"
            : contentType.split(";", 1)[0].trim().toLowerCase() ===
                "application/json"
              ? "json"
              : "other",
        protocol: requested.success
          ? requested.data
          : request.headers.has("mcp-protocol-version")
            ? "other"
            : "absent",
        methods: [],
        authorization: request.headers.has("authorization")
          ? "rejected"
          : "absent",
        transport: "rejected",
        status: 500,
      };
      try {
        const response = await handle(request, diagnostic);
        diagnostic.status = response.status;
        return response;
      } finally {
        try {
          config.onMcpRequest(diagnostic);
        } catch {
          /* Diagnostics never change a response. */
        }
      }
    },
  };
}
