import {
  type AccountingActor,
  type accountCategory,
  accountingDate,
  accountingHash,
  type Connections,
  DomainError,
  type FinancialBasis,
  type FinancialProvider,
  type FinancialQuery,
  financialAccountsQuery,
  largeSieLimits,
  parseAmount,
  parseSie4,
  type SieExport,
  SieLimitError,
  sieLimits,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";

export const financialReadOperations = [
  "financial.accounts",
  "financial.account",
  "financial.year",
  "financial.years",
  "financial.sie4",
  "financial.voucher",
] as const;
export type FinancialReadOperation = (typeof financialReadOperations)[number];
const integer = z
  .string()
  .regex(/^\d{1,8}$/)
  .transform(Number);
const number = integer.refine((v) => v > 0);
const money = z
  .string()
  .max(68)
  .transform((v) => parseAmount(v, 2));
const providerAccount = z.object({
  Number: number,
  Description: z.string().max(200),
  Active: z.boolean(),
  Year: number,
  BalanceBroughtForward: money.nullish(),
  BalanceCarriedForward: money.nullish(),
});
const year = z.object({
  Id: number,
  FromDate: accountingDate,
  ToDate: accountingDate,
});
const meta = z.object({
  "@CurrentPage": integer,
  "@TotalPages": integer,
  "@TotalResources": integer.optional(),
});
export interface FinancialMapping {
  version: string;
  sha256: string;
  accounts: Readonly<Record<number, z.infer<typeof accountCategory>>>;
}
// Trusted installation evidence only, never accepted from an MCP argument.
export interface FinancialVerification {
  sha256: string;
  version: string;
  full_export: boolean;
  effective_rows: boolean;
  omitted_zero_openings: boolean;
}
export interface FinancialReadMetric {
  operation:
    | "financial.year"
    | "financial.accounts"
    | "financial.sie4"
    | "sie.parse"
    | "basis";
  bytes?: number;
  duration_ms: number;
  outcome: "ok" | "error" | "reused";
}
export interface FinancialBuild {
  company_id: string;
  financial_year: number;
  start: number;
  financialYear: {
    id: number;
    from: string;
    to: string;
    source: FinancialBasis["sources"][number];
  };
  first: SieExport;
  chart: z.infer<typeof providerAccount>[];
  sources: FinancialBasis["sources"];
  chartComplete: boolean;
  page: number | null;
  bytes: number;
}
// Fixed read operations only. Mapping is supplied by trusted installation code,
// never by a model argument. It classifies explicit accounts, not number ranges.
export class FortnoxFinancialReads implements FinancialProvider {
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly enabled: readonly FinancialReadOperation[] = [],
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
    readonly mapping?: (
      company: string,
      year: number,
    ) => FinancialMapping | undefined,
    readonly verification?: (
      company: string,
      year: number,
    ) => FinancialVerification | undefined,
    readonly options: {
      large?: boolean;
      observe?: (metric: FinancialReadMetric) => void;
    } = {},
  ) {
    if (
      new Set(enabled).size !== enabled.length ||
      enabled.some((id) => !financialReadOperations.includes(id))
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    this.http = new DocumentHttp(
      connections,
      provider,
      enabled,
      active,
      now,
      options.large ? largeSieLimits.bytes : sieLimits.bytes,
    );
  }
  metric(value: FinancialReadMetric) {
    // Observability must never change a financial outcome. No payload/identity labels.
    try {
      this.options.observe?.(value);
    } catch {
      /* optional sink */
    }
  }
  async profileVersion(company: string, year: number) {
    return accountingHash({
      parser: "sie4-incremental/2",
      large: this.options.large === true,
      calculation: "ledger-signed-debit-minus-credit/1",
      mapping: this.mapping?.(company, year) ?? null,
      verification: this.verification?.(company, year) ?? null,
    });
  }
  async years(
    actor: AccountingActor,
    company: string,
    until = this.now() + 30000,
  ) {
    const context = await this.context(actor, company, "financial.years");
    const years: { id: number; from: string; to: string }[] = [];
    const sources: FinancialBasis["sources"] = [];
    let complete = false;
    for (let page = 1; page <= 5 && this.now() < until; page++) {
      const url = new URL("https://api.fortnox.se/3/financialyears");
      url.search = new URLSearchParams({
        page: String(page),
        limit: "100",
      }).toString();
      const tick = this.now();
      const raw = await this.http.read(context, url, until);
      this.metric({
        operation: "financial.year",
        duration_ms: this.now() - tick,
        outcome: "ok",
      });
      const records = z.array(year).max(100).parse(raw.FinancialYears);
      const metadata = meta.safeParse(raw.MetaInformation);
      sources.push({
        operation: "financial.years",
        record_id: String(page),
        sha256: await accountingHash(raw),
      });
      for (const record of records) {
        if (
          record.FromDate > record.ToDate ||
          years.some((y) => y.id === record.Id)
        )
          throw new ProviderError(
            "UPSTREAM_UNAVAILABLE",
            "ambiguous_financial_years",
          );
        years.push({ id: record.Id, from: record.FromDate, to: record.ToDate });
      }
      if (!metadata.success) break;
      if (
        metadata.data["@CurrentPage"] !== page &&
        !(
          page === 1 &&
          records.length === 0 &&
          metadata.data["@TotalPages"] === 0
        )
      )
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
      if (page >= metadata.data["@TotalPages"]) {
        complete = true;
        break;
      }
    }
    if (!sources.length)
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "read_budget_exhausted");
    return {
      company_id: company,
      years,
      complete,
      sources,
      source_version: await accountingHash({ years, complete }),
    };
  }
  private context(
    actor: AccountingActor,
    company: string,
    op: FinancialReadOperation,
  ) {
    z.string().uuid().parse(company);
    return this.http.context(actor, company, op, "bookkeeping");
  }
  async financialYear(
    actor: AccountingActor,
    company: string,
    id: number,
    until = Infinity,
  ) {
    z.number().int().positive().safe().parse(id);
    const context = await this.context(actor, company, "financial.year");
    const tick = this.now();
    const raw = await this.http.read(
      context,
      new URL(`https://api.fortnox.se/3/financialyears/${id}`),
      until,
    );
    this.metric({
      operation: "financial.year",
      duration_ms: this.now() - tick,
      outcome: "ok",
    });
    const parsed = year.parse(raw.FinancialYear);
    if (parsed.Id !== id || parsed.FromDate > parsed.ToDate)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "financial_year_mismatch",
      );
    return {
      id: parsed.Id,
      from: parsed.FromDate,
      to: parsed.ToDate,
      source: {
        operation: "financial.year",
        record_id: String(id),
        sha256: await accountingHash(raw),
      },
    };
  }
  async accountPage(
    actor: AccountingActor,
    company: string,
    financialYear: number,
    page = 1,
    until = Infinity,
  ) {
    z.number().int().positive().safe().parse(financialYear);
    z.number().int().min(1).max(10000).parse(page);
    const context = await this.context(actor, company, "financial.accounts");
    const url = new URL("https://api.fortnox.se/3/accounts");
    url.search = new URLSearchParams({
      financialyear: String(financialYear),
      page: String(page),
      limit: "100",
      sortby: "number",
    }).toString();
    const tick = this.now();
    const raw = await this.http.read(context, url, until);
    this.metric({
      operation: "financial.accounts",
      duration_ms: this.now() - tick,
      outcome: "ok",
    });
    const records = z.array(providerAccount).max(100).parse(raw.Accounts);
    if (
      records.some((r) => r.Year !== financialYear) ||
      new Set(records.map((r) => r.Number)).size !== records.length
    )
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "account_year_or_identity_mismatch",
      );
    const m = meta.safeParse(raw.MetaInformation);
    const valid =
      m.success &&
      ((m.data["@CurrentPage"] === page && m.data["@TotalPages"] >= page) ||
        (page === 1 &&
          records.length === 0 &&
          m.data["@TotalPages"] === 0 &&
          m.data["@CurrentPage"] <= 1));
    if (m.success && !valid)
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
    const next =
      valid && m.success && page < m.data["@TotalPages"] ? page + 1 : null;
    return {
      records,
      complete: valid && next === null,
      next_page: next,
      total_resources:
        valid && m.success ? (m.data["@TotalResources"] ?? null) : null,
      source: {
        operation: "financial.accounts",
        record_id: `${financialYear}:${page}`,
        sha256: await accountingHash(raw),
      },
    };
  }
  async accounts(actor: AccountingActor, input: unknown) {
    const query = financialAccountsQuery.parse(input),
      started = this.now();
    const connection = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      query.company_id,
    );
    const key = JSON.stringify([
      "financial-accounts/1",
      query.company_id,
      query.financial_year,
    ]);
    if (query.continuation && query.continuation.query_key !== key)
      throw new DomainError("CONNECTION_CONFLICT");
    const first = await this.accountPage(
      actor,
      query.company_id,
      query.financial_year,
      1,
      started + 30000,
    );
    const page = query.continuation?.next_page ?? 1;
    if (
      query.continuation &&
      (query.continuation.query_key !== key ||
        query.continuation.anchor_sha256 !== first.source.sha256 ||
        first.next_page === null)
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const current =
      page === 1
        ? first
        : await this.accountPage(
            actor,
            query.company_id,
            query.financial_year,
            page,
            started + 30000,
          );
    if (page !== 1) {
      const check = await this.accountPage(
        actor,
        query.company_id,
        query.financial_year,
        1,
        started + 30000,
      );
      if (check.source.sha256 !== first.source.sha256)
        throw new DomainError("CONNECTION_CONFLICT");
    }
    const after = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      query.company_id,
    );
    if (
      after.generation !== connection.generation ||
      after.tenant !== connection.tenant
    )
      throw new DomainError("CONNECTION_CONFLICT");
    return {
      company_id: query.company_id,
      financial_year: query.financial_year,
      records: current.records.map((r) => ({
        number: r.Number,
        name: r.Description,
        active: r.Active,
        opening: r.BalanceBroughtForward ?? null,
        provider_closing: r.BalanceCarriedForward ?? null,
      })),
      complete:
        page === 1 &&
        current.complete &&
        (current.total_resources === null ||
          current.total_resources === current.records.length),
      coverage: "chart_records_only" as const,
      page: {
        number: page,
        metadata_verified: current.complete || current.next_page !== null,
        exhausted: current.complete,
        total_records: current.total_resources,
        next:
          current.next_page === null
            ? null
            : {
                next_page: current.next_page,
                anchor_sha256: first.source.sha256,
                query_key: key,
              },
      },
      sources: page === 1 ? [current.source] : [first.source, current.source],
      retrieved: { started_at: started, finished_at: this.now() },
      consistency: "not_atomic" as const,
      value_origin: "provider" as const,
      currency: null,
      balance_units_verified: false as const,
    };
  }
  async account(
    actor: AccountingActor,
    company: string,
    financialYear: number,
    accountNumber: number,
  ) {
    z.number().int().positive().safe().parse(financialYear);
    z.number().int().min(1000).max(9999).parse(accountNumber);
    const context = await this.context(actor, company, "financial.account"),
      url = new URL(`https://api.fortnox.se/3/accounts/${accountNumber}`);
    url.searchParams.set("financialyear", String(financialYear));
    const raw = await this.http.read(context, url),
      record = providerAccount.parse(raw.Account);
    if (record.Number !== accountNumber || record.Year !== financialYear)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "account_year_or_identity_mismatch",
      );
    return {
      company_id: company,
      financial_year: financialYear,
      record: {
        number: record.Number,
        name: record.Description,
        active: record.Active,
        opening: record.BalanceBroughtForward ?? null,
        provider_closing: record.BalanceCarriedForward ?? null,
      },
      source: {
        operation: "financial.account",
        record_id: `${financialYear}:${accountNumber}`,
        sha256: await accountingHash(raw),
      },
      value_origin: "provider" as const,
      currency: null,
      balance_units_verified: false,
      complete: false,
    };
  }
  async sie(
    actor: AccountingActor,
    company: string,
    financialYear: number,
    until = Infinity,
    reuse?: SieExport,
  ): Promise<SieExport> {
    z.number().int().positive().safe().parse(financialYear);
    const context = await this.context(actor, company, "financial.sie4");
    const url = new URL("https://api.fortnox.se/3/sie/4");
    // exportall/selection values are not assumed from their untyped API schema.
    // Their actual zero/inactive coverage remains a separate acceptance gate.
    url.searchParams.set("financialyear", String(financialYear));
    const started = this.now();
    const response = await this.http.readSie(context, url, until);
    this.metric({
      operation: "financial.sie4",
      bytes: response.bytes.length,
      duration_ms: this.now() - started,
      outcome: "ok",
    });
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(response.bytes)),
    );
    const hash = Array.from(digest, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const encoding = /charset\s*=\s*"?utf-?8/i.test(response.content_type ?? "")
      ? "utf8"
      : "cp437";
    if (reuse?.sha256 === hash && reuse.encoding === encoding) {
      this.metric({
        operation: "sie.parse",
        duration_ms: 0,
        outcome: "reused",
      });
      return reuse;
    }
    const parseStarted = this.now();
    try {
      const parsed = await parseSie4(
        response.bytes,
        encoding,
        this.options.large ? largeSieLimits : sieLimits,
      );
      this.metric({
        operation: "sie.parse",
        duration_ms: this.now() - parseStarted,
        outcome: "ok",
      });
      return parsed;
    } catch (error) {
      this.metric({
        operation: "sie.parse",
        duration_ms: this.now() - parseStarted,
        outcome: "error",
      });
      if (error instanceof SieLimitError)
        throw new ProviderError(
          "CAPABILITY_UNAVAILABLE",
          `sie_${error.limit}_limit_${error.maximum}_use_bounded_analysis_or_larger_runtime`,
        );
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "unsupported_or_invalid_sie4",
      );
    }
  }
  async voucher(
    actor: AccountingActor,
    company: string,
    financialYear: number,
    series: string,
    number: number,
  ) {
    z.number().int().positive().safe().parse(financialYear);
    z.string()
      .regex(/^[A-Z0-9]{1,8}$/)
      .parse(series);
    z.number().int().positive().safe().parse(number);
    const context = await this.context(actor, company, "financial.voucher");
    const url = new URL(
      `https://api.fortnox.se/3/vouchers/${series}/${number}`,
    );
    url.searchParams.set("financialyear", String(financialYear));
    const raw = await this.http.read(context, url);
    const v = z
      .object({
        Year: integer,
        VoucherNumber: integer,
        VoucherSeries: z.string(),
        TransactionDate: accountingDate,
        VoucherRows: z
          .array(
            z.object({
              Account: integer,
              Debit: money,
              Credit: money,
              Removed: z.boolean().nullish(),
              TransactionDate: accountingDate.nullish(),
            }),
          )
          .max(1000),
      })
      .parse(raw.Voucher);
    if (
      v.Year !== financialYear ||
      v.VoucherNumber !== number ||
      v.VoucherSeries !== series
    )
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "voucher_identity_mismatch",
      );
    return {
      company_id: company,
      financial_year: financialYear,
      series,
      number,
      date: v.TransactionDate,
      rows: v.VoucherRows.map((r, index) => ({
        source_row: index,
        account: r.Account,
        debit: r.Debit,
        credit: r.Credit,
        removed: r.Removed ?? null,
        date: r.TransactionDate ?? v.TransactionDate,
      })),
      source_sha256: await accountingHash(raw),
      row_semantics_verified: false,
      complete: true,
    };
  }
  async beginBuild(
    actor: AccountingActor,
    query: FinancialQuery,
    deadline = Infinity,
  ): Promise<FinancialBuild> {
    const start = this.now(),
      until = Math.min(start + 45000, deadline);
    const financialYear = await this.financialYear(
      actor,
      query.company_id,
      query.financial_year,
      until,
    );
    if (query.from < financialYear.from || query.to > financialYear.to)
      throw new DomainError("VALIDATION_FAILED");
    const first = await this.sie(
      actor,
      query.company_id,
      query.financial_year,
      until,
    );
    const sourceYear = first.years.find((y) => y.index === 0);
    if (
      sourceYear?.from !== financialYear.from ||
      sourceYear.to !== financialYear.to
    )
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "sie_year_mismatch");
    return {
      company_id: query.company_id,
      financial_year: query.financial_year,
      start,
      financialYear,
      first,
      chart: [],
      sources: [
        financialYear.source,
        {
          operation: "financial.sie4",
          record_id: `${query.financial_year}:first`,
          sha256: first.sha256,
        },
      ],
      chartComplete: false,
      page: 1,
      bytes: 0,
    };
  }
  async advanceChart(
    actor: AccountingActor,
    build: FinancialBuild,
    until: number,
  ) {
    if (build.page === null) return;
    const result = await this.accountPage(
      actor,
      build.company_id,
      build.financial_year,
      build.page,
      until,
    );
    build.sources.push(result.source);
    build.bytes += new TextEncoder().encode(
      JSON.stringify(result.records),
    ).length;
    if (
      build.chart.length + result.records.length > 10000 ||
      build.bytes > 2097152 ||
      build.page > 100
    )
      throw new ProviderError(
        "CAPABILITY_UNAVAILABLE",
        "chart_limit_select_smaller_basis",
      );
    const existing = new Set(build.chart.map((r) => r.Number));
    if (result.records.some((r) => existing.has(r.Number)))
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "duplicate_account");
    build.chart.push(...result.records);
    build.chartComplete = result.complete;
    build.page = result.next_page;
  }
  async finishBuild(
    actor: AccountingActor,
    build: FinancialBuild,
    until: number,
  ): Promise<FinancialBasis> {
    if (build.page !== null) throw new DomainError("PARTIAL_RESULT");
    const { first, financialYear, sources, chartComplete, start } = build;
    const query = {
      company_id: build.company_id,
      financial_year: build.financial_year,
    };
    const sourceAccounts = new Map(
      first.accounts.filter((a) => a.name !== null).map((a) => [a.number, a]),
    );
    const chart = new Map(build.chart.map((a) => [a.Number, a]));
    const limitations = new Set(
      first.limitations.filter(
        (v) =>
          ![
            "export_coverage_unverified",
            "missing_zero_balances_unverified",
            "currency_missing",
          ].includes(v),
      ),
    );
    const verification = this.verification?.(
      query.company_id,
      query.financial_year,
    );
    if (
      verification &&
      (!/^[a-f0-9]{64}$/.test(verification.sha256) ||
        !verification.version ||
        verification.version.length > 128)
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (!verification?.full_export)
      limitations.add("export_coverage_unverified");
    if (verification)
      sources.push({
        operation: "financial_verification",
        record_id: verification.version,
        sha256: verification.sha256,
      });
    const mapping = this.mapping?.(query.company_id, query.financial_year);
    if (
      mapping &&
      (!/^[a-f0-9]{64}$/.test(mapping.sha256) ||
        !mapping.version ||
        mapping.version.length > 128)
    )
      throw new DomainError("VALIDATION_FAILED");
    if (mapping)
      sources.push({
        operation: "explicit_account_mapping",
        record_id: mapping.version,
        sha256: mapping.sha256,
      });
    const numbers = [
      ...new Set([...sourceAccounts.keys(), ...chart.keys()]),
    ].sort((a, b) => a - b);
    const accounts = numbers.map((number) => {
      const api = chart.get(number),
        sie = sourceAccounts.get(number),
        balance = sie?.balances.find((b) => b.year === 0);
      const openingConflict =
        api?.BalanceBroughtForward != null &&
        balance?.opening != null &&
        api.BalanceBroughtForward !== balance.opening;
      const closingConflict =
        api?.BalanceCarriedForward != null &&
        balance?.closing != null &&
        api.BalanceCarriedForward !== balance.closing;
      if (openingConflict) limitations.add("opening_sources_disagree");
      if (closingConflict) limitations.add("closing_sources_disagree");
      return {
        number,
        name: api?.Description ?? sie?.name ?? "",
        active: api?.Active ?? null,
        opening: openingConflict
          ? null
          : (api?.BalanceBroughtForward ??
            balance?.opening ??
            (verification?.omitted_zero_openings && sie ? "0.00" : null)),
        provider_closing: closingConflict
          ? null
          : (api?.BalanceCarriedForward ?? balance?.closing ?? null),
        category: mapping?.accounts[number] ?? ("unmapped" as const),
      };
    });
    const movements = first.movements.map((m) => ({
      id: m.id,
      account: m.account,
      date: m.date,
      amount: m.amount,
      effective: true,
      source_ref: `${query.financial_year}:${m.voucher.series}:${m.voucher.number}`,
      voucher_ref:
        /^[A-Z0-9]{1,8}$/.test(m.voucher.series) &&
        /^[1-9]\d{0,9}$/.test(m.voucher.number)
          ? {
              financial_year: query.financial_year,
              series: m.voucher.series,
              number: Number(m.voucher.number),
            }
          : null,
      dimensions: m.dimensions,
      ...(m.description !== undefined ? { description: m.description } : {}),
    }));
    const second = await this.sie(
      actor,
      query.company_id,
      query.financial_year,
      until,
      first,
    );
    sources.push({
      operation: "financial.sie4",
      record_id: `${query.financial_year}:recheck`,
      sha256: second.sha256,
    });
    const effectiveHash = (sie: SieExport) =>
      accountingHash({
        currency: sie.currency,
        years: sie.years,
        accounts: sie.accounts,
        movements: sie.movements,
        period_balances: sie.period_balances,
        limitations: sie.limitations,
      });
    const changed =
      (await effectiveHash(first)) !== (await effectiveHash(second));
    if (changed) limitations.add("source_changed_during_retrieval");
    if (!first.currency)
      limitations.add("currency_defaults_to_SEK_under_SIE4B");
    const currency = first.currency ?? "SEK"; // Explicit SIE4B #VALUTA default, disclosed above.
    const normalized = {
      company_id: query.company_id,
      financial_year: query.financial_year,
      mapping_version: mapping?.version ?? "unmapped/1",
      mapping_sha256: mapping?.sha256 ?? null,
      verification: verification ?? null,
      limitations: [...limitations].sort(),
      period_balances: first.period_balances,
      currency,
      accounts,
      movements,
    };
    return {
      company_id: query.company_id,
      source_version: await accountingHash(normalized),
      year: {
        id: financialYear.id,
        from: financialYear.from,
        to: financialYear.to,
      },
      currency,
      accounts,
      movements,
      sources,
      retrieved: { started_at: start, finished_at: this.now() },
      coverage: {
        accounts: chartComplete,
        movements:
          verification?.full_export === true &&
          verification.effective_rows &&
          !first.limitations.some(
            (v) =>
              v !== "export_coverage_unverified" &&
              v !== "missing_zero_balances_unverified" &&
              v !== "currency_missing",
          ) &&
          !changed,
        opening_balances: accounts.every((a) => a.opening !== null),
      },
      semantics_verified: verification?.effective_rows === true,
      mapping_version: mapping?.version ?? "unmapped/1",
      consistency: changed ? "changed" : "bounded_recheck",
      limitations: [...limitations].sort(),
    };
  }
  async beginAnalysisYear(
    actor: AccountingActor,
    query: FinancialQuery,
    until: number,
  ) {
    const { first, ...cursor } = await this.beginBuild(actor, query, until);
    return { source: first, cursor };
  }
  async advanceAnalysisYear(
    actor: AccountingActor,
    input: unknown,
    source: () => Promise<unknown>,
    until: number,
  ) {
    const cursor = input as Omit<FinancialBuild, "first">;
    if (cursor.page !== null) {
      // Chart pages never load, decrypt or re-encrypt the immutable SIE dataset.
      const build = { ...cursor, first: undefined as unknown as SieExport };
      await this.advanceChart(actor, build, until);
      const { first: _first, ...next } = build;
      return { cursor: next };
    }
    const first = (await source()) as SieExport;
    return {
      basis: await this.finishBuild(actor, { ...cursor, first }, until),
    };
  }
  async basis(
    actor: AccountingActor,
    query: FinancialQuery,
    deadline = Infinity,
  ): Promise<FinancialBasis> {
    const started = this.now(),
      until = Math.min(started + 45000, deadline);
    try {
      const build = await this.beginBuild(actor, query, until);
      while (build.page !== null) {
        if (this.now() >= until)
          throw new ProviderError(
            "UPSTREAM_UNAVAILABLE",
            "read_budget_exhausted_use_prepare_financial_analysis",
          );
        await this.advanceChart(actor, build, until);
      }
      const result = await this.finishBuild(actor, build, until);
      this.metric({
        operation: "basis",
        duration_ms: this.now() - started,
        outcome: "ok",
      });
      return result;
    } catch (error) {
      this.metric({
        operation: "basis",
        duration_ms: this.now() - started,
        outcome: "error",
      });
      throw error;
    }
  }
}
