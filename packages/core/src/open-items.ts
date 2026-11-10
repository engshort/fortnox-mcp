import { z } from "zod";
import { accountingDate } from "./accounting.js";
import type { AccountingActor } from "./bookkeeping.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { parseAmount, sumAmounts } from "./money.js";
import { assertScopeProgram } from "./programs.js";

export const openItemKind = z.enum(["receivable", "payable"]);
export type OpenItemKind = z.infer<typeof openItemKind>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const money = z
  .string()
  .max(68)
  .transform((v) => parseAmount(v, 2));
export const openItemRecord = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,19}$/),
    counterparty_id: z.string().min(1).max(32).nullable(),
    invoice_date: accountingDate.nullable(),
    due_date: accountingDate.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    balance: money.nullable(),
    booked: z.boolean().nullable(),
    cancelled: z.boolean().nullable(),
    credit: z.boolean().nullable(),
  })
  .strict();
export const openItemQuery = z
  .object({
    company_id: z.string().uuid(),
    kind: openItemKind,
    include_unbooked: z.boolean().default(false),
    continuation: z
      .object({
        next_page: z.number().int().min(2).max(10000),
        anchor_sha256: hash,
        query_key: z.string().max(1024),
      })
      .strict()
      .optional(),
  })
  .strict();
export const openItemSource = z
  .object({
    operation: z.string().min(1).max(128),
    record_id: z.string().min(1).max(128),
    sha256: hash,
  })
  .strict();
export const openItemProviderPage = z
  .object({
    company_id: z.string().uuid(),
    kind: openItemKind,
    records: z.array(openItemRecord).max(100),
    metadata_verified: z.boolean(),
    exhausted: z.boolean(),
    next_page: z.number().int().min(2).max(10000).nullable(),
    total_records: z.number().int().nonnegative().safe().nullable(),
    source: openItemSource,
    // A provider schema alone cannot prove balance currency or credit signs.
    signed_balance_verified: z.boolean(),
  })
  .strict();
export interface OpenItemProvider {
  page(
    actor: AccountingActor,
    company: string,
    kind: OpenItemKind,
    page: number,
    until: number,
  ): Promise<z.infer<typeof openItemProviderPage>>;
}
export class OpenItems {
  constructor(
    readonly connections: Connections,
    readonly provider: OpenItemProvider,
    readonly enabled: readonly OpenItemKind[] = [],
    readonly now = Date.now,
  ) {
    if (
      new Set(enabled).size !== enabled.length ||
      enabled.some((kind) => !openItemKind.safeParse(kind).success)
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
  }
  private async authorize(
    actor: AccountingActor,
    company: string,
    kind: OpenItemKind,
  ) {
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    const connection = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    const scope = kind === "receivable" ? "invoice" : "supplierinvoice";
    assertScopeProgram(connection, scope);
    if (!this.enabled.includes(kind) || !connection.scopes.includes(scope))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return connection;
  }
  async list(actor: AccountingActor, input: unknown) {
    const query = openItemQuery.parse(input),
      started = this.now();
    const before = await this.authorize(actor, query.company_id, query.kind);
    const key = JSON.stringify([
      "open-items/1",
      query.company_id,
      query.kind,
      query.include_unbooked,
    ]);
    if (query.continuation && query.continuation.query_key !== key)
      throw new DomainError("CONNECTION_CONFLICT");
    const read = async (number: number) => {
      const page = openItemProviderPage.parse(
        await this.provider.page(
          actor,
          query.company_id,
          query.kind,
          number,
          started + 30000,
        ),
      );
      if (page.company_id !== query.company_id || page.kind !== query.kind)
        throw new DomainError("COMPANY_FORBIDDEN");
      if (
        new Set(page.records.map((r) => r.id)).size !== page.records.length ||
        (page.next_page !== null && page.next_page !== number + 1) ||
        (page.exhausted && page.next_page !== null)
      )
        throw new DomainError("UPSTREAM_UNAVAILABLE");
      return page;
    };
    const first = await read(1),
      number = query.continuation?.next_page ?? 1;
    if (
      query.continuation &&
      (first.source.sha256 !== query.continuation.anchor_sha256 ||
        first.next_page === null)
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const page = number === 1 ? first : await read(number);
    if (number !== 1 && (await read(1)).source.sha256 !== first.source.sha256)
      throw new DomainError("CONNECTION_CONFLICT");
    const after = await this.authorize(actor, query.company_id, query.kind);
    if (
      after.generation !== before.generation ||
      after.tenant !== before.tenant
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const observedDay = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(started));
    const records = page.records
      .filter(
        (r) =>
          r.cancelled !== true &&
          r.balance !== "0.00" &&
          (query.include_unbooked || r.booked !== false),
      )
      .map((r) => ({
        ...r,
        open_status:
          r.cancelled === false &&
          r.balance !== null &&
          (query.include_unbooked || r.booked === true)
            ? ("open" as const)
            : ("unknown" as const),
        overdue: r.due_date === null ? null : r.due_date < observedDay,
        expected_signed_cash_flow:
          page.signed_balance_verified &&
          r.balance !== null &&
          r.currency !== null &&
          r.cancelled === false &&
          r.booked === true
            ? sumAmounts(
                [
                  query.kind === "payable"
                    ? r.balance.startsWith("-")
                      ? r.balance.slice(1)
                      : `-${r.balance}`
                    : r.balance,
                ],
                2,
              )
            : null,
      }));
    const fieldsComplete = page.records.every((r) =>
      Object.values(r).every((value) => value !== null),
    );
    const complete =
      number === 1 &&
      page.metadata_verified &&
      page.exhausted &&
      fieldsComplete &&
      (page.total_records === null ||
        page.total_records === page.records.length) &&
      page.signed_balance_verified;
    const currencies = [
      ...new Set(
        records.map((r) => r.currency).filter((v): v is string => v !== null),
      ),
    ].sort();
    return {
      company_id: query.company_id,
      kind: query.kind,
      records,
      observation_day: observedDay,
      observation_point: "current_provider_state" as const,
      historical_status_supported: false as const,
      retrieved: { started_at: started, finished_at: this.now() },
      consistency: "not_atomic" as const,
      complete,
      balance_semantics_verified: page.signed_balance_verified,
      totals_scope: "returned_page_only" as const,
      totals: currencies.map((currency) => {
        const rows = records.filter((r) => r.currency === currency);
        return {
          currency,
          provider_balance_sum: rows.some((r) => r.balance === null)
            ? null
            : sumAmounts(
                rows.map((r) => r.balance as string),
                2,
              ),
          expected_signed_cash_flow: rows.some(
            (r) => r.expected_signed_cash_flow === null,
          )
            ? null
            : sumAmounts(
                rows.map((r) => r.expected_signed_cash_flow as string),
                2,
              ),
        };
      }),
      page: {
        number,
        source_record_count: page.records.length,
        total_source_records: page.total_records,
        metadata_verified: page.metadata_verified,
        exhausted: page.exhausted,
        next:
          page.next_page === null
            ? null
            : {
                next_page: page.next_page,
                anchor_sha256: first.source.sha256,
                query_key: key,
              },
      },
      sources: number === 1 ? [page.source] : [first.source, page.source],
      limitations: [
        ...(!page.signed_balance_verified
          ? ["balance_currency_and_credit_sign_unverified"]
          : []),
        ...(!fieldsComplete ? ["missing_document_fields"] : []),
        ...(!complete ? ["collection_not_complete"] : []),
        "due_date_is_not_payment_promise",
      ],
    };
  }
}
