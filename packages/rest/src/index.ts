import {
  type Actor,
  DomainError,
  type ReadDefinition,
  type ReadServices,
  readDefinitions,
  readError,
  readOutput,
  requirePermission,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import { Hono } from "hono";
import { z } from "zod";
import { openApiDocument } from "./openapi.js";

export { openApiDocument } from "./openapi.js";

export function restError(cause: unknown) {
  const code =
    cause instanceof DomainError
      ? cause.code
      : cause instanceof z.ZodError
        ? "VALIDATION_FAILED"
        : "UPSTREAM_UNAVAILABLE";
  const status =
    code === "AUTH_REQUIRED"
      ? 401
      : code === "VALIDATION_FAILED"
        ? 400
        : code === "RESOURCE_NOT_FOUND"
          ? 404
          : ["COMPANY_FORBIDDEN", "CAPABILITY_UNAVAILABLE"].includes(code)
            ? 403
            : [
                  "CONNECTION_DISCONNECTED",
                  "RECONNECT_REQUIRED",
                  "CONNECTION_CONFLICT",
                ].includes(code)
              ? 409
              : code === "RATE_LIMITED"
                ? 429
                : code === "UPSTREAM_UNAVAILABLE"
                  ? 502
                  : 503;
  return {
    status,
    body: readError.parse({
      status: "error",
      error: {
        code,
        reason:
          cause instanceof ProviderError ? cause.reason : "request_failed",
        provider_code:
          cause instanceof ProviderError ? cause.providerCode : null,
        correlation_id: crypto.randomUUID(),
      },
    }),
  };
}
export function restApi(config: {
  origin: string;
  enabled: boolean;
  services: ReadServices;
  authenticate: (request: Request) => Promise<Actor>;
}) {
  const routes = new Hono<{ Variables: { actor: Actor } }>();
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  routes.use("*", async (c, next) => {
    if (!config.enabled)
      return json(restError(new DomainError("RESOURCE_NOT_FOUND")).body, 404);
    if (c.req.url.length > 8192)
      return json(restError(new DomainError("VALIDATION_FAILED")).body, 400);
    const url = new URL(c.req.url);
    if (
      url.origin !== config.origin ||
      (c.req.header("origin") && c.req.header("origin") !== config.origin)
    )
      return json(restError(new DomainError("COMPANY_FORBIDDEN")).body, 403);
    const actor = await config.authenticate(c.req.raw);
    requirePermission(actor, "read");
    c.set("actor", actor);
    if (c.req.method !== "GET") {
      const response = json(
        restError(new DomainError("CAPABILITY_UNAVAILABLE")).body,
        405,
      );
      response.headers.set("allow", "GET");
      return response;
    }
    await next();
  });
  routes.onError((error) => {
    const result = restError(error);
    const response = json(result.body, result.status);
    if (result.status === 401)
      response.headers.set(
        "www-authenticate",
        `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/api/v1", scope="api:read"`,
      );
    return response;
  });
  routes.get("/openapi.json", () => json(openApiDocument(config.origin)));
  for (const [operation, entry] of Object.entries(readDefinitions)) {
    const definition: ReadDefinition = entry;
    routes.get(definition.path, async (c) => {
      const input: Record<string, unknown> = { ...c.req.param() };
      const query = new URL(c.req.url).searchParams;
      for (const key of new Set(query.keys())) {
        if (
          Object.hasOwn(input, key) ||
          (query.getAll(key).length > 1 && key !== "account_numbers")
        )
          throw new DomainError("VALIDATION_FAILED");
        input[key] =
          key === "account_numbers"
            ? query.getAll(key).map((v) => (/^\d+$/.test(v) ? Number(v) : v))
            : query.get(key);
      }
      for (const key of [
        "financial_year",
        "limit",
        ...(operation === "get_account" || operation === "get_voucher"
          ? ["number"]
          : []),
      ]) {
        if (typeof input[key] === "string" && /^[1-9]\d*$/.test(input[key]))
          input[key] = Number(input[key]);
      }
      const parsed = definition.input.parse(input);
      const result = await config.services.execute(
        c.get("actor"),
        operation as keyof typeof readDefinitions,
        parsed,
      );
      await config.authenticate(c.req.raw); // Refuse a revoked/expired token after provider I/O.
      const checked = readOutput(definition.data).safeParse(result);
      if (!checked.success) throw new DomainError("UPSTREAM_UNAVAILABLE");
      return json(checked.data);
    });
  }
  routes.notFound(() =>
    json(restError(new DomainError("RESOURCE_NOT_FOUND")).body, 404),
  );
  const app = new Hono();
  app.route("/api/v1", routes);
  return app;
}
