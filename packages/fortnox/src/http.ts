import { DomainError, type StateStore } from "@fortnox-mcp/core";
import { z } from "zod";

export const providerOperations = {
  company_information: {
    method: "GET",
    path: "/3/companyinformation",
    scope: "companyinformation",
    effect: "read",
  },
  identity: { method: "GET", path: "/3/me", scope: "profile", effect: "read" },
  financial_years: {
    method: "GET",
    path: "/3/financialyears",
    scope: "bookkeeping",
    effect: "read",
  },
  accounts: {
    method: "GET",
    path: "/3/accounts",
    scope: "bookkeeping",
    effect: "read",
  },
  voucher_series: {
    method: "GET",
    path: "/3/voucherseries",
    scope: "bookkeeping",
    effect: "read",
  },
  locked_period: {
    method: "GET",
    path: "/3/settings/lockedperiod",
    scope: "settings",
    effect: "read",
  },
  cost_centers: {
    method: "GET",
    path: "/3/costcenters",
    scope: "costcenter",
    effect: "read",
  },
  projects: {
    method: "GET",
    path: "/3/projects",
    scope: "project",
    effect: "read",
  },
  voucher: {
    method: "GET",
    path: "/3/vouchers",
    scope: "bookkeeping",
    effect: "read",
  },
} as const;
export type ProviderOperation = keyof typeof providerOperations;
export interface ProviderReadParameters {
  financialYear?: number;
  page?: number;
  voucher?: { series: string; number: number };
}
export interface ProviderContext {
  owner: string;
  company: string;
  generation: number;
  tenant: string;
  clientId: string;
  assertActive: () => Promise<void>;
  token: (force: boolean) => Promise<string>;
}
export class ProviderError extends DomainError {
  constructor(
    code:
      | "CAPABILITY_UNAVAILABLE"
      | "UPSTREAM_UNAVAILABLE"
      | "RECONNECT_REQUIRED"
      | "RATE_LIMITED",
    readonly reason: string,
    readonly providerCode: string | null = null,
  ) {
    super(code);
  }
}
export interface HttpOptions {
  fetch: typeof fetch;
  state: StateStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}
// Preserve the original JSON number lexemes for monetary record readback. String
// tokens (including escaped quotes) are left intact; JSON.parse still validates
// the complete grammar. Never round provider money through an IEEE-754 number.
export function parseExactProviderJson(text: string): unknown {
  return JSON.parse(
    text.replace(
      /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (token) => (token.startsWith('"') ? token : JSON.stringify(token)),
    ),
  );
}
export async function boundedResponse(response: Response, max = 65536) {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new ProviderError("UPSTREAM_UNAVAILABLE", "response_limit");
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
// Durable no-burst pacing: at most one reservation per 210 ms per client/tenant.
// Unlike an isolate-local token bucket, separate Worker instances share this CAS.
export class FortnoxHttp {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private readonly options: HttpOptions) {
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  async permit(context: ProviderContext, deadline: number) {
    const id = JSON.stringify([context.clientId, context.tenant]);
    for (let tries = 0; tries < 64; tries++) {
      await context.assertActive();
      const row = await this.options.state.get<{ next: number }>(
        "provider-budget",
        id,
      );
      const now = this.now();
      const wait = Math.max(0, (row?.value.next ?? 0) - now);
      if (now + wait >= deadline)
        throw new ProviderError("RATE_LIMITED", "read_budget");
      if (wait) {
        await this.sleep(wait);
        continue;
      }
      if (
        await this.options.state.put(
          "provider-budget",
          id,
          { next: now + 210 },
          row?.version ?? null,
        )
      )
        return;
    }
    throw new ProviderError("RATE_LIMITED", "contention");
  }
  async read(
    context: ProviderContext,
    operation: ProviderOperation,
    parameters?: ProviderReadParameters,
    until?: number,
  ): Promise<unknown> {
    if (!Object.hasOwn(providerOperations, operation))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const spec = providerOperations[operation];
    const url = new URL(`https://api.fortnox.se${spec.path}`);
    if (!["company_information", "identity"].includes(operation)) {
      const params = z
        .object({
          financialYear: z.number().int().positive().safe().optional(),
          page: z.number().int().min(1).max(10000).optional(),
          voucher: z
            .object({
              series: z.string().regex(/^[A-Z0-9]{1,8}$/),
              number: z.number().int().positive().safe(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(parameters);
      if ((operation === "voucher") !== Boolean(params.voucher))
        throw new DomainError("VALIDATION_FAILED");
      if (operation !== "financial_years") {
        if (params.financialYear === undefined)
          throw new DomainError("VALIDATION_FAILED");
        url.searchParams.set("financialyear", String(params.financialYear));
      }
      if (params.voucher)
        url.pathname += `/${params.voucher.series}/${params.voucher.number}`;
      if (params.page !== undefined) {
        url.searchParams.set("page", String(params.page));
        url.searchParams.set("limit", "100");
      }
    } else if (parameters) throw new DomainError("VALIDATION_FAILED");
    const deadline = Math.min(this.now() + 15000, until ?? Infinity);
    let renewed = false;
    let forceRenewal = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.permit(context, deadline);
      const token = await context.token(forceRenewal);
      forceRenewal = false;
      await context.assertActive();
      let response: Response;
      try {
        response = await this.options.fetch(
          new Request(url, {
            method: spec.method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(
              Math.min(5000, Math.max(1, deadline - this.now())),
            ),
          }),
        );
      } catch {
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "network");
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "redirect_denied");
      }
      const text = await boundedResponse(response);
      if (response.status === 401 && !renewed) {
        renewed = true;
        forceRenewal = true;
        continue;
      }
      if (response.status === 401)
        throw new ProviderError(
          "RECONNECT_REQUIRED",
          "provider_authentication",
        );
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2)
          throw new ProviderError(
            response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE",
            "provider_busy",
          );
        const retry = response.headers.get("retry-after");
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
        const delay = seconds
          ? seconds * 1000
          : 250 * 2 ** attempt +
            Math.floor((this.options.random ?? Math.random)() * 100);
        if (this.now() + delay >= deadline)
          throw new ProviderError("RATE_LIMITED", "read_budget");
        await this.sleep(delay);
        continue;
      }
      let body: unknown;
      try {
        body =
          operation === "voucher"
            ? parseExactProviderJson(text)
            : JSON.parse(text);
      } catch {
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_json");
      }
      if (!response.ok) {
        const error = z
          .object({
            ErrorInformation: z.object({
              code: z
                .union([z.string().regex(/^\d{1,12}$/), z.number().int()])
                .optional(),
            }),
          })
          .safeParse(body);
        throw new ProviderError(
          response.status === 403
            ? "CAPABILITY_UNAVAILABLE"
            : "UPSTREAM_UNAVAILABLE",
          response.status === 403
            ? "permission_scope_or_license_unknown"
            : "provider_error",
          error.success
            ? String(error.data.ErrorInformation.code ?? "") || null
            : null,
        );
      }
      await context.assertActive();
      return body;
    }
    throw new ProviderError("UPSTREAM_UNAVAILABLE", "read_budget");
  }
}
export interface ReadBudget {
  pages: number;
  items: number;
  bytes: number;
  until: number;
}
export async function readPages<T>(
  getPage: (page: number) => Promise<{ items: T[]; next: number | null }>,
  budget: ReadBudget,
  start = 1,
  now = Date.now,
) {
  if (
    !Number.isSafeInteger(start) ||
    start < 1 ||
    budget.pages < 1 ||
    budget.items < 1 ||
    budget.bytes < 1
  )
    throw new DomainError("VALIDATION_FAILED");
  const items: T[] = [];
  let page = start;
  let bytes = 0;
  for (let count = 0; count < budget.pages && now() < budget.until; count++) {
    const result = await getPage(page);
    const size = new TextEncoder().encode(JSON.stringify(result.items)).length;
    if (
      items.length + result.items.length > budget.items ||
      bytes + size > budget.bytes
    )
      return { items, complete: false, nextPage: page };
    items.push(...result.items);
    bytes += size;
    if (result.next === null) return { items, complete: true, nextPage: null };
    if (!Number.isSafeInteger(result.next) || result.next <= page)
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
    page = result.next;
  }
  return { items, complete: false, nextPage: page };
}

interface ContinuationRecord {
  owner: string;
  company: string;
  generation: number;
  query: string;
  nextPage: number;
  expiresAt: number;
}
export async function continuation(
  state: StateStore,
  context: Pick<ProviderContext, "owner" | "company" | "generation">,
  query: string,
  nextPage: number,
  now = Date.now(),
) {
  for (let n = 0; n < 8; n++) {
    const row = await state.get<Record<string, ContinuationRecord>>(
      "continuations",
      context.owner,
    );
    const values = Object.fromEntries(
      Object.entries(row?.value ?? {}).filter(([, v]) => v.expiresAt > now),
    );
    if (Object.keys(values).length >= 32)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const id = crypto.randomUUID();
    values[id] = { ...context, query, nextPage, expiresAt: now + 600000 };
    if (
      await state.put(
        "continuations",
        context.owner,
        values,
        row?.version ?? null,
      )
    )
      return id;
  }
  throw new DomainError("RATE_LIMITED");
}
export async function resumeContinuation(
  state: StateStore,
  id: string,
  context: Pick<ProviderContext, "owner" | "company" | "generation">,
  query: string,
  now = Date.now(),
) {
  const value = (
    await state.get<Record<string, ContinuationRecord>>(
      "continuations",
      context.owner,
    )
  )?.value[id];
  if (
    !value ||
    value.owner !== context.owner ||
    value.company !== context.company ||
    value.generation !== context.generation ||
    value.query !== query ||
    value.expiresAt <= now
  )
    throw new DomainError("COMPANY_FORBIDDEN");
  return value.nextPage;
}
