import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  type FileContext,
  FileError,
  fileInputSchema,
  fileService,
} from "./files.js";

export interface FileProbeContext {
  context: FileContext;
  authorized: boolean;
  origin: string;
}
export function registerFiles(server: McpServer, probe: FileProbeContext) {
  const service = fileService(probe.context);
  const securitySchemes = [
    { type: "oauth2", scopes: ["mcp:read", "offline_access", "mcp:files"] },
  ];
  const error = (code: string) => ({
    isError: true,
    content: [{ type: "text" as const, text: code }],
    ...(code === "FILE_SCOPE_REQUIRED"
      ? {
          _meta: {
            "mcp/www_authenticate": [
              `Bearer resource_metadata="${probe.origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="mcp:read offline_access mcp:files"`,
            ],
          },
        }
      : {}),
  });
  server.registerTool(
    "probe_synthetic_files",
    {
      title: "Verify synthetic receipt file transfer",
      description:
        "Download one or two user-selected synthetic receipt files, verify bytes and return short-lived encrypted file references. No Fortnox operation; do not send real receipts. PNG/JPEG or uncompressed PDF only, 5 MiB each, at most 10 PDF pages.",
      inputSchema: fileInputSchema,
      outputSchema: z
        .object({
          kind: z.literal("s00-files"),
          workflow: z.uuid(),
          company: z.string(),
          fortnoxEnabled: z.literal(false),
          files: z
            .array(
              z
                .object({
                  id: z.uuid(),
                  uri: z.string(),
                  mime: z.enum(["image/png", "image/jpeg", "application/pdf"]),
                  bytes: z.number().int().positive(),
                  sha256: z.string().regex(/^[0-9a-f]{64}$/),
                  expires: z.number().int().positive(),
                  receiptReference: z.string(),
                  voucherReference: z.string(),
                })
                .strict(),
            )
            .min(1)
            .max(2),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { securitySchemes, "openai/fileParams": ["files"] },
    },
    async (input) => {
      if (!probe.authorized) return error("FILE_SCOPE_REQUIRED");
      try {
        const result = await service.ingest(input);
        return {
          structuredContent: result,
          content: [
            { type: "text" as const, text: JSON.stringify(result) },
            ...result.files.map((f) => ({
              type: "resource_link" as const,
              uri: f.uri,
              name: `synthetic-receipt-${f.id}`,
              mimeType: f.mime,
              size: f.bytes,
            })),
          ],
        };
      } catch (e) {
        return error(e instanceof FileError ? e.code : "FILE_UNAVAILABLE");
      }
    },
  );
  server.registerTool(
    "read_synthetic_file",
    {
      title: "Read a synthetic file",
      description:
        "Retrieve a short-lived owner/company-bound synthetic file. No URL input and no upstream operation.",
      inputSchema: z.object({ id: z.uuid() }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { securitySchemes },
    },
    async ({ id }) => {
      if (!probe.authorized) return error("FILE_SCOPE_REQUIRED");
      try {
        const result = await service.read(id);
        return {
          content: [
            {
              type: "resource" as const,
              resource: {
                uri: `s00://files/${id}`,
                mimeType: result.mime,
                blob: result.blob,
              },
            },
          ],
        };
      } catch (e) {
        return error(e instanceof FileError ? e.code : "FILE_UNAVAILABLE");
      }
    },
  );
  server.registerResource(
    "synthetic-file",
    new ResourceTemplate("s00://files/{id}", { list: undefined }),
    {
      description:
        "Encrypted, expiring synthetic receipt output. Requires OAuth owner and file scope.",
    },
    async (uri, variables) => {
      if (!probe.authorized) throw new Error("FILE_SCOPE_REQUIRED");
      if (typeof variables.id !== "string") throw new Error("FILE_UNAVAILABLE");
      const result = await service.read(variables.id);
      return {
        contents: [{ uri: uri.href, mimeType: result.mime, blob: result.blob }],
      };
    },
  );
}
