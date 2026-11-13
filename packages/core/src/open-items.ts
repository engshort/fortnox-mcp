import { z } from "zod";
import { accountingDate, accountingHash } from "./accounting.js";
import type { AccountingActor } from "./bookkeeping.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import {
  calculateInvoiceBalance,
  type InvoiceHistory,
  invoiceHistory,
} from "./invoice-history.js";
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
    as_of: accountingDate.optional(),
    continuation: z
      .object({
        next_page: z.number().int().min(1).max(10000),
        anchor_sha256: hash,
        query_key: z.string().max(1024),
        offset: z.number().int().min(0).max(99).optional(),
        history_version: hash.optional(),
        generation: z.number().int().nonnegative().safe().optional(),
        history_pages: z
          .array(
            z
              .object({
                number: z.number().int().min(1).max(100),
                invoice_source: hash,
                history_version: hash,
              })
              .strict(),
          )
          .max(100)
          .optional(),
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
    historical_coverage_verified: z.boolean().optional(),
  })
  .strict();
export interface OpenItemProvider {
  history?(
    actor: AccountingActor,
    company: string,
    kind: OpenItemKind,
    id: string,
    until: number,
  ): Promise<InvoiceHistory>;
  page(
    actor: AccountingActor,
    company: string,
    kind: OpenItemKind,
    page: number,
    until: number,
  ): Promise<z.infer<typeof openItemProviderPage>>;
}
export const openItemReconciliation = z
  .object({
    scope: z.literal("entire_collection"),
    status: z.enum(["matched", "mismatch", "unavailable"]),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    ledger_balance: z
      .string()
      .regex(/^-?\d+\.\d{2}$/)
      .nullable(),
    subledger_balance: z
      .string()
      .regex(/^-?\d+\.\d{2}$/)
      .nullable(),
    difference: z
      .string()
      .regex(/^-?\d+\.\d{2}$/)
      .nullable(),
    account_numbers: z.array(z.number().int().min(1).max(99999999)).max(50),
    sources: z.array(openItemSource).max(1001),
  })
  .strict();
export const unavailableOpenItemReconciliation = () => ({
  scope: "entire_collection" as const,
  status: "unavailable" as const,
  currency: null,
  ledger_balance: null,
  subledger_balance: null,
  difference: null,
  account_numbers: [],
  sources: [],
});
export function reconcileOpenItemLedger(
  kind: OpenItemKind,
  currency: string,
  ledger: string,
  subledger: string,
  accountNumbers: number[],
  sources: z.infer<typeof openItemSource>[],
) {
  ledger = parseAmount(ledger, 2);
  subledger = parseAmount(subledger, 2);
  if (kind === "payable")
    subledger = subledger.startsWith("-")
      ? subledger.slice(1)
      : `-${subledger}`;
  subledger = parseAmount(subledger, 2);
  const difference = sumAmounts(
    [ledger, subledger.startsWith("-") ? subledger.slice(1) : `-${subledger}`],
    2,
  );
  return openItemReconciliation.parse({
    scope: "entire_collection",
    status: difference === "0.00" ? "matched" : "mismatch",
    currency,
    ledger_balance: ledger,
    subledger_balance: subledger,
    difference,
    account_numbers: accountNumbers,
    sources,
  });
}
export type OpenItemLedgerReconciler = (
  actor: AccountingActor,
  company: string,
  kind: OpenItemKind,
  asOf: string,
  totals: { currency: string; amount: string | null }[],
) => Promise<z.infer<typeof openItemReconciliation>>;
export class OpenItems {
  constructor(
    readonly connections: Connections,
    readonly provider: OpenItemProvider,
    readonly enabled: readonly OpenItemKind[] = [],
    readonly now = Date.now,
    readonly reconcile?: OpenItemLedgerReconciler,
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
    if (query.as_of !== undefined) return this.historicalList(actor, query);
    if (
      query.continuation &&
      (query.continuation.offset !== undefined ||
        query.continuation.history_version !== undefined ||
        query.continuation.generation !== undefined ||
        query.continuation.history_pages !== undefined)
    )
      throw new DomainError("VALIDATION_FAILED");
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
  private async historicalList(
    actor: AccountingActor,
    query: z.infer<typeof openItemQuery>,
  ) {
    const started = this.now(),
      until = started + 45000;
    const asOf = query.as_of as string;
    const observedDay = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
    }).format(started);
    if (asOf > observedDay || query.include_unbooked)
      throw new DomainError("VALIDATION_FAILED");
    const before = await this.authorize(actor, query.company_id, query.kind);
    if (!this.provider.history) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const key = JSON.stringify([
      "historical-open-items/1",
      query.company_id,
      query.kind,
      asOf,
    ]);
    const c = query.continuation;
    if (
      c &&
      (c.query_key !== key ||
        c.generation !== before.generation ||
        c.history_version === undefined ||
        c.offset === undefined ||
        c.history_pages === undefined ||
        c.history_pages.length !== c.next_page - 1 ||
        c.history_pages.some((p, i) => p.number !== i + 1))
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const read = async (page: number) => {
      const result = openItemProviderPage.parse(
        await this.provider.page(
          actor,
          query.company_id,
          query.kind,
          page,
          until,
        ),
      );
      if (result.company_id !== query.company_id || result.kind !== query.kind)
        throw new DomainError("COMPANY_FORBIDDEN");
      if (
        new Set(result.records.map((r) => r.id)).size !==
          result.records.length ||
        (result.next_page !== null && result.next_page !== page + 1)
      )
        throw new DomainError("UPSTREAM_UNAVAILABLE");
      return result;
    };
    const first = await read(1),
      number = c?.next_page ?? 1;
    if (c && first.source.sha256 !== c.anchor_sha256)
      throw new DomainError("CONNECTION_CONFLICT");
    const page = number === 1 ? first : await read(number);
    const historyPages = [...(c?.history_pages ?? [])];
    const observedIds = new Set<string>();
    const collectionAmounts = new Map<string, string[]>();
    let allHistoryKnown = true,
      allMetadataKnown = first.metadata_verified;
    const observe = (h: InvoiceHistory) => {
      if (observedIds.has(h.id)) throw new DomainError("UPSTREAM_UNAVAILABLE");
      observedIds.add(h.id);
      const calculated = calculateInvoiceBalance(h, asOf);
      allHistoryKnown &&= calculated.complete;
      if (h.currency !== null && calculated.balance_as_of !== null) {
        const amounts = collectionAmounts.get(h.currency) ?? [];
        amounts.push(calculated.balance_as_of);
        collectionAmounts.set(h.currency, amounts);
      }
    };
    for (const anchor of historyPages) {
      const previous = anchor.number === 1 ? first : await read(anchor.number);
      allMetadataKnown &&= previous.metadata_verified;
      if (previous.source.sha256 !== anchor.invoice_source)
        throw new DomainError("CONNECTION_CONFLICT");
      const versions: string[] = [];
      for (const record of previous.records) {
        if (this.now() >= until) throw new DomainError("UPSTREAM_UNAVAILABLE");
        const h = invoiceHistory.parse(
          await this.provider.history(
            actor,
            query.company_id,
            query.kind,
            record.id,
            until,
          ),
        );
        if (
          h.company_id !== query.company_id ||
          h.kind !== query.kind ||
          h.id !== record.id
        )
          throw new DomainError("COMPANY_FORBIDDEN");
        versions.push(h.source_version);
        observe(h);
      }
      if ((await accountingHash(versions)) !== anchor.history_version)
        throw new DomainError("CONNECTION_CONFLICT");
    }
    const offset = c?.offset ?? 0;
    if (offset >= page.records.length && offset !== 0)
      throw new DomainError("CONNECTION_CONFLICT");
    // Recheck histories already returned on this source page, including paid
    // invoices. A payment change may leave the invoice-list response unchanged.
    const histories: InvoiceHistory[] = [];
    const end = Math.min(offset + 10, page.records.length);
    for (const record of page.records.slice(0, end)) {
      if (this.now() >= until) throw new DomainError("UPSTREAM_UNAVAILABLE");
      const h = invoiceHistory.parse(
        await this.provider.history(
          actor,
          query.company_id,
          query.kind,
          record.id,
          until,
        ),
      );
      if (
        h.company_id !== query.company_id ||
        h.kind !== query.kind ||
        h.id !== record.id
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      histories.push(h);
      observe(h);
    }
    if (
      c &&
      offset > 0 &&
      c.history_version !==
        (await accountingHash(
          histories.slice(0, offset).map((h) => h.source_version),
        ))
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const records = page.records
      .slice(offset, end)
      .map((record, i) => {
        const h = histories[offset + i] as InvoiceHistory;
        const result = calculateInvoiceBalance(h, asOf);
        const balance = result.balance_as_of;
        return {
          ...record,
          due_date: result.due_date,
          balance_as_of: balance,
          current_provider_balance: record.balance,
          currency: h.currency,
          open_status:
            balance === null ? ("unknown" as const) : ("open" as const),
          overdue: result.overdue,
          expected_signed_cash_flow:
            balance === null
              ? null
              : query.kind === "payable"
                ? balance.startsWith("-")
                  ? balance.slice(1)
                  : `-${balance}`
                : balance,
          history_complete: result.complete,
          history_source_version: h.source_version,
          limitations: result.limitations,
        };
      })
      .filter((r) => r.balance_as_of !== "0.00");
    const moreOnPage = end < page.records.length;
    const scanLimit =
      !moreOnPage && page.next_page !== null && historyPages.length >= 99;
    if (!moreOnPage && page.next_page !== null && !scanLimit)
      historyPages.push({
        number,
        invoice_source: page.source.sha256,
        history_version: await accountingHash(
          histories.map((h) => h.source_version),
        ),
      });
    const next =
      !scanLimit && (moreOnPage || page.next_page !== null)
        ? {
            next_page: moreOnPage ? number : (page.next_page as number),
            anchor_sha256: first.source.sha256,
            query_key: key,
            offset: moreOnPage ? end : 0,
            history_version: await accountingHash(
              moreOnPage ? histories.map((h) => h.source_version) : [],
            ),
            generation: before.generation,
            history_pages: historyPages,
          }
        : null;
    if (
      (await read(number)).source.sha256 !== page.source.sha256 ||
      (number !== 1 && (await read(1)).source.sha256 !== first.source.sha256)
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const selectedHistories = histories.slice(offset, end);
    const verified =
      selectedHistories.length > 0
        ? selectedHistories.every(
            (h) => h.amounts_verified && h.complete && h.cancellation_verified,
          )
        : page.historical_coverage_verified === true;
    const collectionComplete =
      allHistoryKnown &&
      (observedIds.size > 0 || page.historical_coverage_verified === true) &&
      next === null &&
      !scanLimit &&
      allMetadataKnown &&
      page.metadata_verified &&
      page.exhausted &&
      (page.total_records === null || page.total_records === observedIds.size);
    const currencies = [
      ...new Set(records.flatMap((r) => (r.currency ? [r.currency] : []))),
    ].sort();
    const totals = currencies.map((currency) => {
      const rows = records.filter((r) => r.currency === currency);
      return {
        currency,
        provider_balance_sum: null,
        balance_as_of_sum: rows.some((r) => r.balance_as_of === null)
          ? null
          : sumAmounts(
              rows.map((r) => r.balance_as_of as string),
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
    });
    const reconciliation =
      collectionComplete && this.reconcile
        ? openItemReconciliation.parse(
            await this.reconcile(
              actor,
              query.company_id,
              query.kind,
              asOf,
              [...collectionAmounts].map(([currency, amounts]) => ({
                currency,
                amount: sumAmounts(amounts, 2),
              })),
            ),
          )
        : unavailableOpenItemReconciliation();
    const complete =
      collectionComplete && reconciliation.status === "matched" && !c;
    const after = await this.authorize(actor, query.company_id, query.kind);
    if (
      before.generation !== after.generation ||
      before.tenant !== after.tenant
    )
      throw new DomainError("CONNECTION_CONFLICT");
    return {
      company_id: query.company_id,
      kind: query.kind,
      records,
      observation_day: observedDay,
      observation_point: "computed_as_of" as const,
      historical_status_supported: true as const,
      as_of: asOf,
      history_basis: "current_records_by_effective_date" as const,
      retrieved: { started_at: started, finished_at: this.now() },
      consistency: "not_atomic" as const,
      complete,
      balance_semantics_verified: verified,
      totals_scope: "returned_page_only" as const,
      totals,
      collection_complete: collectionComplete,
      reconciliation,
      page: {
        number,
        source_record_count: end - offset,
        total_source_records: page.total_records,
        metadata_verified: page.metadata_verified,
        exhausted: next === null && !scanLimit,
        next,
      },
      sources: [
        first.source,
        ...(number !== 1 ? [page.source] : []),
        ...selectedHistories.flatMap((h) => h.sources),
        ...historyPages
          .filter((p) => p.number < number)
          .map((p) => ({
            operation: "historical_invoice_page",
            record_id: String(p.number),
            sha256: p.history_version,
          })),
        {
          operation: "historical_invoice_page",
          record_id: `${number}:${end}`,
          sha256: await accountingHash(histories.map((h) => h.source_version)),
        },
      ],
      limitations: [
        ...new Set([
          ...selectedHistories.flatMap(
            (h) => calculateInvoiceBalance(h, asOf).limitations,
          ),
          ...(!collectionComplete ? ["collection_not_complete"] : []),
          ...(reconciliation.status !== "matched"
            ? [`control_account_reconciliation_${reconciliation.status}`]
            : []),
          ...(scanLimit ? ["historical_scan_size_limit"] : []),
          "retrieval_is_not_atomic",
          "due_date_is_not_payment_promise",
        ]),
      ],
    };
  }
}
