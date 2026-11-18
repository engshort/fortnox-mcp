import {
  type Actor,
  bridgeLimits,
  bridgePathMatch,
  bridgeSafePath,
  type CompanySync,
  DomainError,
  type FortnoxBridge,
  type ReadDefinition,
  type ReadServices,
  readDefinitions,
  readError,
  readOutput,
  requirePermission,
} from "@fortnox-mcp/core";
import { boundedBytes, ProviderError } from "@fortnox-mcp/fortnox";
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
    code === "PRECONDITION_REQUIRED"
      ? 428
      : [
            "OUTCOME_UNKNOWN",
            "REVIEW_REQUIRED",
            "IDEMPOTENCY_CONFLICT",
            "INTENT_CONFLICT",
          ].includes(code)
        ? 409
        : code === "AUTH_REQUIRED"
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
  bridge?: FortnoxBridge;
  sync?: CompanySync;
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
    const bridgeRoute =
      /^\/api\/v1\/companies\/[^/]+\/(?:fortnox\/|bridge(?:\/|$))/.test(
        url.pathname,
      );
    if (bridgeRoute && !config.bridge)
      return json(restError(new DomainError("RESOURCE_NOT_FOUND")).body, 404);
    if (!bridgeRoute && c.req.method !== "GET") {
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
    if (result.status === 401) {
      response.headers.set("x-fortnox-mcp-error-source", "integration");
      response.headers.set(
        "www-authenticate",
        `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/api/v1", scope="api:read"`,
      );
    }
    return response;
  });
  routes.get("/openapi.json", () => json(openApiDocument(config.origin)));
  if (config.sync) {
    const sync = config.sync;
    routes.get("/companies/:company_id/sync/manifest", async (c) => {
      if (new URL(c.req.url).search) throw new DomainError("VALIDATION_FAILED");
      const result = await sync.manifest(
        c.get("actor"),
        c.req.param("company_id"),
      );
      await config.authenticate(c.req.raw);
      return json(result);
    });
    routes.get("/companies/:company_id/sync/changes", async (c) => {
      const query = new URL(c.req.url).searchParams;
      if ([...query.keys()].some((key) => query.getAll(key).length !== 1))
        throw new DomainError("VALIDATION_FAILED");
      return json(
        await sync.changes(
          c.get("actor"),
          c.req.param("company_id"),
          Object.fromEntries(query),
          () => config.authenticate(c.req.raw),
          c.req.raw.signal,
        ),
      );
    });
  }
  if (config.bridge) {
    const bridge = config.bridge;
    routes.get("/companies/:company_id/bridge/operations", async (c) => {
      if (new URL(c.req.url).search) throw new DomainError("VALIDATION_FAILED");
      const result = await bridge.operations(
        c.get("actor"),
        c.req.param("company_id"),
      );
      await config.authenticate(c.req.raw);
      return json(result);
    });
    routes.get(
      "/companies/:company_id/bridge/executions/:execution_id",
      async (c) => {
        if (new URL(c.req.url).search)
          throw new DomainError("VALIDATION_FAILED");
        const result = await bridge.status(
          c.get("actor"),
          c.req.param("company_id"),
          c.req.param("execution_id"),
        );
        await config.authenticate(c.req.raw);
        return json(result);
      },
    );
    routes.post(
      "/companies/:company_id/bridge/executions/:execution_id/reconcile",
      async (c) => {
        requirePermission(c.get("actor"), "write");
        const bytes = await boundedBytes(new Response(c.req.raw.body), 1024);
        if (bytes.length && new TextDecoder().decode(bytes).trim() !== "{}")
          throw new DomainError("VALIDATION_FAILED");
        const result = await bridge.reconcile(
          c.get("actor"),
          c.req.param("company_id"),
          c.req.param("execution_id"),
        );
        await config.authenticate(c.req.raw);
        return json(result, result.state === "outcome_unknown" ? 409 : 200);
      },
    );
    routes.all("/companies/:company_id/fortnox/*", async (c) => {
      const actor = c.get("actor"),
        company = c.req.param("company_id");
      await bridge.authorize(actor, company);
      const url = new URL(c.req.url),
        path = bridgeSafePath(
          url.pathname.slice(url.pathname.indexOf("/fortnox/") + 8),
        );
      const catalog = await bridge.catalog();
      if (!catalog) throw new DomainError("CAPABILITY_UNAVAILABLE");
      const matching = catalog.operations.filter((op) =>
        bridgePathMatch(op.path, path),
      );
      const template = matching[0]?.path;
      const candidates = matching.filter((op) => op.path === template);
      if (!candidates.length) throw new DomainError("RESOURCE_NOT_FOUND");
      const operation = candidates.find((op) => op.method === c.req.method);
      if (!operation) {
        const response = json(
          restError(new DomainError("CAPABILITY_UNAVAILABLE")).body,
          405,
        );
        response.headers.set(
          "allow",
          [...new Set(candidates.map((op) => op.method))].join(", "),
        );
        return response;
      }
      await bridge.authorize(actor, company, operation);
      let bytes: Uint8Array;
      try {
        bytes = await boundedBytes(
          new Response(c.req.raw.body),
          bridgeLimits.requestBytes,
        );
      } catch {
        throw new DomainError("VALIDATION_FAILED");
      }
      const response = await bridge.execute(
        actor,
        company,
        {
          operation,
          path,
          query: url.searchParams,
          bytes,
          headers: c.req.raw.headers,
          contentType: c.req.header("content-type") ?? null,
        },
        () => config.authenticate(c.req.raw),
      );
      const execution = response.execution;
      if (response.result) {
        const result = response.result;
        if (execution) {
          result.headers.set("x-fortnox-execution-id", execution.execution_id);
          result.headers.set("x-fortnox-execution-state", execution.state);
        }
        return new Response(
          [204, 205, 304].includes(result.status) || c.req.method === "HEAD"
            ? null
            : new Uint8Array(result.bytes),
          { status: result.status, headers: result.headers },
        );
      }
      const result = json(
        execution,
        execution?.state === "outcome_unknown" ? 409 : 200,
      );
      if (execution)
        result.headers.set(
          "location",
          `/api/v1/companies/${company}/bridge/executions/${execution.execution_id}`,
        );
      return result;
    });
  }
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
