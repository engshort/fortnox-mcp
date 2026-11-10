import {
  type AccountingActor,
  DomainError,
  type LiquidityAnalysis,
  liquidityQuery,
  liquidityResult,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
export function registerLiquidity(
  server: McpServer,
  service: LiquidityAnalysis,
  identity: AccountingActor | null | undefined,
) {
  if (!service.enabled) return;
  const output = z.union([
    z
      .object({
        status: z.literal("ok"),
        company_id: z.string().uuid(),
        data: liquidityResult,
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
    "get_liquidity_basis",
    {
      title: "Read booked balances and explicit expected-flow inputs",
      description:
        "Read at most 20 selected ledger accounts and the first bounded current receivable/payable pages. Requires explicit fiscal year, today's Stockholm date and a maximum 90-day due-date-only assumption. Returns source completeness, unknown balance/sign/currency/classification limits and next invoice pages. Projection covers selected accounts and returned pages only; it is not live bank data, currency conversion, a guaranteed forecast or bank payment initiation.",
      inputSchema: liquidityQuery,
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
        const value = liquidityQuery.parse(raw);
        result = {
          status: "ok",
          company_id: value.company_id,
          data: await service.basis(identity, value),
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
              error instanceof ProviderError ? error.reason : "request_failed",
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
