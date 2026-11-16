import { z } from "zod";
import { accountingHash } from "./accounting.js";
import { type Actor, actorResource, hasPermission } from "./actor.js";
import { type BridgeSchema, bridgeObject } from "./bridge-schema.js";
import type { Connection, Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { assertNoUncertainWrites, assertScopeProgram } from "./programs.js";

export const bridgeLimits = {
  requestBytes: 1048576,
  responseBytes: 2097152,
  timeoutMs: 15000,
  executions: 32,
  retentionMs: 30 * 86400000,
} as const;
export interface BridgeOperation {
  id: string;
  method: string;
  path: string;
  scopes: string[];
  effect: "read" | "write";
  reconciliation: "none" | "exact_existing_target";
  finance: boolean;
  manualVouchers: boolean;
  files: boolean;
  unavailable: string | null;
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header";
    required: boolean;
    schema: BridgeSchema;
    style?: string;
    explode?: boolean;
  }>;
  request: Record<string, BridgeSchema>;
  bodyRequired: boolean;
}
export interface BridgeCatalog {
  revision: string;
  root: Record<string, unknown>;
  operations: readonly BridgeOperation[];
}
export interface BridgeExecution {
  id: string;
  key: string;
  subject: string;
  client: string;
  resource: "api";
  hash: string;
  operation: string;
  catalog: string;
  generation: number;
  policy: number;
  created: number;
  state: "submitting" | "succeeded" | "failed" | "outcome_unknown";
  providerStatus?: number;
  dispatched?: boolean;
  reference?: string;
  recovery?: BridgeRecovery;
}
export type BridgeShape = null | BridgeShape[] | { [key: string]: BridgeShape };
export interface BridgeRecovery {
  path: string;
  shape: BridgeShape;
  digest: string;
}
export const retainBridgeExecution = (e: BridgeExecution, now: number) =>
  ["submitting", "outcome_unknown"].includes(e.state) ||
  e.created > now - bridgeLimits.retentionMs;
export interface BridgeCall {
  operation: BridgeOperation;
  path: string;
  query: URLSearchParams;
  bytes: Uint8Array;
  contentType: string | null;
  headers: Headers;
}
export interface BridgeResult {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  state?: "succeeded" | "failed" | "outcome_unknown";
  reference?: string;
}
export interface BridgeProvider {
  validate(actor: Actor, company: string, call: BridgeCall): Promise<void>;
  dispatch(
    actor: Actor,
    company: string,
    call: BridgeCall,
    beforeDispatch: () => Promise<void>,
  ): Promise<BridgeResult>;
  recovery?(call: BridgeCall): Promise<BridgeRecovery | undefined>;
  reconcile?(
    actor: Actor,
    company: string,
    execution: BridgeExecution,
  ): Promise<"succeeded" | "outcome_unknown">;
}
const blockedHeaders = [
  "cookie",
  "tenantid",
  "access-token",
  "client-secret",
  "x-http-method-override",
  "x-method-override",
  "x-forwarded-host",
  "x-original-url",
  "x-rewrite-url",
];
export class FortnoxBridge {
  constructor(
    readonly connections: Connections,
    readonly provider: BridgeProvider,
    readonly catalog: () => Promise<BridgeCatalog | null>,
    readonly now = Date.now,
  ) {}
  async authorize(
    actor: Actor,
    company: string,
    op?: BridgeOperation,
    write = false,
  ) {
    z.string().uuid().parse(company);
    if (actorResource(actor) !== "api" || !hasPermission(actor, "read"))
      throw new DomainError("AUTH_REQUIRED");
    if (!hasPermission(actor, "bridge"))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const c = await this.connections.authorizeActor(actor, company);
    if (op) this.checkOperation(actor, c, op);
    if (write && op?.effect === "write")
      await this.connections.assertWritesAllowed();
    return c;
  }
  private checkOperation(actor: Actor, c: Connection, op: BridgeOperation) {
    if (
      op.unavailable ||
      !op.scopes.length ||
      (op.finance && !hasPermission(actor, "finance_read")) ||
      (op.files && !hasPermission(actor, "files"))
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    for (const scope of op.scopes) {
      assertScopeProgram(c, scope);
      if (!c.scopes.includes(scope))
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    }
    if (op.effect === "write" && (c.readOnly || !hasPermission(actor, "write")))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    // Manual accounting can never be relabelled as a general mutation by a
    // catalogue. Editing/deleting vouchers needs its own domain implementation.
    if (op.effect === "write" && op.manualVouchers) {
      if (c.review === "review_required")
        throw new DomainError("REVIEW_REQUIRED");
      if (op.method !== "POST" || op.path !== "/3/vouchers")
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    }
  }
  async operations(actor: Actor, company: string) {
    const before = await this.authorize(actor, company);
    const catalog = await this.catalog();
    const operations = [];
    for (const op of catalog?.operations ?? []) {
      let reason: string | null = op.unavailable;
      try {
        this.checkOperation(actor, before, op);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        reason ??= error.code;
      }
      operations.push({
        operation_id: op.id,
        method: op.method,
        path: op.path,
        scopes: op.scopes,
        effect: op.effect,
        reconciliation: op.reconciliation,
        finance: op.finance,
        manual_vouchers: op.manualVouchers,
        files: op.files,
        available: reason === null,
        reason,
      });
    }
    const after = await this.authorize(actor, company);
    if (
      before.generation !== after.generation ||
      before.accessRevision !== after.accessRevision ||
      before.policyVersion !== after.policyVersion
    )
      throw new DomainError("CONNECTION_CONFLICT");
    return {
      catalog_revision: catalog?.revision ?? null,
      reason: catalog ? null : "catalog_missing",
      operations,
    };
  }
  async status(actor: Actor, company: string, id: string) {
    z.string().uuid().parse(id);
    const c = await this.authorize(actor, company);
    const e = c.bridge?.executions.find(
      (v) => v.id === id && this.owns(actor, v),
    );
    if (!e) throw new DomainError("RESOURCE_NOT_FOUND");
    return {
      execution_id: e.id,
      state: e.state === "submitting" ? "outcome_unknown" : e.state,
      provider_status: e.providerStatus ?? null,
      reference: e.reference ?? null,
    };
  }
  private owns(actor: Actor, e: BridgeExecution) {
    return (
      e.subject === (actor.subjectId ?? actor.ownerId) &&
      e.client === (actor.oauthClientId ?? actor.clientId) &&
      e.resource === "api"
    );
  }
  async reconcile(actor: Actor, company: string, id: string) {
    await this.status(actor, company, id);
    const c = await this.authorize(actor, company);
    const e = c.bridge?.executions.find(
      (v) => v.id === id && this.owns(actor, v),
    );
    if (
      e &&
      e.generation === c.generation &&
      (e.state === "outcome_unknown" ||
        (e.state === "submitting" && e.created + 120000 < this.now())) &&
      e.recovery &&
      this.provider.reconcile &&
      (await this.catalog())?.revision === e.catalog
    ) {
      const read = (await this.catalog())?.operations.find(
        (op) =>
          op.method === "GET" &&
          op.effect === "read" &&
          bridgePathMatch(op.path, e.recovery?.path ?? ""),
      );
      if (!read) return this.status(actor, company, id);
      await this.authorize(actor, company, read);
      const state = await this.provider.reconcile(actor, company, e);
      const after = await this.authorize(actor, company);
      if (after.generation !== e.generation)
        throw new DomainError("CONNECTION_CONFLICT");
      if (state === "succeeded")
        await this.connections.mutate(actor.ownerId, company, (current) => {
          const saved = current.bridge?.executions.find(
            (v) => v.id === id && this.owns(actor, v),
          );
          if (
            !saved ||
            saved.hash !== e.hash ||
            current.generation !== e.generation
          )
            throw new DomainError("CONNECTION_CONFLICT");
          if (["submitting", "outcome_unknown"].includes(saved.state))
            saved.state = "succeeded";
        });
    }
    return this.status(actor, company, id);
  }
  async execute(
    actor: Actor,
    company: string,
    call: BridgeCall,
    authenticate: () => Promise<unknown>,
  ) {
    for (const header of blockedHeaders)
      if (call.headers.has(header)) throw new DomainError("VALIDATION_FAILED");
    const catalog = await this.catalog();
    if (!catalog?.operations.includes(call.operation))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const before = await this.authorize(actor, company, call.operation, true);
    const mutation = call.operation.effect === "write";
    const beforeDispatch = async () => {
      await authenticate();
      if ((await this.catalog())?.revision !== catalog.revision)
        throw new DomainError("CONNECTION_CONFLICT");
      const current = await this.authorize(
        actor,
        company,
        call.operation,
        true,
      );
      if (
        current.generation !== before.generation ||
        current.policyVersion !== before.policyVersion ||
        current.accessRevision !== before.accessRevision
      )
        throw new DomainError("CONNECTION_CONFLICT");
    };
    if (!mutation) {
      await this.provider.validate(actor, company, call);
      const result = await this.provider.dispatch(
        actor,
        company,
        call,
        beforeDispatch,
      );
      await beforeDispatch();
      return { result };
    }
    const key = z.string().uuid().parse(call.headers.get("idempotency-key"));
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(call.bytes)),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const hash = await accountingHash({
      method: call.operation.method,
      path: call.path,
      query: [...call.query],
      type: call.contentType,
      body: digest,
      headers: call.operation.parameters
        .filter((p) => p.in === "header")
        .map((p) => [p.name.toLowerCase(), call.headers.get(p.name)]),
      precondition: call.headers.get("if-match"),
      removed: call.headers.get("x-fortnox-removed-row-ids"),
      currency: call.headers.get("x-fortnox-currency"),
    });
    const existing = before.bridge?.executions.find(
      (e) => e.key === key && this.owns(actor, e),
    );
    if (existing) {
      if (existing.hash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT");
      await authenticate();
      return { execution: await this.status(actor, company, existing.id) };
    }
    assertNoUncertainWrites(before);
    await this.provider.validate(actor, company, call);
    const recovery = await this.provider.recovery?.(call);
    await beforeDispatch();
    const execution: BridgeExecution = {
      id: crypto.randomUUID(),
      key,
      subject: actor.subjectId ?? actor.ownerId,
      client: actor.oauthClientId ?? actor.clientId,
      resource: "api",
      hash,
      operation: call.operation.id,
      catalog: catalog.revision,
      generation: before.generation,
      policy: before.policyVersion,
      created: this.now(),
      state: "submitting",
    };
    if (recovery) execution.recovery = recovery;
    const claimed = await this.connections.mutate(
      actor.ownerId,
      company,
      (c) => {
        if (
          c.generation !== before.generation ||
          c.policyVersion !== before.policyVersion ||
          c.readOnly
        )
          throw new DomainError("CONNECTION_CONFLICT");
        const duplicate = c.bridge?.executions.find(
          (e) => e.key === key && this.owns(actor, e),
        );
        if (duplicate) {
          if (duplicate.hash !== hash)
            throw new DomainError("IDEMPOTENCY_CONFLICT");
          return;
        }
        assertNoUncertainWrites(c);
        c.bridge ??= { executions: [] };
        c.bridge.executions = c.bridge.executions.filter((e) =>
          retainBridgeExecution(e, this.now()),
        );
        if (c.bridge.executions.length >= bridgeLimits.executions)
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        c.bridge.executions.push(execution);
        c.financialRevision = (c.financialRevision ?? 0) + 1;
      },
    );
    const retained = claimed.bridge?.executions.find(
      (e) => e.key === key && this.owns(actor, e),
    );
    if (retained && retained.id !== execution.id) {
      await authenticate();
      return { execution: await this.status(actor, company, retained.id) };
    }
    let result: BridgeResult | undefined;
    let dispatched = false;
    try {
      result = await this.provider.dispatch(actor, company, call, async () => {
        if (dispatched) throw new DomainError("INTENT_CONFLICT");
        await beforeDispatch();
        await this.connections.mutate(actor.ownerId, company, (c) => {
          const saved = c.bridge?.executions.find((e) => e.id === execution.id);
          if (saved?.state !== "submitting" || saved.dispatched)
            throw new DomainError("INTENT_CONFLICT");
          saved.dispatched = true;
        });
        dispatched = true;
      });
    } catch {
      /* Only a proven pre-dispatch failure is terminal. Interrupted claims
         remain unknown after restart even when their dispatch marker is absent. */
    }
    try {
      await this.connections.mutate(actor.ownerId, company, (c) => {
        const saved = c.bridge?.executions.find((e) => e.id === execution.id);
        if (!saved) throw new DomainError("OUTCOME_UNKNOWN");
        saved.state =
          result?.state ?? (dispatched ? "outcome_unknown" : "failed");
        if (result) saved.providerStatus = result.status;
        if (result?.reference) saved.reference = result.reference;
      });
    } catch {
      throw new DomainError("OUTCOME_UNKNOWN");
    }
    await authenticate();
    await beforeDispatch();
    if (!result || result.state === "outcome_unknown")
      return { execution: await this.status(actor, company, execution.id) };
    return {
      result,
      execution: await this.status(actor, company, execution.id),
    };
  }
}
export function bridgePathMatch(template: string, path: string) {
  const expected = template.split("/"),
    actual = path.split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const key = expected[i] ?? "",
      part = actual[i] ?? "";
    if (key.startsWith("{") && key.endsWith("}")) {
      if (!part) return null;
      params[key.slice(1, -1)] = decodeURIComponent(part);
    } else if (key !== part) return null;
  }
  return params;
}
export function bridgeSafePath(path: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new DomainError("VALIDATION_FAILED");
  }
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\?#]/.test(decoded) ||
    [...decoded].some(
      (c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127,
    ) ||
    /%[0-9a-f]{2}/i.test(decoded) ||
    decoded.split("/").some((p) => p === "." || p === "..") ||
    /%2f/i.test(path)
  )
    throw new DomainError("VALIDATION_FAILED");
  return path;
}
export function bridgeField(value: unknown, field: string) {
  return bridgeObject(value)[field];
}
