import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import {
  type FileTransport,
  ReceiptFileError,
  receiptFileLimits,
} from "@fortnox-mcp/core";
import { z } from "zod";
import { activeReceiptRelay } from "./relay-transport.js";
import { fetchFile, parseFileOrigins } from "./transport.js";

export const receiptRelayConfig = z
  .object({
    token: z.string().regex(/^[0-9a-f]{64}$/),
    until: z.iso.datetime(),
    origins: z.string().min(1).max(4096),
  })
  .strict();
export type ReceiptRelayConfig = z.infer<typeof receiptRelayConfig>;
const inputSchema = z
  .object({ download_url: z.string().min(1).max(4096) })
  .strict();
export const receiptRelayAttempts = 12;

// Separate memory-only development helper: no company, OAuth, filesystem or
// financial interface. Product identity/grants/encryption stay on Node/Worker.
export function createReceiptRelay(
  input: ReceiptRelayConfig,
  transport: FileTransport,
  now = Date.now,
) {
  const config = receiptRelayConfig.parse(input),
    origins = parseFileOrigins(config.origins);
  if (!origins.length || !activeReceiptRelay(config, now()))
    throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
  let attempts = 0;
  const reply = (code: string, status: number) =>
    Response.json(
      { error: code },
      {
        status,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-receipt-file-error": code,
        },
      },
    );
  return async (request: Request): Promise<Response> => {
    if (!activeReceiptRelay(config, now()))
      return reply("FILE_TRANSPORT_UNAVAILABLE", 404);
    const bearer = request.headers
      .get("authorization")
      ?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
    if (
      request.headers.has("origin") ||
      !bearer ||
      !timingSafeEqual(Buffer.from(bearer), Buffer.from(config.token))
    )
      return reply("FILE_RELAY_UNAUTHORIZED", 401);
    const url = new URL(request.url);
    if (url.search) return reply("FILE_INVALID", 400);
    if (url.pathname === "/receipts/health" && request.method === "GET")
      return Response.json(
        {
          ready: true,
          remaining: receiptRelayAttempts - attempts,
          until: config.until,
          fortnoxEnabled: false,
        },
        { headers: { "cache-control": "no-store" } },
      );
    if (
      url.pathname !== "/receipts/fetch" ||
      request.method !== "POST" ||
      request.headers.get("content-type") !== "application/json"
    )
      return reply("FILE_INVALID", 400);
    const reader = request.body?.getReader();
    if (!reader) return reply("FILE_INVALID", 400);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const parsed = await Promise.race([
        (async () => {
          let size = 0;
          const parts: Uint8Array[] = [];
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 8192) throw new ReceiptFileError("FILE_INVALID");
            parts.push(part.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const part of parts) {
            bytes.set(part, offset);
            offset += part.length;
          }
          return inputSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void reader.cancel().catch(() => {});
            reject(new ReceiptFileError("FILE_TIMEOUT"));
          }, 5000);
        }),
      ]);
      clearTimeout(timer);
      if (!activeReceiptRelay(config, now()))
        throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
      // Reserve without an await between checking and incrementing. Concurrent
      // body readers cannot all pass the same remaining-attempt check.
      if (attempts >= receiptRelayAttempts) return reply("FILE_LIMIT", 429);
      attempts++;
      const result = await fetchFile(
        { ...parsed, file_id: "receipt-relay" },
        { origins, transport, maxBytes: receiptFileLimits.bytes },
      );
      try {
        if (!activeReceiptRelay(config, now()))
          throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
        return new Response(new Uint8Array(result.bytes), {
          headers: {
            "content-type": result.contentType ?? "application/octet-stream",
            "content-length": String(result.bytes.length),
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } finally {
        result.bytes.fill(0);
      }
    } catch (error) {
      return reply(
        error instanceof ReceiptFileError ? error.code : "FILE_INVALID",
        502,
      );
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => {});
    }
  };
}
