import {
  type AccountingActor,
  type AttachmentReference,
  attachmentReference,
  DomainError,
  encodeFile,
  type ReceiptAttachments,
  ReceiptFileError,
  receiptItemReference,
  receiptProviderErrorCode,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";

const outcome = z.union([
  z.object({ state: z.literal("succeeded"), reference: z.string() }).strict(),
  z.object({ state: z.literal("failed"), code: z.string() }).strict(),
  z
    .object({
      state: z.literal("outcome_unknown"),
      reference: z.string().optional(),
      diagnostic: z
        .object({
          stage: z.enum([
            "dispatch",
            "http_response",
            "response_parse",
            "authorization",
          ]),
          http_status: z.number().int().min(100).max(599).optional(),
          provider_code: receiptProviderErrorCode.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
const error = z
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
const result = z.union([
  z.object({ status: z.literal("ok"), data: outcome }).strict(),
  error,
]);
export function registerReceiptAttachments(
  server: McpServer,
  service: ReceiptAttachments,
  identity: AccountingActor | null,
) {
  const actor = () => {
    if (!identity) throw new DomainError("AUTH_REQUIRED");
    return identity;
  };
  const fail = (cause: unknown) => {
    const parsed = error.parse({
      status: "error",
      error: {
        code:
          cause instanceof DomainError || cause instanceof ReceiptFileError
            ? cause.code
            : "UPSTREAM_UNAVAILABLE",
        reason:
          cause instanceof ProviderError ? cause.reason : "request_failed",
        correlation_id: crypto.randomUUID(),
      },
    });
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
      structuredContent: parsed,
    };
  };
  const securitySchemes = [
    {
      type: "oauth2",
      scopes: ["mcp:read", "mcp:files", "mcp:write", "offline_access"],
    },
  ];
  const readSecurity = [
    { type: "oauth2", scopes: ["mcp:read", "mcp:files", "offline_access"] },
  ];
  if (service.gates.upload && service.provider.inspectUpload)
    server.registerTool(
      "reconcile_receipt_upload",
      {
        title: "Reconcile an uncertain original receipt upload",
        description:
          "Discover exact original upload evidence in the authorized company's inbox and reconcile only its saved upload step. Never uploads, books, links or renews review. Historical policy/expiry does not authorize execution; missing or ambiguous evidence remains unknown.",
        inputSchema: receiptItemReference,
        outputSchema: result,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        _meta: { securitySchemes: readSecurity },
      },
      async (input) => {
        try {
          const parsed = result.parse({
            status: "ok",
            data: await service.reconcileUpload(actor(), input),
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
            structuredContent: parsed,
          };
        } catch (cause) {
          return fail(cause);
        }
      },
    );
  for (const kind of ["upload", "link"] as const) {
    if (!service.gates[kind]) continue;
    server.registerTool(
      kind === "upload" ? "upload_receipt_file" : "link_receipt_attachment",
      {
        title:
          kind === "upload"
            ? "Upload an exact staged receipt"
            : "Link an uploaded receipt to its existing voucher",
        description:
          kind === "upload"
            ? "Upload only this immutable item's staged bytes to the voucher inbox. A durable claim prevents automatic replay of successful or unknown attempts. No voucher is created."
            : "Link only this item's saved successful upload and verified successful voucher. A failed link never creates another voucher; unknown outcomes require reconciliation.",
        inputSchema: receiptItemReference,
        outputSchema: result,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        _meta: { securitySchemes },
      },
      async (input) => {
        try {
          const parsed = result.parse({
            status: "ok",
            data: await service[kind](actor(), input),
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
            structuredContent: parsed,
          };
        } catch (cause) {
          return fail(cause);
        }
      },
    );
  }
  if (!service.gates.retrieve) return;
  const read = async (input: AttachmentReference) => {
    const result = await service.retrieve(actor(), input);
    try {
      return {
        uri: `receipt://attachments/${input.company_id}/${input.voucher.financial_year}/${input.voucher.series}/${input.voucher.number}/${input.file_id}`,
        mimeType: result.mime,
        blob: encodeFile(result.bytes),
      };
    } finally {
      result.bytes.fill(0);
    }
  };
  server.registerTool(
    "get_receipt_attachment",
    {
      title: "Retrieve a voucher's authorized original attachment",
      description:
        "Verify the owning voucher, company and exact file relationship before bounded binary retrieval. Return an authenticated MCP resource, never a public provider URL or original filename.",
      inputSchema: attachmentReference,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { securitySchemes: readSecurity },
    },
    async (input) => {
      try {
        return {
          content: [{ type: "resource" as const, resource: await read(input) }],
        };
      } catch (cause) {
        return fail(cause);
      }
    },
  );
  server.registerResource(
    "receipt-attachment",
    new ResourceTemplate(
      "receipt://attachments/{company}/{year}/{series}/{number}/{file}",
      { list: undefined },
    ),
    {},
    async (_uri, v) => ({
      contents: [
        await read(
          attachmentReference.parse({
            company_id: v.company,
            file_id: v.file,
            voucher: {
              financial_year: Number(v.year),
              series: v.series,
              number: Number(v.number),
            },
          }),
        ),
      ],
    }),
  );
}
