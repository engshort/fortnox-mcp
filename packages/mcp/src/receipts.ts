import {
  type AccountingActor,
  DomainError,
  proposalReference,
  type Receipts,
  receiptBatchInput,
  receiptBatchReference,
  receiptFileReference,
  voucherInput,
} from "@fortnox-mcp/core";
import { receiptReviewHtml } from "@fortnox-mcp/ui";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const resourceUri = "ui://fortnox/receipt-review-v1.html";
const step = z.union([
  z.object({ state: z.literal("pending") }).strict(),
  z
    .object({
      state: z.literal("submitting"),
      attempt: z.string().uuid(),
      created: z.number().int(),
    })
    .strict(),
  z.object({ state: z.literal("succeeded"), reference: z.string() }).strict(),
  z.object({ state: z.literal("failed"), code: z.string() }).strict(),
  z
    .object({
      state: z.literal("outcome_unknown"),
      reference: z.string().optional(),
    })
    .strict(),
]);
export const receiptBatchOutput = z
  .object({
    company_id: z.string().uuid(),
    company_name: z.string(),
    batch_id: z.string().uuid(),
    batch_hash: z.string().regex(/^[a-f0-9]{64}$/),
    expires_at: z.number().int(),
    execution_available: z.boolean(),
    items: z
      .array(
        z
          .object({
            item_id: z.string().uuid(),
            file: receiptFileReference,
            sha256: z.string().nullable(),
            state: z.string(),
            reason: z.string().nullable(),
            duplicate_candidates: z.array(z.string().uuid()).max(10),
            proposal: proposalReference.nullable(),
            voucher: voucherInput.nullable(),
            totals: z
              .object({
                debit: z.string(),
                credit: z.string(),
                difference: z.string(),
              })
              .strict()
              .nullable(),
            review_expires_at: z.number().int().nullable(),
            steps: z
              .object({ upload: step, voucher: step, link: step })
              .strict(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
const error = z
  .object({
    status: z.literal("error"),
    error: z
      .object({ code: z.string(), correlation_id: z.string().uuid() })
      .strict(),
  })
  .strict();
const result = z.union([
  z.object({ status: z.literal("ok"), data: receiptBatchOutput }).strict(),
  error,
]);
export function registerReceipts(
  server: McpServer,
  service: Receipts,
  identity: AccountingActor | null,
) {
  if (!service.enabled) return;
  const actor = () => {
    if (!identity) throw new DomainError("AUTH_REQUIRED");
    return identity;
  };
  const reply = async (operation: () => Promise<unknown>) => {
    try {
      const parsed = result.parse({ status: "ok", data: await operation() });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
        structuredContent: parsed,
      };
    } catch (cause) {
      const parsed = error.parse({
        status: "error",
        error: {
          code: cause instanceof DomainError ? cause.code : "REQUEST_FAILED",
          correlation_id: crypto.randomUUID(),
        },
      });
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
        structuredContent: parsed,
      };
    }
  };
  const securitySchemes = [
    {
      type: "oauth2",
      scopes: ["mcp:read", "mcp:files", "mcp:write", "offline_access"],
    },
  ];
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerResource(
    "receipt-review",
    resourceUri,
    { mimeType: "text/html;profile=mcp-app" },
    async () => {
      actor();
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: "text/html;profile=mcp-app",
            text: await receiptReviewHtml(),
            _meta: {
              ui: {
                csp: { connectDomains: [], resourceDomains: [] },
                prefersBorder: true,
              },
            },
          },
        ],
      };
    },
  );
  server.registerTool(
    "prepare_receipt_batch",
    {
      title: "Prepare separate receipt proposals",
      description:
        "Use the client's explicit interpretation of one or more receipt files. Each item is validated and reviewed independently; missing facts or duplicate candidates return needs_input. No OCR, invented financial facts, pooled balancing, approval or provider write.",
      inputSchema: receiptBatchInput,
      outputSchema: result,
      annotations: {
        ...annotations,
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { securitySchemes, ui: { resourceUri } },
    },
    async (input) => {
      let capabilities: Record<string, string> = {};
      const response = await reply(async () => {
        const { capabilities: secret, ...view } = await service.prepare(
          actor(),
          input,
        );
        capabilities = secret;
        return view;
      });
      return {
        ...response,
        ...(Object.keys(capabilities).length
          ? { _meta: { receiptReview: { capabilities } } }
          : {}),
      };
    },
  );
  server.registerTool(
    "get_receipt_batch",
    {
      title: "Read receipt batch and per-item status",
      description:
        "Read the exact immutable selection and durable step status. No new proposal, capability or retry is created. Unknown outcomes require reconciliation.",
      inputSchema: receiptBatchReference,
      outputSchema: result,
      annotations,
      _meta: { securitySchemes },
    },
    (input) => reply(() => service.view(actor(), input)),
  );
}
