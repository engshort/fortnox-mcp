import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { activeFileRelay } from "./file-relay-transport.js";
import { workerFileByteBudget } from "./file-worker-budget.js";
import {
  FileError,
  type FileTransport,
  fetchFile,
  parseFileOrigins,
} from "./files.js";

export interface FileRelayConfig {
  token: string;
  until: string;
  origins: string;
}
const inputSchema = z.object({ download_url: z.string().max(4096) }).strict();

// Development-only, memory-only, eight-download session. No arbitrary headers,
// redirects, destination origins, filesystem access or persistent receipt data.
export function createFileRelay(
  config: FileRelayConfig,
  transport: FileTransport,
  now = Date.now,
) {
  const origins = parseFileOrigins(config.origins);
  let attempts = 0;
  const reply = (code: string, status: number) =>
    Response.json(
      { error: code },
      {
        status,
        headers: {
          "cache-control": "no-store",
          "x-s00-file-error": code,
          "x-content-type-options": "nosniff",
        },
      },
    );
  return async (request: Request): Promise<Response> => {
    if (!activeFileRelay(config, now()))
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
    if (url.pathname === "/s00-files/health" && request.method === "GET")
      return Response.json(
        {
          ready: true,
          remaining: 8 - attempts,
          until: config.until,
          fortnoxEnabled: false,
        },
        { headers: { "cache-control": "no-store" } },
      );
    if (
      url.pathname !== "/s00-files/fetch" ||
      request.method !== "POST" ||
      request.headers.get("content-type") !== "application/json"
    )
      return reply("FILE_INVALID", 400);
    if (attempts >= 8) return reply("FILE_LIMIT", 429);
    const reader = request.body?.getReader();
    if (!reader) return reply("FILE_INVALID", 400);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const input = await Promise.race([
        (async () => {
          let size = 0;
          const parts: Uint8Array[] = [];
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 8192) throw new FileError("FILE_INVALID");
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
            reject(new FileError("FILE_TIMEOUT"));
          }, 5000);
        }),
      ]);
      attempts++;
      const result = await fetchFile(
        { ...input, file_id: "synthetic-relay" },
        { origins, transport, maxBytes: workerFileByteBudget },
      );
      if (!activeFileRelay(config, now())) {
        result.bytes.fill(0);
        throw new FileError("FILE_TRANSPORT_UNAVAILABLE");
      }
      const response = new Response(result.bytes, {
        headers: {
          "content-type": result.contentType ?? "application/octet-stream",
          "content-length": String(result.bytes.length),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
      result.bytes.fill(0);
      return response;
    } catch (error) {
      const code = error instanceof FileError ? error.code : "FILE_INVALID";
      return reply(code, 502);
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => {});
    }
  };
}
