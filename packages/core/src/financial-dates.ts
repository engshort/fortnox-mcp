import { z } from "zod";
import { accountingDate, accountingHash } from "./accounting.js";
import {
  calculateFinancialReport,
  type FinancialAnalysis,
  financialBasis,
  financialQuery,
} from "./analytics.js";
import type { AccountingActor } from "./bookkeeping.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { sumAmounts } from "./money.js";
import { assertScopeProgram } from "./programs.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const accounts = z
  .array(z.number().int().min(1).max(99999999))
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length);
export const financialYearIndex = z
  .object({
    company_id: z.string().uuid(),
    years: z.array(financialBasis.shape.year).max(500),
    complete: z.boolean(),
    source_version: hash,
    sources: financialBasis.shape.sources,
  })
  .strict();
export interface FinancialYearProvider {
  years(
    actor: AccountingActor,
    company: string,
    until: number,
  ): Promise<z.infer<typeof financialYearIndex>>;
}
const identity = {
  years_version: hash,
  generation: z.number().int().nonnegative().safe(),
};
export const accountBalanceQuery = z
  .object({
    company_id: z.string().uuid(),
    as_of: accountingDate,
    account_numbers: accounts.optional(),
    page_size: z.number().int().min(1).max(50).optional(),
    continuation: financialQuery.shape.continuation
      .unwrap()
      .extend(identity)
      .strict()
      .optional(),
  })
  .strict();
export const transactionContinuation = z
  .object({
    ...identity,
    query_key: hash,
    year_index: z.number().int().min(0).max(499),
    after_movement: z.string().min(1).max(128).nullable(),
    versions: z
      .array(
        z
          .object({
            financial_year: z.number().int().positive().safe(),
            source_version: hash,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const financialTransactionQuery = z
  .object({
    company_id: z.string().uuid(),
    from: accountingDate,
    to: accountingDate,
    account_numbers: accounts.optional(),
    page_size: z.number().int().min(1).max(50).optional(),
    continuation: transactionContinuation.optional(),
  })
  .strict()
  .refine((v) => v.from <= v.to);
const interval = z
  .object({ from: accountingDate, to: accountingDate })
  .strict();
export const financialTransactionResult = z
  .object({
    company_id: z.string().uuid(),
    interval,
    financial_year: financialBasis.shape.year.nullable(),
    financial_years: z.array(financialBasis.shape.year).max(500),
    missing_intervals: z.array(interval).max(501),
    years_complete: z.boolean(),
    history_basis: z.literal("current_records_by_effective_date"),
    consistency: z.literal("not_atomic"),
    data_complete: z.boolean(),
    year_complete: z.boolean(),
    complete: z.boolean(),
    sources: financialBasis.shape.sources.max(2000),
    retrieved: financialBasis.shape.retrieved,
    year_versions: z
      .array(transactionContinuation.shape.versions.element)
      .max(500),
    rows: z
      .array(
        financialBasis.shape.movements.element.extend({
          amount: z
            .string()
            .regex(/^-?\d+\.\d{2}$/)
            .max(68),
          financial_year: z.number().int().positive().safe(),
          currency: financialBasis.shape.currency,
        }),
      )
      .max(50),
    totals_scope: z.literal("returned_page_only"),
    totals: z
      .array(
        z
          .object({
            currency: financialBasis.shape.currency,
            signed_movement: z.string(),
          })
          .strict(),
      )
      .max(1),
    page: z
      .object({
        count: z.number().int().min(0).max(50),
        next: transactionContinuation.nullable(),
        exhausted: z.boolean(),
      })
      .strict(),
    limitations: z.array(z.string().max(128)).max(128),
  })
  .strict();

const nextDay = (date: string, delta: number) =>
  new Date(Date.parse(date) + delta * 86400000).toISOString().slice(0, 10);
const today = (at: number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(at);
const transactionYearComplete = (basis: z.infer<typeof financialBasis>) =>
  basis.coverage.movements &&
  basis.semantics_verified &&
  basis.consistency !== "changed" &&
  basis.movements.every((m) => m.effective !== null) &&
  basis.limitations.every((v) =>
    [
      "retrieval_is_not_atomic",
      "account_mapping_unverified",
      "opening_sources_disagree",
      "closing_sources_disagree",
      "currency_defaults_to_SEK_under_SIE4B",
    ].includes(v),
  );
function gaps(
  years: z.infer<typeof financialBasis.shape.year>[],
  from: string,
  to: string,
) {
  const missing: { from: string; to: string }[] = [];
  let cursor = from;
  for (const year of years) {
    if (year.from > cursor)
      missing.push({ from: cursor, to: nextDay(year.from, -1) });
    if (year.to >= to) return missing;
    cursor = nextDay(year.to, 1);
  }
  if (cursor <= to) missing.push({ from: cursor, to });
  return missing;
}

// No ledger cache: each continuation reauthorizes and rechecks every year it
// previously traversed. Budget exhaustion fails rather than mixing source versions.
export class DatedFinancialAnalysis {
  constructor(
    readonly connections: Connections,
    readonly financial: FinancialAnalysis,
    readonly provider: FinancialYearProvider,
    readonly now = Date.now,
  ) {}

  private async authorize(actor: AccountingActor, company: string) {
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    assertScopeProgram(c, "bookkeeping");
    if (!this.financial.enabled || !c.scopes.includes("bookkeeping"))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  private async index(actor: AccountingActor, company: string, until: number) {
    const index = financialYearIndex.parse(
      await this.provider.years(actor, company, until),
    );
    if (index.company_id !== company)
      throw new DomainError("COMPANY_FORBIDDEN");
    index.years.sort((a, b) => a.from.localeCompare(b.from));
    if (
      new Set(index.years.map((y) => y.id)).size !== index.years.length ||
      index.years.some(
        (y, i) =>
          y.from > y.to || (i > 0 && (index.years[i - 1]?.to ?? "") >= y.from),
      )
    )
      throw new DomainError("UPSTREAM_UNAVAILABLE");
    return index;
  }
  async balances(actor: AccountingActor, input: unknown) {
    const q = accountBalanceQuery.parse(input),
      before = await this.authorize(actor, q.company_id);
    if (q.as_of > today(this.now())) throw new DomainError("VALIDATION_FAILED");
    const until = this.now() + 45000;
    const index = await this.index(actor, q.company_id, until);
    const year = index.years.find((y) => y.from <= q.as_of && y.to >= q.as_of);
    if (!year || !index.complete)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const c = q.continuation;
    if (
      c &&
      (c.years_version !== index.source_version ||
        c.generation !== before.generation)
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const reportQuery = {
      company_id: q.company_id,
      financial_year: year.id,
      from: year.from,
      to: q.as_of,
      ...(q.account_numbers ? { account_numbers: q.account_numbers } : {}),
      ...(q.page_size ? { page_size: q.page_size } : {}),
      ...(c
        ? {
            continuation: {
              after_account: c.after_account,
              source_version: c.source_version,
              query_key: c.query_key,
            },
          }
        : {}),
    };
    const report = calculateFinancialReport(
      reportQuery,
      await this.financial.readBasis(actor, reportQuery, until),
    );
    const after = await this.authorize(actor, q.company_id);
    if (
      before.generation !== after.generation ||
      before.tenant !== after.tenant
    )
      throw new DomainError("CONNECTION_CONFLICT");
    return {
      ...report,
      as_of: q.as_of,
      history_basis: "current_records_by_effective_date" as const,
      accounts_page: {
        ...report.accounts_page,
        next: report.accounts_page.next
          ? {
              ...report.accounts_page.next,
              years_version: index.source_version,
              generation: before.generation,
            }
          : null,
      },
    };
  }
  async transactions(actor: AccountingActor, input: unknown) {
    const q = financialTransactionQuery.parse(input),
      started = this.now(),
      until = started + 45000;
    const before = await this.authorize(actor, q.company_id),
      index = await this.index(actor, q.company_id, until);
    const years = index.years.filter((y) => y.from <= q.to && y.to >= q.from);
    const missing = gaps(years, q.from, q.to);
    const key = await accountingHash([
      q.company_id,
      q.from,
      q.to,
      q.account_numbers ?? null,
    ]);
    const c = q.continuation;
    if (
      c &&
      (c.query_key !== key ||
        c.years_version !== index.source_version ||
        c.generation !== before.generation ||
        c.year_index >= years.length ||
        c.versions.length !==
          c.year_index + (c.after_movement === null ? 0 : 1) ||
        c.versions.some((v, i) => v.financial_year !== years[i]?.id))
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const position = c?.year_index ?? 0,
      year = years[position];
    const versions: z.infer<typeof transactionContinuation>["versions"] = [];
    let priorComplete = true;
    let basis: z.infer<typeof financialBasis> | undefined;
    for (let i = 0; i <= position && i < years.length; i++) {
      if (this.now() >= until) throw new DomainError("UPSTREAM_UNAVAILABLE");
      const y = years[i];
      if (!y) throw new DomainError("UPSTREAM_UNAVAILABLE");
      const b = await this.financial.readBasis(
        actor,
        {
          company_id: q.company_id,
          financial_year: y.id,
          from: q.from > y.from ? q.from : y.from,
          to: q.to < y.to ? q.to : y.to,
        },
        until,
      );
      if (c?.versions[i] && c.versions[i]?.source_version !== b.source_version)
        throw new DomainError("CONNECTION_CONFLICT");
      versions.push({ financial_year: y.id, source_version: b.source_version });
      priorComplete &&= transactionYearComplete(b);
      if (i === position) basis = b;
    }
    const selected = (basis?.movements ?? [])
      .filter(
        (m) =>
          m.effective === true &&
          m.date >= q.from &&
          m.date <= q.to &&
          (!q.account_numbers || q.account_numbers.includes(m.account)),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const offset = c?.after_movement
      ? selected.findIndex((m) => m.id === c.after_movement) + 1
      : 0;
    if (c?.after_movement && offset === 0)
      throw new DomainError("CONNECTION_CONFLICT");
    const rows = selected
      .slice(offset, offset + (q.page_size ?? 50))
      .map((m) => ({
        ...m,
        financial_year: year?.id as number,
        currency: basis?.currency as string,
      }));
    const moreRows = offset + rows.length < selected.length;
    const moreYears = position + 1 < years.length;
    const next =
      moreRows || moreYears
        ? {
            query_key: key,
            years_version: index.source_version,
            generation: before.generation,
            year_index: moreRows ? position : position + 1,
            after_movement: moreRows ? (rows.at(-1)?.id ?? null) : null,
            versions,
          }
        : null;
    const after = await this.authorize(actor, q.company_id);
    if (
      before.generation !== after.generation ||
      before.tenant !== after.tenant
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const yearComplete = !!basis && transactionYearComplete(basis);
    const dataComplete =
      index.complete &&
      missing.length === 0 &&
      priorComplete &&
      yearComplete &&
      !moreYears;
    return financialTransactionResult.parse({
      company_id: q.company_id,
      interval: { from: q.from, to: q.to },
      financial_year: year ?? null,
      financial_years: years,
      missing_intervals: missing,
      years_complete: index.complete,
      history_basis: "current_records_by_effective_date",
      consistency: "not_atomic",
      data_complete: dataComplete,
      year_complete: yearComplete,
      complete: dataComplete && !c && next === null,
      sources: [...index.sources, ...(basis?.sources ?? [])],
      retrieved: { started_at: started, finished_at: this.now() },
      year_versions: versions,
      rows,
      totals_scope: "returned_page_only",
      totals: basis
        ? [
            {
              currency: basis.currency,
              signed_movement: sumAmounts(
                rows.map((r) => r.amount),
                2,
              ),
            },
          ]
        : [],
      page: { count: rows.length, next, exhausted: next === null },
      limitations: [
        ...new Set([
          ...(basis?.limitations ?? []),
          ...(!index.complete ? ["financial_years_incomplete"] : []),
          ...(missing.length ? ["financial_year_gap"] : []),
          ...(!yearComplete ? ["transaction_coverage_unverified"] : []),
          "retrieval_is_not_atomic",
        ]),
      ].slice(0, 128),
    });
  }
}
