import {
  accountingHash,
  type BridgeCatalog,
  type BridgeOperation,
  type BridgeSchema,
  bridgeSafePath,
  DomainError,
  type StateStore,
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
      (entry.method !== "GET" &&
        entry.method !== "HEAD" &&
        entry.effect !== "write") ||
      (/\/(?:email|einvoice|eprint|print|printreminder)$/.test(entry.path) &&
        entry.effect !== "write") ||
      (/^\/3\/(?:invoices(?:-v2)?|supplierinvoices|vouchers|accounts|sie|salarytransactions|employees)(?:\/|$)/.test(
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
    const catalog = await compileBridgeCatalog(JSON.parse(raw));
    this.cached = { id: active.id, catalog };
    return catalog;
  }
  async install(owner: string, input: unknown) {
    const catalog = await compileBridgeCatalog(input);
    const raw = JSON.stringify(bridgeCatalogInput.parse(input));
    if (raw.length > 8 * 1024 * 1024)
      throw new DomainError("VALIDATION_FAILED");
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
    const chunks = Math.ceil(raw.length / 16000);
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
          { id, data: raw.slice(n * 16000, (n + 1) * 16000) },
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
        { active: { slot, id, chunks } },
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
