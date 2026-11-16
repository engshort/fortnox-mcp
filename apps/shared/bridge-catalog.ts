import {
  accountingHash,
  type BridgeCatalog,
  type BridgeOperation,
  type BridgeSchema,
  bridgeSafePath,
  DomainError,
  type StateStore,
  syncResources,
} from "@fortnox-mcp/core";
import { z } from "zod";
import {
  object,
  parseOpenApi,
  resolveObject,
} from "../../packages/docs/src/openapi.js";

const review = z
  .object({
    operation_id: z.string().min(1).max(1000),
    method: z.enum([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]),
    path: z.string().min(1).max(1024),
    scopes: z.array(z.string().regex(/^[a-z][a-z0-9:_-]{0,63}$/)).max(16),
    effect: z.enum(["read", "write"]),
    reconciliation: z.enum(["none", "exact_existing_target"]).default("none"),
    finance: z.boolean(),
    manual_vouchers: z.boolean(),
    files: z.boolean(),
    credentials: z.enum(["company_oauth", "specialist"]),
    unavailable: z
      .enum([
        "specialist_credentials_required",
        "domain_validation_required",
        "unsupported_media_type",
      ])
      .nullable(),
  })
  .strict();
export const bridgeCatalogInput = z
  .object({
    version: z.literal("fortnox-bridge-catalog-v1"),
    specification: z
      .string()
      .min(1)
      .max(8 * 1024 * 1024),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    operations: z.array(review).min(1).max(1000),
  })
  .strict();
export async function compileBridgeCatalog(
  input: unknown,
): Promise<BridgeCatalog> {
  const bundle = bridgeCatalogInput.parse(input);
  const source = await parseOpenApi(
    bundle.specification,
    new Date(0).toISOString(),
  );
  if (
    source.source.sha256 !== bundle.source_sha256 ||
    source.operations.size !== bundle.operations.length
  )
    throw new DomainError("VALIDATION_FAILED");
  const seen = new Set<string>(),
    patterns = new Set<string>();
  const operations: BridgeOperation[] = [];
  for (const entry of bundle.operations) {
    const sourceOp = source.operations.get(entry.operation_id);
    if (
      !sourceOp ||
      seen.has(entry.operation_id) ||
      sourceOp.method !== entry.method ||
      sourceOp.path !== entry.path
    )
      throw new DomainError("VALIDATION_FAILED");
    seen.add(entry.operation_id);
    if (!entry.unavailable && !entry.scopes.length)
      throw new DomainError("VALIDATION_FAILED");
    bridgeSafePath(entry.path);
    if (
      entry.effect === "write" &&
      /^\/3\/vouchers(?:\/|$)/.test(entry.path) &&
      !entry.manual_vouchers
    )
      throw new DomainError("VALIDATION_FAILED");
    if (
      (entry.method !== "GET" &&
        entry.method !== "HEAD" &&
        entry.effect !== "write") ||
      (/\/(?:email|einvoice|eprint|print|printreminder)$/.test(entry.path) &&
        entry.effect !== "write") ||
      (/^\/3\/(?:invoices(?:-v2)?|supplierinvoices|invoicepayments|supplierinvoicepayments|vouchers|accounts|sie|salarytransactions|employees)(?:\/|$)/.test(
        entry.path,
      ) &&
        !entry.finance) ||
      (/^\/3\/(?:inbox|archive|.*fileconnections)(?:\/|$)/.test(entry.path) &&
        !entry.files)
    )
      throw new DomainError("VALIDATION_FAILED");
    const pattern = `${entry.method} ${entry.path.replace(/\{[^}]+\}/g, "{}")}`;
    if (patterns.has(pattern)) throw new DomainError("VALIDATION_FAILED");
    patterns.add(pattern);
    // The catalogue cannot authorize an upstream server URL or authentication
    // declaration. Only the fixed Fortnox origin and owned connection are used.
    const parameterMap = new Map<
      string,
      BridgeOperation["parameters"][number]
    >();
    for (const raw of [
      ...(Array.isArray(sourceOp.pathItem.parameters)
        ? sourceOp.pathItem.parameters
        : []),
      ...(Array.isArray(sourceOp.raw.parameters)
        ? sourceOp.raw.parameters
        : []),
    ]) {
      const p = resolveObject(source.root, raw);
      if (
        !["path", "query", "header"].includes(String(p.in)) ||
        typeof p.name !== "string" ||
        !p.schema
      )
        throw new DomainError("VALIDATION_FAILED");
      if (
        p.in === "header" &&
        ![
          "accept",
          "content-type",
          "if-match",
          "if-unmodified-since",
          "range",
        ].includes(p.name.toLowerCase())
      )
        throw new DomainError("VALIDATION_FAILED");
      parameterMap.set(`${p.in}:${p.name}`, {
        name: p.name,
        in: p.in as "path" | "query" | "header",
        required: p.required === true,
        schema: p.schema as BridgeSchema,
        ...(typeof p.style === "string" ? { style: p.style } : {}),
        ...(typeof p.explode === "boolean" ? { explode: p.explode } : {}),
      });
    }
    // Reviewed global read parameters, absent from some provider snapshots.
    // Never apply these overlays to arbitrary paths or effectful GETs.
    const syncProfile = syncResources.find(
      (r) =>
        entry.path === r.path ||
        (r.yearly && entry.path.startsWith(`${r.path}/`)),
    );
    if (entry.method === "GET" && entry.effect === "read" && syncProfile) {
      if (entry.path === syncProfile.path) {
        for (const name of ["page", "limit"]) {
          if (!parameterMap.has(`query:${name}`))
            parameterMap.set(`query:${name}`, {
              name,
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 1,
                maximum: name === "limit" ? 100 : 1000000,
              },
            });
        }
      }
      if (syncProfile.yearly)
        parameterMap.set("query:financialyear", {
          name: "financialyear",
          in: "query",
          required: true,
          schema: { type: "integer", minimum: 1, maximum: 2147483647 },
        });
    }
    const body = sourceOp.raw.requestBody
      ? resolveObject(source.root, sourceOp.raw.requestBody)
      : null;
    const request: Record<string, BridgeSchema> = {};
    if (body)
      for (const [type, raw] of Object.entries(object(body.content))) {
        const content = object(raw);
        if (!content.schema) throw new DomainError("VALIDATION_FAILED");
        request[type === "*/*" ? "application/json" : type] =
          content.schema as BridgeSchema;
      }
    const unavailable =
      entry.unavailable ??
      (entry.credentials === "specialist"
        ? "specialist_credentials_required"
        : null);
    operations.push({
      id: entry.operation_id,
      method: entry.method,
      path: entry.path,
      scopes: entry.scopes,
      effect: entry.effect,
      reconciliation: entry.reconciliation,
      finance: entry.finance,
      manualVouchers: entry.manual_vouchers,
      files: entry.files,
      unavailable,
      parameters: [...parameterMap.values()],
      request,
      bodyRequired: body?.required === true,
    });
  }
  // Prefer concrete paths over parameter paths (e.g. a /status action).
  operations.sort(
    (a, b) =>
      (a.path.match(/\{/g)?.length ?? 0) - (b.path.match(/\{/g)?.length ?? 0),
  );
  return {
    revision: await accountingHash(bundle),
    root: source.root,
    operations,
  };
}
interface Active {
  encoding?: "gzip-base64";
  slot: number;
  id: string;
  chunks: number;
}
interface Directory {
  active?: Active;
  upload?: { slot: number; id: string; until: number };
}
export class BridgeCatalogStore {
  private cached?: { id: string; catalog: BridgeCatalog };
  constructor(
    readonly state: StateStore,
    readonly owner: () => Promise<string>,
    readonly now = Date.now,
  ) {}
  private chunkId(owner: string, slot: number, index: number) {
    return `${owner}:${slot}:${index}`;
  }
  async current(): Promise<BridgeCatalog | null> {
    const owner = await this.owner();
    const row = await this.state.get<Directory>("bridge-catalog", owner);
    const active = row?.value.active;
    if (!active) return null;
    if (
      !Number.isInteger(active.chunks) ||
      active.chunks < 1 ||
      active.chunks > (active.encoding ? 100 : 600)
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (this.cached?.id === active.id) return this.cached.catalog;
    let raw = "";
    for (let n = 0; n < active.chunks; n++) {
      const chunk = await this.state.get<{ id: string; data: string }>(
        "bridge-catalog-chunks",
        this.chunkId(owner, active.slot, n),
      );
      if (chunk?.value?.id !== active.id)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      raw += chunk.value.data;
    }
    if (active.encoding === "gzip-base64") {
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      if (bytes.length > 1048576)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      const stream = new Response(bytes).body;
      if (!stream) throw new DomainError("CAPABILITY_UNAVAILABLE");
      const reader = stream
        .pipeThrough(new DecompressionStream("gzip"))
        .getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 8 * 1024 * 1024) {
            await reader.cancel();
            throw new DomainError("CAPABILITY_UNAVAILABLE");
          }
          parts.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const decoded = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        decoded.set(part, offset);
        offset += part.length;
      }
      raw = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    }
    const catalog = await compileBridgeCatalog(JSON.parse(raw));
    this.cached = { id: active.id, catalog };
    return catalog;
  }
  async install(owner: string, input: unknown) {
    const catalog = await compileBridgeCatalog(input);
    const raw = JSON.stringify(bridgeCatalogInput.parse(input));
    if (new TextEncoder().encode(raw).length > 8 * 1024 * 1024)
      throw new DomainError("VALIDATION_FAILED");
    const stream = new Response(raw).body;
    if (!stream) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const compressed = new Uint8Array(
      await new Response(
        stream.pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    if (compressed.length > 1048576)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    let binary = "";
    for (let n = 0; n < compressed.length; n += 16384)
      binary += String.fromCharCode(...compressed.subarray(n, n + 16384));
    const stored = btoa(binary);
    const row = await this.state.get<Directory>("bridge-catalog", owner);
    if (row?.value.upload && row.value.upload.until > this.now())
      throw new DomainError("CONNECTION_CONFLICT");
    const slot = row?.value.active?.slot === 0 ? 1 : 0,
      id = crypto.randomUUID();
    const next: Directory = {
      ...row?.value,
      upload: { slot, id, until: this.now() + 60000 },
    };
    if (
      !(await this.state.put(
        "bridge-catalog",
        owner,
        next,
        row?.version ?? null,
      ))
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const chunks = Math.ceil(stored.length / 16000);
    for (let n = 0; n < chunks; n++) {
      const key = this.chunkId(owner, slot, n);
      const prior = await this.state.get("bridge-catalog-chunks", key);
      const claim = await this.state.get<Directory>("bridge-catalog", owner);
      if (
        claim?.value.upload?.id !== id ||
        claim.value.upload.until <= this.now()
      )
        throw new DomainError("CONNECTION_CONFLICT");
      if (
        !(await this.state.put(
          "bridge-catalog-chunks",
          key,
          { id, data: stored.slice(n * 16000, (n + 1) * 16000) },
          prior?.version ?? null,
        ))
      )
        throw new DomainError("CONNECTION_CONFLICT");
    }
    const current = await this.state.get<Directory>("bridge-catalog", owner);
    if (
      current?.value.upload?.id !== id ||
      !(await this.state.put(
        "bridge-catalog",
        owner,
        { active: { slot, id, chunks, encoding: "gzip-base64" } },
        current.version,
      ))
    )
      throw new DomainError("CONNECTION_CONFLICT");
    this.cached = { id, catalog };
    return {
      revision: catalog.revision,
      operations: catalog.operations.length,
    };
  }
}
