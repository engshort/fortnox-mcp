import { Decimal } from "decimal.js";
import { z } from "zod";
import { accountingDate } from "./accounting.js";
import type { AccountingActor } from "./bookkeeping.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { parseAmount, sumAmounts } from "./money.js";
import { assertScopeProgram } from "./programs.js";

const Exact = Decimal.clone({ precision: 96 });
const id = z.string().min(1).max(128);
const accountNumber = z.number().int().min(1).max(99999999);
const amount = z
  .string()
  .max(68)
  .transform((v) => parseAmount(v, 2));
export const financialQuery = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int().positive().safe(),
    from: accountingDate,
    to: accountingDate,
    account_numbers: z.array(accountNumber).min(1).max(100).optional(),
    page_size: z.number().int().min(1).max(50).optional(),
    continuation: z
      .object({
        after_account: accountNumber,
        source_version: z.string().regex(/^[a-f0-9]{64}$/),
        query_key: z.string().max(2048),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.from <= v.to);
export type FinancialQuery = z.infer<typeof financialQuery>;
const comparisonPeriod = z
  .object({
    financial_year: financialQuery.shape.financial_year,
    from: accountingDate,
    to: accountingDate,
  })
  .strict();
export const financialComparisonQuery = z
  .object({
    company_id: z.string().uuid(),
    left: comparisonPeriod,
    right: comparisonPeriod.extend({ company_id: z.string().uuid() }).strict(),
    account_numbers: z.array(accountNumber).min(1).max(50),
  })
  .strict()
  .refine(
    (v) =>
      v.left.from <= v.left.to &&
      v.right.from <= v.right.to &&
      new Set(v.account_numbers).size === v.account_numbers.length,
  );
export const financialAccountsQuery = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int().positive().safe(),
    continuation: z
      .object({
        next_page: z.number().int().min(2).max(10000),
        anchor_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        query_key: z.string().max(1024),
      })
      .strict()
      .optional(),
  })
  .strict();
export const financialMovementQuery = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int().positive().safe(),
    from: accountingDate,
    to: accountingDate,
    account_number: accountNumber,
    page_size: z.number().int().min(1).max(50).optional(),
    continuation: z
      .object({
        after_movement: id,
        source_version: z.string().regex(/^[a-f0-9]{64}$/),
        query_key: z.string().max(2048),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.from <= v.to);
export const financialVoucherReference = z
  .object({
    financial_year: z.number().int().positive().safe(),
    series: z.string().regex(/^[A-Z0-9]{1,8}$/),
    number: z.number().int().positive().safe(),
  })
  .strict();

export const accountCategory = z.enum([
  "assets",
  "liabilities",
  "equity",
  "revenue",
  "expenses",
  "unmapped",
]);
const source = z
  .object({
    operation: id,
    record_id: id,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const financialBasis = z
  .object({
    company_id: z.string().uuid(),
    source_version: z.string().regex(/^[a-f0-9]{64}$/),
    year: z
      .object({
        id: z.number().int().positive().safe(),
        from: accountingDate,
        to: accountingDate,
      })
      .strict(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    accounts: z
      .array(
        z
          .object({
            number: accountNumber,
            name: z.string().max(200),
            active: z.boolean().nullable(),
            opening: amount.nullable(),
            provider_closing: amount.nullable(),
            category: accountCategory,
          })
          .strict(),
      )
      .max(10000),
    movements: z
      .array(
        z
          .object({
            id,
            account: accountNumber,
            date: accountingDate,
            amount,
            effective: z.boolean().nullable(),
            source_ref: id,
            voucher_ref: financialVoucherReference.nullable().optional(),
            dimensions: z.record(id, id),
            description: z.string().max(1000).nullable().optional(),
          })
          .strict(),
      )
      .max(10000),
    sources: z.array(source).min(1).max(1000),
    retrieved: z
      .object({
        started_at: z.number().int().nonnegative().safe(),
        finished_at: z.number().int().nonnegative().safe(),
      })
      .strict(),
    coverage: z
      .object({
        accounts: z.boolean(),
        movements: z.boolean(),
        opening_balances: z.boolean(),
      })
      .strict(),
    semantics_verified: z.boolean(),
    mapping_version: id,
    consistency: z.enum(["not_atomic", "changed", "bounded_recheck"]),
    limitations: z.array(id).max(100),
  })
  .strict();
export type FinancialBasis = z.input<typeof financialBasis>;
export const calculationVersion = "ledger-signed-debit-minus-credit/1";

// This function consumes a server-side provider basis, never model assertions of
// completeness or mapping. No chart-number heuristic assigns a classification.
export function calculateFinancialReport(
  query: FinancialQuery,
  input: FinancialBasis,
) {
  query = financialQuery.parse(query);
  const basis = financialBasis.parse(input);
  if (basis.company_id !== query.company_id)
    throw new DomainError("COMPANY_FORBIDDEN");
  const queryKey = JSON.stringify([
    query.company_id,
    query.financial_year,
    query.from,
    query.to,
    query.account_numbers ?? null,
  ]);
  if (
    query.continuation &&
    (query.continuation.source_version !== basis.source_version ||
      query.continuation.query_key !== queryKey)
  )
    throw new DomainError("CONNECTION_CONFLICT");
  if (
    basis.year.id !== query.financial_year ||
    basis.year.from > basis.year.to ||
    query.from < basis.year.from ||
    query.to > basis.year.to ||
    basis.retrieved.started_at > basis.retrieved.finished_at
  )
    throw new DomainError("VALIDATION_FAILED");
  const limitations = new Set(basis.limitations);
  const numbers = new Set(basis.accounts.map((a) => a.number));
  if (
    numbers.size !== basis.accounts.length ||
    new Set(basis.movements.map((m) => m.id)).size !== basis.movements.length
  )
    throw new DomainError("VALIDATION_FAILED");
  if (
    query.account_numbers &&
    new Set(query.account_numbers).size !== query.account_numbers.length
  )
    throw new DomainError("VALIDATION_FAILED");
  const byAccount = new Map<number, typeof basis.movements>();
  for (const movement of basis.movements) {
    if (
      !numbers.has(movement.account) ||
      movement.date < basis.year.from ||
      movement.date > basis.year.to
    )
      throw new DomainError("VALIDATION_FAILED");
    if (movement.effective === null)
      limitations.add("unknown_effective_row_semantics");
    const rows = byAccount.get(movement.account) ?? [];
    rows.push(movement);
    byAccount.set(movement.account, rows);
  }
  for (const [key, covered] of Object.entries(basis.coverage))
    if (!covered) limitations.add(`incomplete_${key}`);
  if (!basis.semantics_verified)
    limitations.add("provider_semantics_unverified");
  if (basis.consistency === "changed")
    limitations.add("source_changed_during_retrieval");
  if (basis.consistency === "not_atomic")
    limitations.add("retrieval_is_not_atomic");
  for (const number of query.account_numbers ?? [])
    if (!numbers.has(number)) limitations.add("requested_account_missing");
  const all = basis.accounts.map((account) => {
    const rows = byAccount.get(account.number) ?? [];
    const effective = rows.filter((m) => m.effective === true);
    const uncertain = rows.some((m) => m.effective === null);
    const period = sumAmounts(
      effective
        .filter((m) => m.date >= query.from && m.date <= query.to)
        .map((m) => m.amount),
      2,
    );
    const movements = basis.coverage.movements && !uncertain;
    const knownOpening =
      account.opening !== null && basis.coverage.opening_balances;
    if (!knownOpening) limitations.add("opening_balance_missing");
    const asOf =
      movements && knownOpening
        ? sumAmounts(
            [
              account.opening,
              ...effective
                .filter((m) => m.date <= query.to)
                .map((m) => m.amount),
            ],
            2,
          )
        : null;
    const calculatedClosing =
      movements && knownOpening
        ? sumAmounts([account.opening, ...effective.map((m) => m.amount)], 2)
        : null;
    const difference =
      calculatedClosing !== null && account.provider_closing !== null
        ? new Exact(calculatedClosing)
            .minus(account.provider_closing)
            .toFixed(2)
        : null;
    return {
      ...account,
      period_movement: period,
      period_movement_complete: movements,
      balance_as_of: asOf,
      calculated_year_closing: calculatedClosing,
      reconciliation: {
        boundary: basis.year.to,
        difference,
        status:
          difference === null
            ? "unavailable"
            : difference === "0.00"
              ? "matched"
              : "mismatch",
      },
      movement_ids: effective
        .filter((m) => m.date >= query.from && m.date <= query.to)
        .map((m) => m.id)
        .slice(0, 20),
      movement_count: effective.filter(
        (m) => m.date >= query.from && m.date <= query.to,
      ).length,
    };
  });
  // Reconcile the complete chart before narrowing the displayed account list.
  const reconciliation = all.some((a) => a.reconciliation.status === "mismatch")
    ? "mismatch"
    : all.some((a) => a.reconciliation.status === "unavailable") ||
        !basis.coverage.accounts
      ? "unavailable"
      : "matched";
  if (reconciliation !== "matched")
    limitations.add(`reconciliation_${reconciliation}`);
  const selectedAccounts = all.filter(
    (a) => !query.account_numbers || query.account_numbers.includes(a.number),
  );
  const totals = accountCategory.options.map((category) => {
    const selected = selectedAccounts.filter((a) => a.category === category);
    const balances = selected.map((a) => a.balance_as_of);
    return {
      category,
      account_count: selected.length,
      signed_period_movement: sumAmounts(
        selected.map((a) => a.period_movement),
        2,
      ),
      signed_balance: balances.some((a) => a === null)
        ? null
        : sumAmounts(balances, 2),
      // Credit-normal categories use the inverse display sign; the ledger sign
      // and explicit unmapped category remain available without interpretation.
      display_sign: ["liabilities", "equity", "revenue"].includes(category)
        ? -1
        : 1,
    };
  });
  const dataComplete =
    Object.values(basis.coverage).every(Boolean) &&
    basis.semantics_verified &&
    basis.consistency !== "changed" &&
    reconciliation === "matched" &&
    !limitations.has("unknown_effective_row_semantics") &&
    !limitations.has("requested_account_missing") &&
    [...limitations].every((v) => v === "retrieval_is_not_atomic");
  const available = selectedAccounts
    .filter(
      (a) => !query.continuation || a.number > query.continuation.after_account,
    )
    .sort((a, b) => a.number - b.number);
  const pageSize = query.page_size ?? 50;
  const accounts = available.slice(0, pageSize);
  const last = accounts.at(-1);
  const next =
    available.length > pageSize && last
      ? {
          after_account: last.number,
          source_version: basis.source_version,
          query_key: queryKey,
        }
      : null;
  const complete = dataComplete && !query.continuation && next === null;
  return {
    company_id: basis.company_id,
    financial_year: basis.year,
    interval: { from: query.from, to: query.to },
    currency: basis.currency,
    calculation_version: calculationVersion,
    mapping_version: basis.mapping_version,
    source_version: basis.source_version,
    value_origin: "computed" as const,
    provider_value_fields: ["opening", "provider_closing"],
    sources: basis.sources,
    retrieved: basis.retrieved,
    coverage: basis.coverage,
    consistency: basis.consistency,
    complete,
    data_complete: dataComplete,
    accounts_page: {
      count: accounts.length,
      total_in_selection: selectedAccounts.length,
      next,
      exhausted: next === null,
    },
    reconciliation,
    accounts,
    totals,
    totals_scope: "entire_account_selection" as const,
    limitations: [...limitations].sort(),
    bank_balance_kind: "booked_ledger_balance" as const,
  };
}
export type FinancialReport = ReturnType<typeof calculateFinancialReport>;
export interface FinancialProvider {
  basis(
    actor: AccountingActor,
    query: FinancialQuery,
    until?: number,
  ): Promise<FinancialBasis>;
}
export class FinancialAnalysis {
  constructor(
    readonly connections: Connections,
    readonly provider: FinancialProvider,
    readonly enabled = false,
  ) {}
  private async authorize(actor: AccountingActor, company: string) {
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    const current = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    assertScopeProgram(current, "bookkeeping");
    if (!this.enabled || !current.scopes.includes("bookkeeping"))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return current;
  }
  async readBasis(
    actor: AccountingActor,
    query: FinancialQuery,
    until?: number,
  ) {
    query = financialQuery.parse(query);
    const current = await this.authorize(actor, query.company_id);
    const basis = await this.provider.basis(actor, query, until);
    const after = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      query.company_id,
    );
    assertScopeProgram(after, "bookkeeping");
    if (
      after.generation !== current.generation ||
      after.tenant !== current.tenant ||
      !after.scopes.includes("bookkeeping")
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const checked = financialBasis.parse(basis);
    calculateFinancialReport(query, checked);
    return checked;
  }
  async report(actor: AccountingActor, input: unknown) {
    const query = financialQuery.parse(input);
    return calculateFinancialReport(query, await this.readBasis(actor, query));
  }
  async compare(actor: AccountingActor, input: unknown) {
    const value = financialComparisonQuery.parse(input);
    const leftQuery = {
      ...value.left,
      company_id: value.company_id,
      account_numbers: value.account_numbers,
      page_size: 50,
    };
    const rightQuery = {
      ...value.right,
      account_numbers: value.account_numbers,
      page_size: 50,
    };
    // Authorize both companies before any source access, then recheck both
    // after all reads so a disconnect during the other side cannot leak data.
    const before = await Promise.all([
      this.authorize(actor, leftQuery.company_id),
      this.authorize(actor, rightQuery.company_id),
    ]);
    const left = await this.report(actor, leftQuery);
    const right = await this.report(actor, rightQuery);
    const after = await Promise.all([
      this.authorize(actor, leftQuery.company_id),
      this.authorize(actor, rightQuery.company_id),
    ]);
    if (
      before.some(
        (connection, i) =>
          connection.generation !== after[i]?.generation ||
          connection.tenant !== after[i]?.tenant,
      )
    )
      throw new DomainError("CONNECTION_CONFLICT");
    return compareFinancialReports(left, right);
  }
  async movements(actor: AccountingActor, input: unknown) {
    const query = financialMovementQuery.parse(input),
      basis = await this.readBasis(actor, {
        company_id: query.company_id,
        financial_year: query.financial_year,
        from: query.from,
        to: query.to,
      });
    if (basis.company_id !== query.company_id)
      throw new DomainError("COMPANY_FORBIDDEN");
    if (
      basis.year.id !== query.financial_year ||
      query.from < basis.year.from ||
      query.to > basis.year.to
    )
      throw new DomainError("VALIDATION_FAILED");
    // Drill-down must apply the same whole-basis identity, date and row checks.
    calculateFinancialReport(
      {
        company_id: query.company_id,
        financial_year: query.financial_year,
        from: query.from,
        to: query.to,
      },
      basis,
    );
    const queryKey = JSON.stringify([
      query.company_id,
      query.financial_year,
      query.from,
      query.to,
      query.account_number,
    ]);
    if (
      query.continuation &&
      (query.continuation.source_version !== basis.source_version ||
        query.continuation.query_key !== queryKey)
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const selected = basis.movements
      .filter(
        (m) =>
          m.account === query.account_number &&
          m.date >= query.from &&
          m.date <= query.to,
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const prior = query.continuation
      ? selected.findIndex((m) => m.id === query.continuation?.after_movement)
      : -1;
    if (query.continuation && prior < 0)
      throw new DomainError("CONNECTION_CONFLICT");
    const rows = selected
        .slice(prior + 1, prior + 1 + (query.page_size ?? 50))
        .map((r) => ({ ...r, voucher_ref: r.voucher_ref ?? null })),
      last = rows.at(-1);
    const next =
      last && prior + 1 + rows.length < selected.length
        ? {
            after_movement: last.id,
            source_version: basis.source_version,
            query_key: queryKey,
          }
        : null;
    const knownAccount = basis.accounts.some(
      (a) => a.number === query.account_number,
    );
    const dataComplete =
      knownAccount &&
      basis.coverage.movements &&
      basis.semantics_verified &&
      basis.consistency !== "changed" &&
      basis.limitations.every((v) => v === "retrieval_is_not_atomic") &&
      selected.every((m) => m.effective !== null);
    return {
      company_id: basis.company_id,
      financial_year: basis.year,
      interval: { from: query.from, to: query.to },
      account_number: query.account_number,
      account_known: knownAccount,
      currency: basis.currency,
      source_version: basis.source_version,
      sources: basis.sources,
      retrieved: basis.retrieved,
      coverage: basis.coverage,
      consistency: basis.consistency,
      semantics_verified: basis.semantics_verified,
      complete: dataComplete && !query.continuation && next === null,
      data_complete: dataComplete,
      rows,
      page: {
        count: rows.length,
        total_in_selection: selected.length,
        next,
        exhausted: next === null,
      },
      limitations: [
        ...new Set([
          ...basis.limitations,
          ...(!knownAccount ? ["requested_account_missing"] : []),
          ...(!basis.coverage.movements ? ["incomplete_movements"] : []),
          ...(!basis.semantics_verified
            ? ["provider_semantics_unverified"]
            : []),
        ]),
      ].sort(),
      value_origin: "provider_export" as const,
      reference_origin: "parsed_provider_export" as const,
    };
  }
}

export function compareFinancialReports(
  left: FinancialReport,
  right: FinancialReport,
) {
  const compatible =
    left.currency === right.currency &&
    left.mapping_version === right.mapping_version &&
    left.calculation_version === right.calculation_version &&
    JSON.stringify(left.accounts.map((a) => a.number).sort((a, b) => a - b)) ===
      JSON.stringify(right.accounts.map((a) => a.number).sort((a, b) => a - b));
  return {
    left,
    right,
    compatible,
    complete: compatible && left.complete && right.complete,
    consolidated: false,
    converted_currency: false,
    differences: compatible
      ? left.totals.map((a) => {
          const b = right.totals.find((v) => v.category === a.category);
          return {
            category: a.category,
            signed_period_movement: b
              ? new Exact(b.signed_period_movement)
                  .minus(a.signed_period_movement)
                  .toFixed(2)
              : null,
          };
        })
      : [],
  };
}
