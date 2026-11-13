import { z } from "zod";
import { accountingDate } from "./accounting.js";
import { type FinancialAnalysis, financialBasis } from "./analytics.js";
import type { AccountingActor } from "./bookkeeping.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { sumAmounts } from "./money.js";
import { type OpenItems, openItemQuery, openItemSource } from "./open-items.js";
import { assertScopeProgram } from "./programs.js";

const account = z.number().int().min(1).max(99999999),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const money = z
  .string()
  .regex(/^-?\d+\.\d{2}$/)
  .max(68);
export const liquidityQuery = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int().positive().safe(),
    as_of: accountingDate,
    cash_account_numbers: z.array(account).min(1).max(20),
    expected_from: accountingDate,
    expected_to: accountingDate,
    settlement_assumption: z.literal("due_date_only"),
  })
  .strict()
  .refine(
    (v) =>
      v.expected_from >= v.as_of &&
      v.expected_to >= v.expected_from &&
      Date.parse(v.expected_to) - Date.parse(v.as_of) <= 90 * 86400000 &&
      new Set(v.cash_account_numbers).size === v.cash_account_numbers.length,
  );
const flowSummary = z
  .object({
    amount: money.nullable(),
    included_ids: z.array(z.string().max(20)).max(100),
    other_currency_count: z.number().int().min(0).max(100),
    unknown_count: z.number().int().min(0).max(100),
    outside_interval_count: z.number().int().min(0).max(100),
    source_collection_complete: z.boolean(),
    balance_semantics_verified: z.boolean(),
    next: openItemQuery.shape.continuation.unwrap().nullable(),
  })
  .strict();
export const liquidityResult = z
  .object({
    calculation_version: z.literal("liquidity/1"),
    company_id: z.string().uuid(),
    financial_year: financialBasis.shape.year,
    observation_day: accountingDate,
    currency: financialBasis.shape.currency,
    interval: z.object({ from: accountingDate, to: accountingDate }).strict(),
    settlement_assumption: z.literal("due_date_only"),
    consistency: z.literal("not_atomic"),
    value_origin: z.literal("computed"),
    currency_conversion: z.literal(false),
    booked_balance: z
      .object({
        amount: money.nullable(),
        kind: z.literal("booked_ledger_not_live_bank"),
        account_numbers: z.array(account).max(20),
        source_complete: z.boolean(),
        cash_classification_verified: z.boolean(),
        mapping_version: z.string().max(128).nullable(),
        mapping_sha256: hash.nullable(),
      })
      .strict(),
    expected_flows: z
      .object({
        receivables: flowSummary,
        payables: flowSummary,
        net: money.nullable(),
      })
      .strict(),
    projected_selected_balance: money.nullable(),
    projection_scope: z.literal("selected_accounts_and_returned_invoice_pages"),
    complete: z.boolean(),
    ledger_source_version: hash,
    ledger_mapping_version: z.string().min(1).max(128),
    ledger_calculation_version: z.string().min(1).max(128),
    sources: z.array(openItemSource).min(1).max(3204),
    retrieved: financialBasis.shape.retrieved,
    limitations: z.array(z.string().max(128)).max(128),
  })
  .strict();
export interface CashAccountMapping {
  account_numbers: readonly number[];
  version: string;
  sha256: string;
}
const day = (at: number) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
export class LiquidityAnalysis {
  constructor(
    readonly connections: Connections,
    readonly financial: FinancialAnalysis,
    readonly openItems: OpenItems,
    readonly enabled = false,
    readonly now = Date.now,
    readonly cashMapping?: (
      company: string,
      year: number,
    ) => CashAccountMapping | undefined,
  ) {}
  private async authorize(actor: AccountingActor, company: string) {
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    for (const scope of ["bookkeeping", "invoice", "supplierinvoice"]) {
      assertScopeProgram(c, scope);
      if (!this.enabled || !c.scopes.includes(scope))
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    }
    return c;
  }
  async basis(actor: AccountingActor, input: unknown) {
    const query = liquidityQuery.parse(input),
      started = this.now();
    if (query.as_of > day(started)) throw new DomainError("VALIDATION_FAILED");
    const before = await this.authorize(actor, query.company_id);
    if (query.as_of < day(started) && !this.openItems.provider.history)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const ledger = await this.financial.report(actor, {
      company_id: query.company_id,
      financial_year: query.financial_year,
      from: query.as_of,
      to: query.as_of,
      account_numbers: query.cash_account_numbers,
      page_size: 20,
    });
    const receivables = await this.openItems.list(actor, {
      company_id: query.company_id,
      kind: "receivable",
      ...(query.as_of < day(started) ? { as_of: query.as_of } : {}),
    });
    const payables = await this.openItems.list(actor, {
      company_id: query.company_id,
      kind: "payable",
      ...(query.as_of < day(started) ? { as_of: query.as_of } : {}),
    });
    const after = await this.authorize(actor, query.company_id);
    if (
      before.generation !== after.generation ||
      before.tenant !== after.tenant ||
      day(this.now()) !== day(started) ||
      (receivables.observation_point === "computed_as_of"
        ? receivables.as_of !== query.as_of
        : receivables.observation_day !== query.as_of) ||
      (payables.observation_point === "computed_as_of"
        ? payables.as_of !== query.as_of
        : payables.observation_day !== query.as_of)
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const mapping = this.cashMapping?.(query.company_id, query.financial_year);
    const classified =
      !!mapping &&
      /^[a-f0-9]{64}$/.test(mapping.sha256) &&
      mapping.version.length > 0 &&
      mapping.version.length <= 128 &&
      query.cash_account_numbers.every((n) =>
        mapping.account_numbers.includes(n),
      );
    const balances = ledger.accounts.map((r) => r.balance_as_of);
    const booked =
      ledger.accounts.length !== query.cash_account_numbers.length ||
      balances.some((v) => v === null)
        ? null
        : sumAmounts(balances, 2);
    const flow = (source: typeof receivables) => {
      let unknown = 0,
        foreign = 0,
        outside = 0;
      const included: Array<{ id: string; amount: string }> = [];
      for (const r of source.records) {
        if (
          r.currency === null ||
          r.due_date === null ||
          r.open_status !== "open"
        ) {
          unknown++;
          continue;
        }
        if (r.currency !== ledger.currency) {
          foreign++;
          continue;
        }
        if (
          r.due_date < query.expected_from ||
          r.due_date > query.expected_to
        ) {
          outside++;
          continue;
        }
        if (r.expected_signed_cash_flow === null) {
          unknown++;
          continue;
        }
        included.push({ id: r.id, amount: r.expected_signed_cash_flow });
      }
      return {
        amount:
          source.balance_semantics_verified && unknown === 0
            ? sumAmounts(
                included.map((r) => r.amount),
                2,
              )
            : null,
        included_ids: included.map((r) => r.id),
        other_currency_count: foreign,
        unknown_count: unknown,
        outside_interval_count: outside,
        source_collection_complete: source.complete,
        balance_semantics_verified: source.balance_semantics_verified,
        next: source.page.next,
      };
    };
    const incoming = flow(receivables),
      outgoing = flow(payables);
    const net =
      incoming.amount === null || outgoing.amount === null
        ? null
        : sumAmounts([incoming.amount, outgoing.amount], 2);
    const complete =
      classified &&
      ledger.complete &&
      receivables.complete &&
      payables.complete &&
      net !== null &&
      booked !== null &&
      incoming.other_currency_count === 0 &&
      outgoing.other_currency_count === 0;
    return liquidityResult.parse({
      calculation_version: "liquidity/1",
      company_id: query.company_id,
      financial_year: ledger.financial_year,
      observation_day: query.as_of,
      currency: ledger.currency,
      interval: { from: query.expected_from, to: query.expected_to },
      settlement_assumption: query.settlement_assumption,
      consistency: "not_atomic",
      value_origin: "computed",
      currency_conversion: false,
      booked_balance: {
        amount: booked,
        kind: "booked_ledger_not_live_bank",
        account_numbers: query.cash_account_numbers,
        source_complete: ledger.complete,
        cash_classification_verified: classified,
        mapping_version: classified ? mapping?.version : null,
        mapping_sha256: classified ? mapping?.sha256 : null,
      },
      expected_flows: { receivables: incoming, payables: outgoing, net },
      projected_selected_balance:
        booked === null || net === null ? null : sumAmounts([booked, net], 2),
      projection_scope: "selected_accounts_and_returned_invoice_pages",
      complete,
      ledger_source_version: ledger.source_version,
      ledger_mapping_version: ledger.mapping_version,
      ledger_calculation_version: ledger.calculation_version,
      sources: [...ledger.sources, ...receivables.sources, ...payables.sources],
      retrieved: { started_at: started, finished_at: this.now() },
      limitations: [
        ...new Set([
          ...ledger.limitations,
          ...receivables.limitations,
          ...payables.limitations,
          ...(!classified ? ["cash_account_classification_unverified"] : []),
          ...(!complete ? ["liquidity_basis_not_complete"] : []),
          ...(incoming.other_currency_count + outgoing.other_currency_count > 0
            ? ["other_currencies_not_converted"]
            : []),
          "future_settlement_is_an_assumption",
          "projection_excludes_future_uncreated_documents",
        ]),
      ].sort(),
    });
  }
}
