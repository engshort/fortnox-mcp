import { z } from "zod";
import { accountingHash } from "./accounting.js";
import type { AccountingActor } from "./bookkeeping.js";
import type { Ciphertext, Connection, Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { assertScopeProgram } from "./programs.js";

export interface BusinessProposal {
  id: string;
  hash: string;
  operation: string;
  client: string;
  generation: number;
  policy: number;
  expires: number;
  body: Ciphertext;
}
export interface BusinessExecution {
  id: string;
  hash: string;
  operation: string;
  client: string;
  generation: number;
  created: number;
  state: "submitting" | "succeeded" | "failed" | "outcome_unknown";
  reference?: string | undefined;
  tenant?: string;
  evidence?: BusinessEvidence;
}
const businessEvidence = z
  .object({
    target: z.string().min(1).max(128).nullable(),
    fields: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]{0,63}$/)).max(64),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type BusinessEvidence = z.infer<typeof businessEvidence>;
export interface BusinessState {
  proposals: BusinessProposal[];
  executions: BusinessExecution[];
}
export const businessReference = z
  .object({
    company_id: z.string().uuid(),
    proposal_id: z.string().uuid(),
    proposal_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type BusinessReference = z.infer<typeof businessReference>;
export interface PreparedBusinessWrite {
  input: unknown;
  baseline: string | null;
  preview: unknown;
}
export type BusinessWriteResult = {
  state: "succeeded" | "failed" | "outcome_unknown";
  reference?: string | undefined;
};
// Only independently registered domain operations may be dispatched. No method,
// path, arbitrary body or approval assertion is accepted from an MCP caller.
export interface BusinessOperation {
  scope: string;
  enabled: boolean;
  evidence?(prepared: PreparedBusinessWrite): Promise<BusinessEvidence>;
  reconcile?(
    actor: AccountingActor,
    company: string,
    execution: BusinessExecution,
  ): Promise<BusinessWriteResult>;
  prepare(
    actor: AccountingActor,
    company: string,
    input: unknown,
  ): Promise<PreparedBusinessWrite>;
  validate(
    actor: AccountingActor,
    company: string,
    prepared: PreparedBusinessWrite,
  ): Promise<void>;
  dispatch(
    actor: AccountingActor,
    company: string,
    prepared: PreparedBusinessWrite,
    beforeDispatch: () => Promise<void>,
  ): Promise<BusinessWriteResult>;
}
export const businessBinding = (
  owner: string,
  company: string,
  p: BusinessProposal,
) =>
  JSON.stringify([
    owner,
    company,
    "business-proposal",
    p.id,
    p.hash,
    p.operation,
    p.client,
    p.generation,
    p.policy,
  ]);
export const retainBusinessExecution = (e: BusinessExecution, now: number) =>
  e.state === "submitting" ||
  e.state === "outcome_unknown" ||
  e.created > now - 2592000000;

function assertNoUnresolved(c: Connection) {
  if (
    c.business?.executions.some(
      (e) => e.state === "submitting" || e.state === "outcome_unknown",
    )
  )
    throw new DomainError("OUTCOME_UNKNOWN");
}

export class BusinessWrites {
  constructor(
    readonly connections: Connections,
    readonly operations: Readonly<Record<string, BusinessOperation>>,
    readonly now = Date.now,
  ) {}
  private operation(id: string) {
    const op = Object.hasOwn(this.operations, id)
      ? this.operations[id]
      : undefined;
    if (!op?.enabled) throw new DomainError("CAPABILITY_UNAVAILABLE");
    return op;
  }
  private async authorize(
    actor: AccountingActor,
    company: string,
    op: BusinessOperation,
    write = true,
  ) {
    if (
      !actor.scopes.includes("mcp:read") ||
      (write && !actor.scopes.includes("mcp:write"))
    )
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    assertScopeProgram(c, op.scope);
    if (!op.enabled || !c.scopes.includes(op.scope) || (write && c.readOnly))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (write) await this.connections.assertWritesAllowed();
    return c;
  }
  private bound(c: Connection, actor: AccountingActor, p: BusinessProposal) {
    if (
      p.client !== actor.clientId ||
      p.generation !== c.generation ||
      p.policy !== c.policyVersion ||
      p.expires <= this.now()
    )
      throw new DomainError("PROPOSAL_STALE");
  }
  async prepare(
    actor: AccountingActor,
    company: string,
    operation: string,
    input: unknown,
  ) {
    z.string().uuid().parse(company);
    const op = this.operation(operation);
    const before = await this.authorize(actor, company, op);
    assertNoUnresolved(before);
    const prepared = await op.prepare(actor, company, input);
    // Reject unbounded temporary bodies before allocating durable state.
    if (JSON.stringify(prepared).length > 16384)
      throw new DomainError("VALIDATION_FAILED");
    const p: BusinessProposal = {
      id: crypto.randomUUID(),
      hash: await accountingHash({ operation, prepared }),
      operation,
      client: actor.clientId,
      generation: before.generation,
      policy: before.policyVersion,
      expires: this.now() + 900000,
      body: { key: "", iv: "", data: "" },
    };
    p.body = await this.connections.vault.sealData(
      prepared,
      businessBinding(actor.ownerId, company, p),
    );
    await this.authorize(actor, company, op);
    await this.connections.mutate(actor.ownerId, company, (c) => {
      this.bound(c, actor, p);
      assertNoUnresolved(c);
      if (c.readOnly) throw new DomainError("CAPABILITY_UNAVAILABLE");
      c.business ??= { proposals: [], executions: [] };
      c.business.proposals = c.business.proposals.filter(
        (v) => v.expires > this.now(),
      );
      c.business.executions = c.business.executions.filter((v) =>
        retainBusinessExecution(v, this.now()),
      );
      if (
        c.business.proposals.length >= 4 ||
        c.business.executions.length >= 32
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      c.business.proposals.push(p);
    });
    return {
      company_id: company,
      proposal_id: p.id,
      proposal_hash: p.hash,
      expires_at: p.expires,
      preview: prepared.preview,
    };
  }
  async status(actor: AccountingActor, input: BusinessReference) {
    const ref = businessReference.parse(input);
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      ref.company_id,
    );
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    const e = c.business?.executions.find(
      (v) =>
        v.id === ref.proposal_id &&
        v.hash === ref.proposal_hash &&
        v.client === actor.clientId,
    );
    if (
      !e &&
      !c.business?.proposals.some(
        (p) =>
          p.id === ref.proposal_id &&
          p.hash === ref.proposal_hash &&
          p.client === actor.clientId &&
          p.expires > this.now() &&
          p.generation === c.generation &&
          p.policy === c.policyVersion,
      )
    )
      throw new DomainError("PROPOSAL_STALE");
    return e
      ? {
          state: e.state === "submitting" ? "outcome_unknown" : e.state,
          ...(e.reference ? { reference: e.reference } : {}),
        }
      : { state: "prepared" as const };
  }
  async execute(
    actor: AccountingActor,
    operation: string,
    input: BusinessReference,
  ) {
    const ref = businessReference.parse(input),
      op = this.operation(operation);
    const c = await this.authorize(actor, ref.company_id, op);
    const existing = c.business?.executions.find(
      (e) => e.id === ref.proposal_id,
    );
    if (existing) {
      if (
        existing.hash !== ref.proposal_hash ||
        existing.operation !== operation ||
        existing.client !== actor.clientId
      )
        throw new DomainError("INTENT_CONFLICT");
      return this.status(actor, ref);
    }
    assertNoUnresolved(c);
    const p = c.business?.proposals.find(
      (v) =>
        v.id === ref.proposal_id &&
        v.hash === ref.proposal_hash &&
        v.operation === operation,
    );
    if (!p) throw new DomainError("PROPOSAL_STALE");
    this.bound(c, actor, p);
    const prepared = (await this.connections.vault.openData(
      p.body,
      businessBinding(actor.ownerId, ref.company_id, p),
    )) as PreparedBusinessWrite;
    if ((await accountingHash({ operation, prepared })) !== p.hash)
      throw new DomainError("PROPOSAL_STALE");
    await op.validate(actor, ref.company_id, prepared);
    const evidence = op.evidence
      ? businessEvidence.parse(await op.evidence(prepared))
      : undefined;
    await this.authorize(actor, ref.company_id, op);
    await this.connections.mutate(actor.ownerId, ref.company_id, (current) => {
      this.bound(current, actor, p);
      assertNoUnresolved(current);
      if (
        current.readOnly ||
        !current.business?.proposals.some(
          (v) => v.id === p.id && v.hash === p.hash,
        )
      )
        throw new DomainError("PROPOSAL_STALE");
      if (current.business.executions.some((e) => e.id === p.id))
        throw new DomainError("INTENT_CONFLICT");
      if (current.business.executions.length >= 32)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      current.business.executions.push({
        id: p.id,
        hash: p.hash,
        operation,
        client: p.client,
        generation: p.generation,
        created: this.now(),
        state: "submitting",
        tenant: c.tenant,
        ...(evidence ? { evidence } : {}),
      });
      current.business.proposals = current.business.proposals.filter(
        (v) => v.id !== p.id,
      );
    });
    let dispatched = false;
    let result: BusinessWriteResult;
    try {
      result = await op.dispatch(actor, ref.company_id, prepared, async () => {
        if (dispatched) throw new DomainError("INTENT_CONFLICT");
        const active = await this.authorize(actor, ref.company_id, op);
        this.bound(active, actor, p);
        dispatched = true;
      });
      if (!dispatched) result = { state: "failed" };
      result = z
        .object({
          state: z.enum(["succeeded", "failed", "outcome_unknown"]),
          reference: z.string().min(1).max(128).optional(),
        })
        .strict()
        .parse(result);
    } catch {
      result = { state: dispatched ? "outcome_unknown" : "failed" };
    }
    // A lost state write leaves the durable claim uncertain. Never dispatch again.
    await this.connections.mutate(actor.ownerId, ref.company_id, (current) => {
      const e = current.business?.executions.find(
        (v) => v.id === p.id && v.hash === p.hash,
      );
      if (e?.state !== "submitting") throw new DomainError("INTENT_CONFLICT");
      e.state = result.state;
      if (result.reference) e.reference = result.reference;
    });
    await this.authorize(actor, ref.company_id, op);
    return result;
  }
  async reconcile(
    actor: AccountingActor,
    operation: string,
    input: BusinessReference,
  ) {
    const ref = businessReference.parse(input),
      op = this.operation(operation);
    const before = await this.authorize(actor, ref.company_id, op, false);
    const execution = before.business?.executions.find(
      (e) =>
        e.id === ref.proposal_id &&
        e.hash === ref.proposal_hash &&
        e.client === actor.clientId &&
        e.operation === operation,
    );
    if (!execution) throw new DomainError("PROPOSAL_STALE");
    if (execution.state === "succeeded" || execution.state === "failed")
      return this.status(actor, ref);
    if (
      execution.tenant
        ? execution.tenant !== before.tenant
        : execution.generation !== before.generation
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    // Allow all bounded dispatch/readback work to finish before reconciling a
    // claim interrupted by a crashed process. Absence never proves non-delivery.
    if (
      execution.state === "submitting" &&
      execution.created + 120000 > this.now()
    )
      return this.status(actor, ref);
    if (!op.reconcile) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const result = z
      .object({
        state: z.enum(["succeeded", "outcome_unknown"]),
        reference: z.string().min(1).max(128).optional(),
      })
      .strict()
      .parse(await op.reconcile(actor, ref.company_id, execution));
    await this.authorize(actor, ref.company_id, op, false);
    await this.connections.mutate(actor.ownerId, ref.company_id, (c) => {
      if (c.generation !== before.generation || c.tenant !== before.tenant)
        throw new DomainError("COMPANY_FORBIDDEN");
      const e = c.business?.executions.find(
        (e) =>
          e.id === execution.id &&
          e.hash === execution.hash &&
          e.client === actor.clientId,
      );
      if (!e) throw new DomainError("PROPOSAL_STALE");
      if (e.state === "submitting" || e.state === "outcome_unknown") {
        e.state = result.state;
        if (result.reference) e.reference = result.reference;
      }
    });
    return this.status(actor, ref);
  }
}
