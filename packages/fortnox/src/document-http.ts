import {
  type AccountingActor,
  type Connections,
  DomainError,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import {
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
      if (
        !this.active() ||
        c.generation !== original.generation ||
        !this.provider.config.testTenants.includes(c.tenant)
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
      let raw: unknown;
      try {
        raw = parseExactProviderJson(await boundedResponse(response, 262144));
      } catch {
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_response");
      }
      await context.assertActive();
      return z.record(z.string(), z.unknown()).parse(raw);
    }
    throw new ProviderError("UPSTREAM_UNAVAILABLE", "read_budget");
  }
  async submit(
    context: ProviderContext,
    url: URL,
    method: "POST" | "PUT" | "GET",
    body: string | undefined,
    beforeDispatch: () => Promise<void>,
  ): Promise<Record<string, unknown> | null> {
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
      const raw = z
        .record(z.string(), z.unknown())
        .parse(parseExactProviderJson(await boundedResponse(response, 262144)));
      await context.assertActive();
      return raw;
    } catch {
      return null;
    }
  }
}
