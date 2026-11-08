import { z } from "zod";
import type { AccountingActor } from "./bookkeeping.js";
import type { Ciphertext, Connections } from "./connections.js";
import { DomainError } from "./errors.js";

// Conservative product limits; provider upload limits are independently gated.
export const receiptFileLimits = {
  files: 2,
  bytes: 1024 * 1024,
  pages: 10,
  pixels: 2_000_000,
  timeoutMs: 15_000,
  ttlMs: 55 * 60_000,
  chunkBytes: 32 * 1024,
  activeFiles: 12,
} as const;
export const clientFile = z
  .object({
    download_url: z.string().min(1).max(4096),
    file_id: z.string().min(1).max(256),
    mime_type: z.string().max(100).optional(),
    file_name: z.string().max(256).optional(),
  })
  .strict();
export type ClientFile = z.infer<typeof clientFile>;
export const receiptFileReference = z
  .object({
    company_id: z.string().uuid(),
    workflow_id: z.string().uuid(),
    file_id: z.string().uuid(),
  })
  .strict();
export type ReceiptFileReference = z.infer<typeof receiptFileReference>;
export type ReceiptFileErrorCode =
  | "FILE_URL_DENIED"
  | "FILE_FETCH_FAILED"
  | "FILE_TRANSPORT_UNAVAILABLE"
  | "FILE_EXPIRED"
  | "FILE_TOO_LARGE"
  | "FILE_TIMEOUT"
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_INVALID"
  | "FILE_LIMIT"
  | "FILE_UNAVAILABLE"
  | "FILE_ENCRYPTED"
  | "FILE_PDF_UNSUPPORTED";
export class ReceiptFileError extends Error {
  constructor(readonly code: ReceiptFileErrorCode) {
    super(code);
  }
}
export interface FileTransport {
  open(url: URL, signal: AbortSignal): Promise<Response>;
}
export interface FileValidator {
  validate(bytes: Uint8Array): Promise<{ mime: string; pages?: number }>;
}
export interface ReceiptFileRecord {
  id: string;
  owner: string;
  client: string;
  company: string;
  workflow: string;
  generation: number;
  policy: number;
  mime: string;
  bytes: number;
  hash: string;
  expires: number;
  chunks: number;
}
export interface ReceiptChunk extends Ciphertext {
  index: number;
}
export interface ReceiptFileStore {
  put(
    record: ReceiptFileRecord,
    chunks: ReceiptChunk[],
    now: number,
  ): Promise<boolean>;
  get(
    id: string,
    owner: string,
    company: string,
  ): Promise<{ record: ReceiptFileRecord; chunks: ReceiptChunk[] } | null>;
  remove(id: string, owner: string, company: string): Promise<void>;
  removeWorkflow(
    workflow: string,
    owner: string,
    company: string,
  ): Promise<void>;
  cleanup(now: number): Promise<void>;
}
export const encodeFile = (bytes: Uint8Array) => {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(""));
};
export const decodeFile = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export async function fileDigest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
const binding = (r: ReceiptFileRecord, index: number) =>
  JSON.stringify(["receipt-file-v1", r, index]);
export class ReceiptFiles {
  constructor(
    readonly connections: Connections,
    readonly store: ReceiptFileStore,
    readonly source: (
      file: ClientFile,
    ) => Promise<{ bytes: Uint8Array; contentType: string | undefined }>,
    readonly validator: FileValidator,
    readonly enabled = false,
    readonly now = Date.now,
  ) {}
  private async authorize(
    actor: AccountingActor,
    company: string,
    write = false,
  ) {
    if (
      !actor.scopes.includes("mcp:read") ||
      !actor.scopes.includes("mcp:files")
    )
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    if (!this.enabled || (write && c.readOnly))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  async stagingContext(actor: AccountingActor, company: string) {
    z.string().uuid().parse(company);
    const c = await this.authorize(actor, company, true);
    return { company_id: c.id, company_name: c.name };
  }
  async ingest(actor: AccountingActor, company: string, input: unknown) {
    z.string().uuid().parse(company);
    const files = z
      .array(clientFile)
      .min(1)
      .max(receiptFileLimits.files)
      .parse(input);
    const c = await this.authorize(actor, company, true);
    const workflow = crypto.randomUUID();
    const records: ReceiptFileRecord[] = [];
    try {
      for (const input of files) {
        const { bytes, contentType } = await this.source(input);
        try {
          if (!bytes.length || bytes.length > receiptFileLimits.bytes)
            throw new ReceiptFileError("FILE_TOO_LARGE");
          const actual = await this.validator.validate(bytes);
          if (
            (input.mime_type && input.mime_type !== actual.mime) ||
            (contentType &&
              contentType !== actual.mime &&
              contentType !== "application/octet-stream")
          )
            throw new ReceiptFileError("FILE_INVALID");
          const current = await this.authorize(actor, company, true);
          if (
            current.generation !== c.generation ||
            current.policyVersion !== c.policyVersion
          )
            throw new DomainError("INTENT_CONFLICT");
          const record: ReceiptFileRecord = {
            id: crypto.randomUUID(),
            owner: actor.ownerId,
            client: actor.clientId,
            company,
            workflow,
            generation: c.generation,
            policy: c.policyVersion,
            mime: actual.mime,
            bytes: bytes.length,
            hash: await fileDigest(bytes),
            expires: this.now() + receiptFileLimits.ttlMs,
            chunks: Math.ceil(bytes.length / receiptFileLimits.chunkBytes),
          };
          const chunks: ReceiptChunk[] = [];
          for (
            let offset = 0;
            offset < bytes.length;
            offset += receiptFileLimits.chunkBytes
          ) {
            const index = chunks.length;
            chunks.push({
              index,
              ...(await this.connections.vault.sealData(
                encodeFile(
                  bytes.subarray(offset, offset + receiptFileLimits.chunkBytes),
                ),
                binding(record, index),
              )),
            });
          }
          if (!(await this.store.put(record, chunks, this.now())))
            throw new ReceiptFileError("FILE_LIMIT");
          records.push(record);
        } finally {
          bytes.fill(0);
        }
      }
      // Reject revocation, policy/disconnect races even after durable staging.
      const current = await this.authorize(actor, company, true);
      if (
        current.generation !== c.generation ||
        current.policyVersion !== c.policyVersion
      )
        throw new DomainError("INTENT_CONFLICT");
      return {
        company_id: company,
        workflow_id: workflow,
        files: records.map((r) => ({
          file_id: r.id,
          mime_type: r.mime,
          bytes: r.bytes,
          sha256: r.hash,
          expires_at: r.expires,
        })),
      };
    } catch (cause) {
      await this.store.removeWorkflow(workflow, actor.ownerId, company);
      if (cause instanceof DomainError || cause instanceof ReceiptFileError)
        throw cause;
      throw new ReceiptFileError("FILE_UNAVAILABLE");
    }
  }
  async read(actor: AccountingActor, input: ReceiptFileReference) {
    const ref = receiptFileReference.parse(input);
    const c = await this.authorize(actor, ref.company_id);
    const value = await this.store.get(ref.file_id, actor.ownerId, c.id);
    if (!value) throw new ReceiptFileError("FILE_UNAVAILABLE");
    const r = value.record;
    if (
      r.client !== actor.clientId ||
      r.workflow !== ref.workflow_id ||
      r.generation !== c.generation ||
      r.policy !== c.policyVersion
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    if (r.expires <= this.now()) throw new ReceiptFileError("FILE_EXPIRED");
    if (
      r.bytes < 1 ||
      r.bytes > receiptFileLimits.bytes ||
      r.chunks !== Math.ceil(r.bytes / receiptFileLimits.chunkBytes) ||
      value.chunks.length !== r.chunks
    )
      throw new ReceiptFileError("FILE_UNAVAILABLE");
    const bytes = new Uint8Array(r.bytes);
    try {
      let offset = 0;
      for (const [index, chunk] of value.chunks.entries()) {
        if (chunk.index !== index)
          throw new ReceiptFileError("FILE_UNAVAILABLE");
        const plain = await this.connections.vault.openData(
          chunk,
          binding(r, index),
        );
        if (typeof plain !== "string")
          throw new ReceiptFileError("FILE_UNAVAILABLE");
        const part = decodeFile(plain);
        if (
          part.length !==
          Math.min(receiptFileLimits.chunkBytes, r.bytes - offset)
        )
          throw new ReceiptFileError("FILE_UNAVAILABLE");
        bytes.set(part, offset);
        offset += part.length;
        part.fill(0);
      }
      if ((await fileDigest(bytes)) !== r.hash)
        throw new ReceiptFileError("FILE_UNAVAILABLE");
      const after = await this.authorize(actor, c.id);
      if (
        after.generation !== r.generation ||
        after.policyVersion !== r.policy ||
        r.expires <= this.now()
      )
        throw new ReceiptFileError("FILE_EXPIRED");
      return { record: r, bytes };
    } catch (cause) {
      bytes.fill(0);
      if (cause instanceof DomainError || cause instanceof ReceiptFileError)
        throw cause;
      throw new ReceiptFileError("FILE_UNAVAILABLE");
    }
  }
}
