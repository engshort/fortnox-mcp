import ipaddr from "ipaddr.js";
import { z } from "zod";

export const fileLimits = {
  files: 2,
  bytes: 5 * 1024 * 1024,
  pages: 10,
  pixels: 2_000_000,
  timeoutMs: 15_000,
  ttlMs: 55 * 60_000,
  chunkBytes: 64 * 1024,
  activeFiles: 4,
} as const;
export const syntheticCompany = "s00-company-a";
export const fileInputSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            download_url: z.string().max(4096),
            file_id: z.string().min(1).max(256),
            mime_type: z.string().max(100).optional(),
            file_name: z.string().max(256).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(fileLimits.files),
  })
  .strict();
export type FileInput = z.infer<typeof fileInputSchema>["files"][number];
export type FileErrorCode =
  | "FILE_URL_DENIED"
  | "FILE_FETCH_FAILED"
  | "FILE_EXPIRED"
  | "FILE_TOO_LARGE"
  | "FILE_TIMEOUT"
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_INVALID"
  | "FILE_LIMIT"
  | "FILE_UNAVAILABLE";
export class FileError extends Error {
  constructor(public readonly code: FileErrorCode) {
    super(code);
    this.name = "FileError";
  }
}
export interface FileRecord {
  id: string;
  owner: string;
  company: string;
  workflow: string;
  mime: string;
  bytes: number;
  hash: string;
  expires: number;
  chunks: number;
}
export interface SealedChunk {
  index: number;
  iv: string;
  data: string;
}
export interface FileStore {
  put(record: FileRecord, chunks: SealedChunk[], now: number): Promise<boolean>;
  get(
    id: string,
    owner: string,
    company: string,
    now: number,
    maxBytes?: number,
  ): Promise<{ record: FileRecord; chunks: SealedChunk[] } | null>;
  removeWorkflow(
    workflow: string,
    owner: string,
    company: string,
  ): Promise<void>;
  cleanup(now: number): Promise<void>;
}
export interface FileTransport {
  open(url: URL, signal: AbortSignal): Promise<Response>;
}
export interface FileValidator {
  validate(bytes: Uint8Array): Promise<{ mime: string; pages?: number }>;
}
export interface FileCodec {
  encode(bytes: Uint8Array): string;
  decode(text: string): Uint8Array;
}
export interface FileContext {
  owner: string;
  company: string;
  secret: string;
  origins: readonly string[];
  store: FileStore;
  transport: FileTransport;
  validator: FileValidator;
  codec?: FileCodec;
  maxBytes?: number;
  now?: () => number;
  // Optional operator-only sink. Never receives paths, query strings or IDs.
  onSourceHostname?: (hostname: string) => void;
}
export function isPublicAddress(value: string) {
  try {
    const address = ipaddr.process(value);
    return address.range() === "unicast";
  } catch {
    return false;
  }
}
export function approvedFileUrl(value: string, origins: readonly string[]) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FileError("FILE_URL_DENIED");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // No IP literals, local names, credentials, custom ports or wildcards. The
  // runtime transport must additionally enforce public, pinned DNS resolution.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !host.includes(".") ||
    host.endsWith(".") ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host) ||
    ipaddr.isValid(host) ||
    !origins.includes(url.origin)
  )
    throw new FileError("FILE_URL_DENIED");
  return url;
}
export function parseFileOrigins(value: string | undefined) {
  if (!value) return [];
  const origins = value.split(",").map((s) => s.trim());
  if (origins.length > 4 || origins.some((s) => !s))
    throw new FileError("FILE_URL_DENIED");
  for (const origin of origins) {
    const url = approvedFileUrl(origin, origins);
    if (url.origin !== origin) throw new FileError("FILE_URL_DENIED");
  }
  return origins;
}
export async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
const encode = (bytes: Uint8Array) => {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(parts.join(""));
};
const decode = (text: string) => {
  const binary = atob(text),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
async function encryptionKey(secret: string) {
  if (secret.length < 32) throw new FileError("FILE_UNAVAILABLE");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("s00-files-v1"),
      info: new TextEncoder().encode("temporary-file-encryption"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
const aad = (record: FileRecord, index: number) =>
  new TextEncoder().encode(
    JSON.stringify([
      record.id,
      record.owner,
      record.company,
      record.workflow,
      record.mime,
      record.bytes,
      record.hash,
      record.expires,
      record.chunks,
      index,
    ]),
  );
async function seal(
  record: FileRecord,
  bytes: Uint8Array,
  key: CryptoKey,
  codec: FileCodec,
) {
  const chunks: SealedChunk[] = [];
  for (let offset = 0; offset < bytes.length; offset += fileLimits.chunkBytes) {
    const index = chunks.length,
      iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(record, index) },
      key,
      bytes.slice(offset, offset + fileLimits.chunkBytes),
    );
    chunks.push({
      index,
      iv: codec.encode(iv),
      data: codec.encode(new Uint8Array(encrypted)),
    });
  }
  return chunks;
}
export async function fetchFile(
  input: FileInput,
  context: Pick<FileContext, "origins" | "transport" | "maxBytes">,
) {
  const maximum = context.maxBytes ?? fileLimits.bytes;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > fileLimits.bytes
  )
    throw new FileError("FILE_UNAVAILABLE");
  const url = approvedFileUrl(input.download_url, context.origins);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new FileError("FILE_TIMEOUT"));
    }, fileLimits.timeoutMs);
  });
  const work = async () => {
    try {
      const response = await context.transport.open(url, controller.signal);
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new FileError("FILE_TIMEOUT");
      }
      if (response.status !== 200 || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new FileError(
          [401, 403, 404, 410].includes(response.status)
            ? "FILE_EXPIRED"
            : "FILE_FETCH_FAILED",
        );
      }
      const length = response.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
        void response.body?.cancel().catch(() => {});
        throw new FileError("FILE_TOO_LARGE");
      }
      if (!response.body) throw new FileError("FILE_INVALID");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) throw new FileError("FILE_TOO_LARGE");
        chunks.push(chunk.value);
      }
      if (controller.signal.aborted) throw new FileError("FILE_TIMEOUT");
      if (size === 0) throw new FileError("FILE_INVALID");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return {
        bytes,
        contentType: response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          .trim()
          .toLowerCase(),
      };
    } catch (error) {
      throw error instanceof FileError
        ? error
        : new FileError("FILE_FETCH_FAILED");
    }
  };
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
export function fileService(context: FileContext) {
  const now = context.now ?? Date.now;
  const codec = context.codec ?? { encode, decode };
  return {
    async ingest(input: unknown) {
      const parsed = fileInputSchema.safeParse(input);
      if (!parsed.success) throw new FileError("FILE_INVALID");
      const workflow = crypto.randomUUID();
      const files: Array<{
        id: string;
        uri: string;
        mime: string;
        bytes: number;
        sha256: string;
        expires: number;
        receiptReference: string;
        voucherReference: string;
      }> = [];
      const key = await encryptionKey(context.secret);
      try {
        await context.store.cleanup(now());
        // Sequential transfers/parsers bound memory to one file at a time.
        for (const input of parsed.data.files) {
          if (context.onSourceHostname) {
            try {
              const candidate = new URL(input.download_url);
              const safe = approvedFileUrl(input.download_url, [
                candidate.origin,
              ]);
              if (safe.hostname.length <= 253)
                context.onSourceHostname(safe.hostname);
            } catch {
              // Diagnostics cannot change validation or authorize a download.
            }
          }
          const { bytes, contentType } = await fetchFile(input, context);
          try {
            const { mime } = await context.validator.validate(bytes);
            if (
              (input.mime_type && input.mime_type !== mime) ||
              (contentType &&
                contentType !== "application/octet-stream" &&
                contentType !== mime)
            )
              throw new FileError("FILE_INVALID");
            const record: FileRecord = {
              id: crypto.randomUUID(),
              owner: context.owner,
              company: context.company,
              workflow,
              mime,
              bytes: bytes.length,
              hash: await digest(bytes),
              expires: now() + fileLimits.ttlMs,
              chunks: Math.ceil(bytes.length / fileLimits.chunkBytes),
            };
            if (
              !(await context.store.put(
                record,
                await seal(record, bytes, key, codec),
                now(),
              ))
            )
              throw new FileError("FILE_LIMIT");
            files.push({
              id: record.id,
              uri: `s00://files/${record.id}`,
              mime,
              bytes: record.bytes,
              sha256: record.hash,
              expires: record.expires,
              receiptReference: `synthetic-receipt:${record.id}`,
              voucherReference: `synthetic-voucher:${record.id}`,
            });
          } finally {
            bytes.fill(0);
          }
        }
        return {
          kind: "s00-files" as const,
          workflow,
          company: context.company,
          files,
          fortnoxEnabled: false as const,
        };
      } catch (error) {
        await context.store.removeWorkflow(
          workflow,
          context.owner,
          context.company,
        );
        throw error instanceof FileError
          ? error
          : new FileError("FILE_UNAVAILABLE");
      }
    },
    async read(id: string) {
      if (!z.uuid().safeParse(id).success)
        throw new FileError("FILE_UNAVAILABLE");
      const stored = await context.store.get(
        id,
        context.owner,
        context.company,
        now(),
        context.maxBytes ?? fileLimits.bytes,
      );
      if (!stored) throw new FileError("FILE_UNAVAILABLE");
      const { record, chunks } = stored;
      if (record.bytes > (context.maxBytes ?? fileLimits.bytes))
        throw new FileError("FILE_TOO_LARGE");
      if (
        record.expires <= now() ||
        chunks.length !== record.chunks ||
        record.bytes > fileLimits.bytes
      )
        throw new FileError("FILE_UNAVAILABLE");
      const key = await encryptionKey(context.secret);
      const bytes = new Uint8Array(record.bytes);
      let offset = 0;
      try {
        for (let index = 0; index < chunks.length; index++) {
          const chunk = chunks[index];
          if (chunk.index !== index) throw new Error("Invalid chunk order");
          const decoded = new Uint8Array(
            await crypto.subtle.decrypt(
              {
                name: "AES-GCM",
                iv: new Uint8Array(codec.decode(chunk.iv)),
                additionalData: aad(record, index),
              },
              key,
              new Uint8Array(codec.decode(chunk.data)),
            ),
          );
          bytes.set(decoded, offset);
          offset += decoded.length;
          decoded.fill(0);
        }
        if (
          offset !== record.bytes ||
          (await digest(bytes)) !== record.hash ||
          record.expires <= now()
        )
          throw new Error("Invalid file");
        return {
          mime: record.mime,
          blob: codec.encode(bytes),
          sha256: record.hash,
          bytes: record.bytes,
        };
      } catch {
        throw new FileError("FILE_UNAVAILABLE");
      } finally {
        bytes.fill(0);
      }
    },
    cleanup: () => context.store.cleanup(now()),
  };
}
