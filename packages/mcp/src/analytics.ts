import {
  type AccountingActor,
  accountCategory,
  accountingDate,
  DomainError,
  type FinancialAnalysis,
  financialAccountsQuery,
  financialBasis,
  financialMovementQuery,
  financialQuery,
  financialVoucherReference,
} from "@fortnox-mcp/core";
import {
  type FortnoxFinancialReads,
  ProviderError,
} from "@fortnox-mcp/fortnox";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const money = z
  .string()
  .regex(/^-?\d+\.\d{2}$/)
  .max(68);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const account = z.number().int().min(1).max(99999999);
const continuation = z
  .object({
    after_account: account,
    source_version: hash,
    query_key: z.string().max(2048),
  })
  .strict();
const report = z
  .object({
    company_id: z.string().uuid(),
    financial_year: financialBasis.shape.year,
    interval: z.object({ from: accountingDate, to: accountingDate }).strict(),
    currency: financialBasis.shape.currency,
    calculation_version: z.string().max(128),
    mapping_version: z.string().max(128),
    source_version: hash,
    value_origin: z.literal("computed"),
    provider_value_fields: z
      .array(z.enum(["opening", "provider_closing"]))
      .length(2),
    sources: financialBasis.shape.sources,
    retrieved: financialBasis.shape.retrieved,
    coverage: financialBasis.shape.coverage,
    consistency: financialBasis.shape.consistency,
    complete: z.boolean(),
    data_complete: z.boolean(),
    accounts_page: z
      .object({
        count: z.number().int().min(0).max(50),
        total_in_selection: z.number().int().min(0).max(10000),
        next: continuation.nullable(),
        exhausted: z.boolean(),
      })
      .strict(),
    reconciliation: z.enum(["matched", "mismatch", "unavailable"]),
    accounts: z
      .array(
        z
          .object({
            number: account,
            name: z.string().max(200),
            active: z.boolean().nullable(),
            opening: money.nullable(),
            provider_closing: money.nullable(),
            category: accountCategory,
            period_movement: money,
            period_movement_complete: z.boolean(),
            balance_as_of: money.nullable(),
            calculated_year_closing: money.nullable(),
            reconciliation: z
              .object({
                boundary: accountingDate,
                difference: money.nullable(),
                status: z.enum(["matched", "mismatch", "unavailable"]),
              })
              .strict(),
            movement_ids: z.array(z.string().max(128)).max(20),
            movement_count: z.number().int().min(0).max(10000),
          })
          .strict(),
      )
      .max(50),
    totals: z
      .array(
        z
          .object({
            category: accountCategory,
            account_count: z.number().int().min(0).max(10000),
            signed_period_movement: money,
            signed_balance: money.nullable(),
            display_sign: z.union([z.literal(-1), z.literal(1)]),
          })
          .strict(),
      )
      .length(6),
    totals_scope: z.literal("entire_account_selection"),
    limitations: z.array(z.string().max(128)).max(100),
    bank_balance_kind: z.literal("booked_ledger_balance"),
  })
  .strict();
const movementPage = z
  .object({
    value_origin: z.literal("provider_export"),
    reference_origin: z.literal("parsed_provider_export"),
    company_id: z.string().uuid(),
    financial_year: financialBasis.shape.year,
    interval: z.object({ from: accountingDate, to: accountingDate }).strict(),
    account_number: account,
    account_known: z.boolean(),
    currency: financialBasis.shape.currency,
    source_version: hash,
    sources: financialBasis.shape.sources,
    retrieved: financialBasis.shape.retrieved,
    coverage: financialBasis.shape.coverage,
    consistency: financialBasis.shape.consistency,
    semantics_verified: z.boolean(),
    complete: z.boolean(),
    data_complete: z.boolean(),
    rows: z
      .array(
        financialBasis.shape.movements.element.extend({
          voucher_ref: financialVoucherReference.nullable(),
          amount: money,
        }),
      )
      .max(50),
    page: z
      .object({
        count: z.number().int().min(0).max(50),
        total_in_selection: z.number().int().min(0).max(10000),
        next: financialMovementQuery.shape.continuation.unwrap().nullable(),
        exhausted: z.boolean(),
      })
      .strict(),
    limitations: financialBasis.shape.limitations,
  })
  .strict();
const voucher = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int().positive(),
    series: z.string().regex(/^[A-Z0-9]{1,8}$/),
    number: z.number().int().positive(),
    date: accountingDate,
    rows: z
      .array(
        z
          .object({
            source_row: z.number().int().min(0),
            account,
            debit: money,
            credit: money,
            removed: z.boolean().nullable(),
            date: accountingDate,
          })
          .strict(),
      )
      .max(1000),
    source_sha256: hash,
    row_semantics_verified: z.literal(false),
    complete: z.literal(true),
  })
  .strict();
const failure = z
  .object({
    status: z.literal("error"),
    error: z
      .object({
        code: z.string(),
        reason: z.string(),
        correlation_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
export function registerFinancialReads(
  server: McpServer,
  service: FinancialAnalysis,
  provider: FortnoxFinancialReads,
  identity: AccountingActor | null,
) {
  const register = <T extends { company_id: string }>(
    name: string,
    title: string,
    description: string,
    input: z.ZodType<T>,
    data: z.ZodType,
    run: (actor: AccountingActor, value: T) => Promise<unknown>,
  ) => {
    const output = z.union([
      z
        .object({
          status: z.literal("ok"),
          company_id: z.string().uuid(),
          data,
        })
        .strict(),
      failure,
    ]);
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: input,
        outputSchema: output,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (raw) => {
        let result: unknown;
        try {
          if (!identity) throw new DomainError("AUTH_REQUIRED");
          const value = input.parse(raw);
          result = {
            status: "ok",
            company_id: value.company_id,
            data: await run(identity, value),
          };
        } catch (error) {
          result = {
            status: "error",
            error: {
              code:
                error instanceof DomainError
                  ? error.code
                  : "UPSTREAM_UNAVAILABLE",
              reason:
                error instanceof ProviderError
                  ? error.reason
                  : "request_failed",
              correlation_id: crypto.randomUUID(),
            },
          };
        }
        const checked = output.parse(result);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(checked) }],
          structuredContent: checked,
          isError: checked.status === "error",
        };
      },
    );
  };
  if (
    service.enabled &&
    (["financial.accounts", "financial.year", "financial.sie4"] as const).every(
      (id) => provider.enabled.includes(id),
    )
  )
    register(
      "get_financial_analysis",
      "Read financial analysis",
      "Compute exact signed ledger movements for an explicit company, fiscal year and date interval. Source coverage and reconciliation limits remain explicit. Continuations bind the source version; totals cover the entire selected account set. No live bank balance or financial write.",
      financialQuery,
      report,
      (actor, value) => service.report(actor, value),
    );
  if (
    service.enabled &&
    (["financial.accounts", "financial.year", "financial.sie4"] as const).every(
      (id) => provider.enabled.includes(id),
    )
  )
    register(
      "list_financial_movements",
      "Read account movements and source references",
      "Read a bounded account/date selection with source-bound continuation and exact voucher references. Provider coverage and row semantics remain explicit; no financial write.",
      financialMovementQuery,
      movementPage,
      (actor, value) => service.movements(actor, value),
    );
  if (provider.enabled.includes("financial.accounts"))
    register(
      "list_financial_accounts",
      "List fiscal-year chart accounts",
      "Read at most 100 chart accounts for an explicit company/year, including zero/inactive references returned by the provider. Continuation binds the company/year and rechecks the first-page anchor. Chart-record completeness does not establish verified balance units or a reconciled financial report; pagination is not an atomic snapshot.",
      financialAccountsQuery,
      z
        .object({
          company_id: z.string().uuid(),
          financial_year: z.number().int().positive().safe(),
          records: z
            .array(
              z
                .object({
                  number: account,
                  name: z.string().max(200),
                  active: z.boolean(),
                  opening: money.nullable(),
                  provider_closing: money.nullable(),
                })
                .strict(),
            )
            .max(100),
          complete: z.boolean(),
          coverage: z.literal("chart_records_only"),
          page: z
            .object({
              number: z.number().int().min(1).max(10000),
              metadata_verified: z.boolean(),
              exhausted: z.boolean(),
              total_records: z.number().int().nonnegative().safe().nullable(),
              next: financialAccountsQuery.shape.continuation
                .unwrap()
                .nullable(),
            })
            .strict(),
          sources: financialBasis.shape.sources.min(1).max(2),
          retrieved: financialBasis.shape.retrieved,
          consistency: z.literal("not_atomic"),
          value_origin: z.literal("provider"),
          currency: z.null(),
          balance_units_verified: z.literal(false),
        })
        .strict(),
      (actor, value) => provider.accounts(actor, value),
    );
  if (provider.enabled.includes("financial.account"))
    register(
      "get_financial_account",
      "Read a fiscal-year account and provider balances",
      "Read an exact account reference in an explicit financial year. Opening and closing source values are separate from computed as-of balances. Currency/precision coverage remains explicit.",
      z
        .object({
          company_id: z.string().uuid(),
          financial_year: z.number().int().positive().safe(),
          account_number: z.number().int().min(1000).max(9999),
        })
        .strict(),
      z
        .object({
          company_id: z.string().uuid(),
          financial_year: z.number().int().positive().safe(),
          record: z
            .object({
              number: account,
              name: z.string().max(200),
              active: z.boolean(),
              opening: money.nullable(),
              provider_closing: money.nullable(),
            })
            .strict(),
          source: financialBasis.shape.sources.element,
          value_origin: z.literal("provider"),
          currency: z.null(),
          balance_units_verified: z.literal(false),
          complete: z.literal(false),
        })
        .strict(),
      (actor, value) =>
        provider.account(
          actor,
          value.company_id,
          value.financial_year,
          value.account_number,
        ),
    );
  if (provider.enabled.includes("financial.voucher"))
    register(
      "get_financial_voucher",
      "Read a source voucher",
      "Read an exact provider voucher reference for financial drill-down. Removed-row semantics remain unverified; this is not approval or a write.",
      z
        .object({
          company_id: z.string().uuid(),
          financial_year: z.number().int().positive().safe(),
          series: z.string().regex(/^[A-Z0-9]{1,8}$/),
          number: z.number().int().positive().safe(),
        })
        .strict(),
      voucher,
      (actor, v) =>
        provider.voucher(
          actor,
          v.company_id,
          v.financial_year,
          v.series,
          v.number,
        ),
    );
}
