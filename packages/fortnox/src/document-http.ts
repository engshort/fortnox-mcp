import {
  type AccountingActor,
  assertScopeProgram,
  type Connections,
  DomainError,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import {
  boundedBytes,
  boundedResponse,
  FortnoxHttp,
  type ProviderContext,
  ProviderError,
  parseExactProviderJson,
} from "./http.js";

// Internal transport for the fixed document catalog. It is never exposed as a
// caller-selected method/path tool. GET email operations use submit, not read.
export class DocumentHttp {
  readonly budget: FortnoxHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly enabled: readonly string[],
    readonly active: () => boolean,
    readonly now = Date.now,
  ) {
    this.budget = new FortnoxHttp({
      fetch: provider.config.fetch,
      state: connections.state,
      now,
    });
  }
  async context(
    actor: AccountingActor,
    company: string,
    operation: string,
    scope: string,
    write = false,
  ): Promise<ProviderContext> {
    const original = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    const assertActive = async () => {
      const c = await this.connections.authorize(
        actor.ownerId,
        actor.clientId,
        company,
      );
      assertScopeProgram(c, scope);
      if (
        !this.active() ||
        c.generation !== original.generation ||
        !this.provider.allowsTenant(c.tenant)
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      if (
        !this.enabled.includes(operation) ||
        !actor.scopes.includes("mcp:read") ||
        !c.scopes.includes(scope)
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      if (write) {
        if (c.readOnly || !actor.scopes.includes("mcp:write"))
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        await this.connections.assertWritesAllowed();
      }
    };
    await assertActive();
    return {
      owner: actor.ownerId,
      company,
      tenant: original.tenant,
      generation: original.generation,
      clientId: (await this.connections.credentials(actor.ownerId, original))
        .clientId,
      assertActive,
      token: (force) => this.provider.token(actor.ownerId, original, force),
    };
  }
  async read(
    context: ProviderContext,
    url: URL,
    until = Infinity,
  ): Promise<Record<string, unknown>> {
    const { bytes } = await this.readBody(context, url, until, false);
    try {
      return z
        .record(z.string(), z.unknown())
        .parse(
          parseExactProviderJson(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          ),
        );
    } catch {
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_response");
    }
  }
  async readSie(context: ProviderContext, url: URL, until = Infinity) {
    if (url.origin !== "https://api.fortnox.se" || url.pathname !== "/3/sie/4")
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return this.readBody(context, url, until, true);
  }
  private async readBody(
    context: ProviderContext,
    url: URL,
    until: number,
    sie: boolean,
  ) {
    const deadline = Math.min(until, this.now() + 15000);
    let renew = false,
      renewed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.budget.permit(context, deadline);
      const token = await context.token(renew);
      renew = false;
      await context.assertActive();
      let response: Response;
      try {
        response = await this.provider.config.fetch(
          new Request(url, {
            headers: {
              authorization: `Bearer ${token}`,
              // Fortnox validates Accept as JSON even for binary SIE downloads.
              accept: "application/json",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(5000, deadline - this.now())),
            ),
          }),
        );
      } catch {
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "network");
      }
      if (
        (response.status === 401 && !renewed) ||
        ((response.status === 429 || response.status >= 500) && attempt < 2)
      ) {
        await response.body?.cancel();
        if (response.status === 401) {
          renew = true;
          renewed = true;
        } else {
          const retry = response.headers.get("retry-after");
          const wait =
            retry && /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : 250 * 2 ** attempt;
          if (this.now() + wait >= deadline)
            throw new ProviderError("RATE_LIMITED", "read_budget");
          await new Promise((r) => setTimeout(r, wait));
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(
          response.status === 401
            ? "RECONNECT_REQUIRED"
            : response.status === 403
              ? "CAPABILITY_UNAVAILABLE"
              : "UPSTREAM_UNAVAILABLE",
          response.status === 404
            ? "record_not_found"
            : response.status === 403
              ? "permission_scope_or_license_unknown"
              : "provider_error",
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await boundedBytes(response, sie ? 2097152 : 262144);
      } catch {
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_response");
      }
      await context.assertActive();
      return { bytes, content_type: response.headers.get("content-type") };
    }
    throw new ProviderError("UPSTREAM_UNAVAILABLE", "read_budget");
  }
  async submit(
    context: ProviderContext,
    url: URL,
    method: "POST" | "PUT" | "GET" | "DELETE",
    body: string | undefined,
    beforeDispatch: () => Promise<void>,
  ): Promise<Record<string, unknown> | null> {
    if (
      method === "DELETE" &&
      (url.origin !== "https://api.fortnox.se" ||
        !/^\/3\/salarytransactions\/[1-9]\d{0,9}$/.test(url.pathname) ||
        url.search ||
        body !== undefined)
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    await this.budget.permit(context, this.now() + 15000);
    const token = await context.token(false);
    await context.assertActive();
    await beforeDispatch();
    // Everything after dispatch is uncertain until this operation's adapter has
    // verified identity and effect by readback. Never retry, even GET email.
    try {
      const response = await this.provider.config.fetch(
        new Request(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body }),
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        }),
      );
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const text = await boundedResponse(response, 262144);
      if (method === "DELETE") {
        // This endpoint documents a final 200 without a response-body schema.
        // A JSON null/array/object is not a lost response. Known error envelopes
        // and malformed JSON are still rejected; 202 is never final proof.
        if (![200, 204].includes(response.status)) return null;
        if (text.trim() !== "") {
          const parsed = parseExactProviderJson(text);
          if (
            parsed &&
            typeof parsed === "object" &&
            "ErrorInformation" in parsed
          )
            return null;
        }
        await context.assertActive();
        return {
          deletion_acknowledged: true,
          response_status: response.status,
        };
      }
      const raw = z
        .record(z.string(), z.unknown())
        .parse(parseExactProviderJson(text));
      await context.assertActive();
      return raw;
    } catch {
      return null;
    }
  }
}
