import {
  type AccountingActor,
  accountingDate,
  DomainError,
  type OpenItems,
  openItemQuery,
  openItemRecord,
  openItemSource,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const money = z
  .string()
  .regex(/^-?\d+\.\d{2}$/)
  .max(68);
const record = openItemRecord
  .extend({
    balance: money.nullable(),
    open_status: z.enum(["open", "unknown"]),
    overdue: z.boolean().nullable(),
    expected_signed_cash_flow: money.nullable(),
  })
  .strict();
export function registerOpenItems(
  server: McpServer,
  service: OpenItems,
  identity: AccountingActor | null | undefined,
) {
  for (const kind of service.enabled) {
    const input = openItemQuery.omit({ kind: true });
    const data = z
      .object({
        company_id: z.string().uuid(),
        kind: z.literal(kind),
        records: z.array(record).max(100),
        observation_day: accountingDate,
        observation_point: z.literal("current_provider_state"),
        historical_status_supported: z.literal(false),
        retrieved: z
          .object({
            started_at: z.number().int().nonnegative().safe(),
            finished_at: z.number().int().nonnegative().safe(),
          })
          .strict(),
        consistency: z.literal("not_atomic"),
        complete: z.boolean(),
        balance_semantics_verified: z.boolean(),
        totals_scope: z.literal("returned_page_only"),
        totals: z
          .array(
            z
              .object({
                currency: z.string().regex(/^[A-Z]{3}$/),
                provider_balance_sum: money.nullable(),
                expected_signed_cash_flow: money.nullable(),
              })
              .strict(),
          )
          .max(100),
        page: z
          .object({
            number: z.number().int().min(1).max(10000),
            source_record_count: z.number().int().min(0).max(100),
            total_source_records: z
              .number()
              .int()
              .nonnegative()
              .safe()
              .nullable(),
            metadata_verified: z.boolean(),
            exhausted: z.boolean(),
            next: openItemQuery.shape.continuation.unwrap().nullable(),
          })
          .strict(),
        sources: z.array(openItemSource).min(1).max(2),
        limitations: z.array(z.string().max(128)).max(10),
      })
      .strict();
    const output = z.union([
      z
        .object({
          status: z.literal("ok"),
          company_id: z.string().uuid(),
          data,
        })
        .strict(),
      z
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
        .strict(),
    ]);
    server.registerTool(
      kind === "receivable" ? "list_receivables" : "list_payables",
      {
        title:
          kind === "receivable"
            ? "Read current receivables"
            : "Read current payables",
        description:
          "Read current open invoice observations from at most 100 unfiltered source records. Keeps unknown status/amounts explicit. No historical balance reconstruction; totals cover only this page, never combine currencies, and unverified balance/credit semantics block expected-flow calculations. Due date is not a promise of payment. No bank payment initiation.",
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
            data: await service.list(identity, { ...value, kind }),
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
  }
}
