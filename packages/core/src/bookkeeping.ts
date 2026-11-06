import { z } from "zod";
import {
  type AccountingReferences,
  accountingHash,
  type VoucherInput,
  validateVoucher,
  voucherInput,
} from "./accounting.js";
import type { Ciphertext, Connection, Connections } from "./connections.js";
import { DomainError } from "./errors.js";

export const voucherReference = z
  .object({
    financial_year: z.number().int().positive().safe(),
    series: z.string().regex(/^[A-Z0-9]{1,8}$/),
    number: z.number().int().positive().safe(),
  })
  .strict();
export type VoucherReference = z.infer<typeof voucherReference>;
export interface AccountingActor {
  ownerId: string;
  clientId: string;
  scopes: readonly string[];
}
export interface AccountingProvider {
  references(
    actor: AccountingActor,
    company: string,
    year: number,
  ): Promise<AccountingReferences>;
  submit(
    actor: AccountingActor,
    voucher: VoucherInput,
    beforeDispatch: () => Promise<void>,
  ): Promise<SubmitResult>;
  // Only an exact reference previously returned by this provider can reconcile an intent.
  read(
    actor: AccountingActor,
    company: string,
    reference: VoucherReference,
  ): Promise<VoucherInput>;
}
export type SubmitResult =
  | { state: "succeeded"; reference: VoucherReference }
  | { state: "failed"; code: string }
  | { state: "outcome_unknown"; reference?: VoucherReference };
export interface VoucherProposal {
  id: string;
  hash: string;
  client: string;
  generation: number;
  policy: number;
  expires: number;
  reviewExpires: number;
  capabilityHash: string;
  body: Ciphertext;
}
export interface VoucherExecution {
  id: string;
  hash: string;
  generation: number;
  policy: number;
  client: string;
  created: number;
  state: "submitting" | "succeeded" | "failed" | "outcome_unknown";
  dispatched: boolean;
  reference?: VoucherReference;
  code?: string;
}
export interface BookkeepingState {
  proposals: VoucherProposal[];
  executions: VoucherExecution[];
}
export const proposalReference = z
  .object({
    company_id: z.string().uuid(),
    proposal_id: z.string().uuid(),
    proposal_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const reviewCommitInput = proposalReference
  .extend({ capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export type ProposalReference = z.infer<typeof proposalReference>;
export interface AccountingGates {
  references: boolean;
  writes: boolean;
  reviewHost: boolean;
}

export class Bookkeeping {
  constructor(
    readonly connections: Connections,
    readonly provider: AccountingProvider,
    readonly gates: AccountingGates,
    readonly now = Date.now,
  ) {}
  private async authorize(
    actor: AccountingActor,
    company: string,
    write = false,
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
    if (!this.gates.references) throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (write && (!this.gates.writes || c.readOnly))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  async references(actor: AccountingActor, company: string, year: number) {
    await this.authorize(actor, company);
    z.number().int().positive().safe().parse(year);
    const refs = await this.provider.references(actor, company, year);
    await this.authorize(actor, company);
    if (refs.company_id !== company || refs.financial_year !== year)
      throw new DomainError("COMPANY_FORBIDDEN");
    return refs;
  }
  private binding(
    owner: string,
    company: string,
    p: Pick<VoucherProposal, "id" | "hash" | "generation" | "policy">,
  ) {
    return JSON.stringify([
      owner,
      company,
      "voucher-proposal",
      p.id,
      p.hash,
      p.generation,
      p.policy,
    ]);
  }
  private check(
    c: Connection,
    p: VoucherProposal,
    actor: AccountingActor,
    hash: string,
  ) {
    if (
      c.state !== "active" ||
      c.generation !== p.generation ||
      c.policyVersion !== p.policy ||
      p.client !== actor.clientId ||
      p.hash !== hash ||
      p.expires <= this.now()
    )
      throw new DomainError("INTENT_CONFLICT");
  }
  async prepare(actor: AccountingActor, input: unknown) {
    const value = voucherInput.parse(input);
    const c = await this.authorize(actor, value.company_id);
    if (!actor.scopes.includes("mcp:write"))
      throw new DomainError("AUTH_REQUIRED");
    if (c.readOnly) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const validated = validateVoucher(
      value,
      await this.references(actor, c.id, value.financial_year),
      this.now(),
    );
    const hash = await accountingHash(validated.voucher);
    const capability = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const p: VoucherProposal = {
      id: crypto.randomUUID(),
      hash,
      client: actor.clientId,
      generation: c.generation,
      policy: c.policyVersion,
      expires: this.now() + 86400000,
      reviewExpires: this.now() + 900000,
      capabilityHash: await accountingHash(capability),
      body: { key: "", iv: "", data: "" },
    };
    p.body = await this.connections.vault.sealData(
      validated.voucher,
      this.binding(actor.ownerId, c.id, p),
    );
    await this.connections.mutate(actor.ownerId, c.id, (current) => {
      this.check(current, p, actor, hash);
      if (current.readOnly) throw new DomainError("CAPABILITY_UNAVAILABLE");
      current.bookkeeping ??= {
        proposals: [],
        executions: [],
      };
      const ledger = current.bookkeeping;
      if (
        ledger.executions.some(
          (e) =>
            e.hash === hash &&
            ["submitting", "outcome_unknown"].includes(e.state),
        )
      )
        throw new DomainError("OUTCOME_UNKNOWN");
      ledger.proposals = ledger.proposals.filter(
        (v) =>
          v.expires > this.now() &&
          !ledger.executions.some((e) => e.id === v.id),
      );
      if (ledger.proposals.length >= 8)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      ledger.proposals.push(p);
    });
    return {
      company_id: c.id,
      company_name: c.name,
      proposal_id: p.id,
      proposal_hash: hash,
      expires_at: p.expires,
      review_expires_at: p.reviewExpires,
      voucher: validated.voucher,
      totals: validated.totals,
      capability,
    };
  }
  async validate(actor: AccountingActor, input: unknown) {
    const value = voucherInput.parse(input);
    const refs = await this.references(
      actor,
      value.company_id,
      value.financial_year,
    );
    return validateVoucher(value, refs, this.now());
  }
  async proposal(actor: AccountingActor, input: ProposalReference) {
    const ref = proposalReference.parse(input);
    const c = await this.authorize(actor, ref.company_id);
    const p = c.bookkeeping?.proposals.find((p) => p.id === ref.proposal_id);
    if (!p) throw new DomainError("INTENT_CONFLICT");
    this.check(c, p, actor, ref.proposal_hash);
    const voucher = voucherInput.parse(
      await this.connections.vault.openData(
        p.body,
        this.binding(actor.ownerId, c.id, p),
      ),
    );
    if ((await accountingHash(voucher)) !== p.hash)
      throw new DomainError("INTENT_CONFLICT");
    return { c, p, voucher };
  }
  async status(actor: AccountingActor, input: ProposalReference) {
    const ref = proposalReference.parse(input);
    const c = await this.authorize(actor, ref.company_id);
    const e = c.bookkeeping?.executions.find((v) => v.id === ref.proposal_id);
    if (e) {
      if (
        e.hash !== ref.proposal_hash ||
        e.generation !== c.generation ||
        e.client !== actor.clientId
      )
        throw new DomainError("INTENT_CONFLICT");
      // A durable submitting record is never reclaimed/retried after a crash.
      return {
        state:
          e.state === "submitting" ? ("outcome_unknown" as const) : e.state,
        reference: e.reference ?? null,
        code: e.code ?? null,
      };
    }
    const { p } = await this.proposal(actor, ref);
    return {
      state: p.reviewExpires <= this.now() ? "review_expired" : "prepared",
      reference: null,
      code: null,
    };
  }
  async commit(
    actor: AccountingActor,
    input: unknown,
    mode: "review" | "client",
  ) {
    const ref =
      mode === "review"
        ? reviewCommitInput.parse(input)
        : proposalReference.parse(input);
    const { c, p, voucher } = await this.proposal(actor, {
      company_id: ref.company_id,
      proposal_id: ref.proposal_id,
      proposal_hash: ref.proposal_hash,
    });
    await this.authorize(actor, c.id, true);
    if (mode === "review") {
      if (!this.gates.reviewHost) throw new DomainError("CLIENT_UNSUPPORTED");
      if (
        c.review !== "review_required" ||
        p.reviewExpires <= this.now() ||
        !("capability" in ref) ||
        (await accountingHash(ref.capability)) !== p.capabilityHash
      )
        throw new DomainError("INTENT_CONFLICT");
    } else if (c.review !== "client_managed")
      throw new DomainError("CLIENT_UNSUPPORTED");
    // Current company-bound references immediately before the one durable claim.
    validateVoucher(
      voucher,
      await this.references(actor, c.id, voucher.financial_year),
      this.now(),
    );
    await this.connections.mutate(actor.ownerId, c.id, (current) => {
      this.check(current, p, actor, ref.proposal_hash);
      if (mode === "review" && p.reviewExpires <= this.now())
        throw new DomainError("INTENT_CONFLICT");
      if (current.readOnly || current.review !== c.review)
        throw new DomainError("INTENT_CONFLICT");
      const ledger = current.bookkeeping;
      const saved = ledger?.proposals.find((v) => v.id === p.id);
      if (
        !ledger ||
        !saved ||
        saved.hash !== p.hash ||
        ledger.executions.some((e) => e.id === p.id)
      )
        throw new DomainError("INTENT_CONFLICT");
      if (
        ledger.executions.some(
          (e) =>
            e.hash === p.hash &&
            ["submitting", "outcome_unknown"].includes(e.state),
        )
      )
        throw new DomainError("OUTCOME_UNKNOWN");
      // Never evict unknown outcomes to make room for new work.
      ledger.executions = ledger.executions.filter(
        (e) =>
          e.state === "outcome_unknown" ||
          e.state === "submitting" ||
          e.created > this.now() - 2592000000,
      );
      if (ledger.executions.length >= 32)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      ledger.executions.push({
        id: p.id,
        hash: p.hash,
        generation: p.generation,
        policy: p.policy,
        client: actor.clientId,
        created: this.now(),
        state: "submitting",
        dispatched: false,
      });
    });
    let result: SubmitResult;
    try {
      result = await this.provider.submit(actor, voucher, async () => {
        await this.authorize(actor, c.id, true);
        await this.connections.mutate(actor.ownerId, c.id, (current) => {
          this.check(current, p, actor, p.hash);
          if (mode === "review" && p.reviewExpires <= this.now())
            throw new DomainError("INTENT_CONFLICT");
          const e = current.bookkeeping?.executions.find((v) => v.id === p.id);
          if (e?.state !== "submitting" || e.dispatched || current.readOnly)
            throw new DomainError("INTENT_CONFLICT");
          e.dispatched = true;
        });
      });
      if (
        result.state === "succeeded" &&
        (voucherReference.parse(result.reference).financial_year !==
          voucher.financial_year ||
          result.reference.series !== voucher.series)
      )
        result = { state: "outcome_unknown" };
      if (result.state === "succeeded") {
        const trusted = result.reference;
        try {
          const actual = await this.provider.read(actor, c.id, trusted);
          if ((await accountingHash(voucherInput.parse(actual))) !== p.hash)
            result = { state: "outcome_unknown", reference: trusted };
        } catch {
          result = { state: "outcome_unknown", reference: trusted };
        }
      }
    } catch {
      result = { state: "outcome_unknown" };
    }
    // A late result may update minimal intent evidence; never credentials/policy/generation.
    try {
      await this.connections.mutate(actor.ownerId, c.id, (current) => {
        const e = current.bookkeeping?.executions.find((v) => v.id === p.id);
        if (!e || e.hash !== p.hash || e.state !== "submitting")
          throw new DomainError("INTENT_CONFLICT");
        if (!e.dispatched) result = { state: "outcome_unknown" };
        e.state = result.state;
        if (
          (result.state === "succeeded" ||
            result.state === "outcome_unknown") &&
          result.reference
        )
          e.reference = voucherReference.parse(result.reference);
        if (result.state === "failed")
          e.code = /^[A-Z0-9_]{1,64}$/.test(result.code)
            ? result.code
            : "PROVIDER_REJECTED";
        // Erase encrypted voucher content on a definite outcome; unknown retains only until proposal expiry.
        if (e.state !== "outcome_unknown" && current.bookkeeping)
          current.bookkeeping.proposals = current.bookkeeping.proposals.filter(
            (v) => v.id !== p.id,
          );
      });
    } catch {
      return { state: "outcome_unknown" as const };
    }
    return result;
  }
  async reconcile(actor: AccountingActor, input: ProposalReference) {
    const ref = proposalReference.parse(input);
    const c = await this.authorize(actor, ref.company_id);
    const e = c.bookkeeping?.executions.find(
      (v) => v.id === ref.proposal_id && v.hash === ref.proposal_hash,
    );
    if (!e || e.generation !== c.generation || e.client !== actor.clientId)
      throw new DomainError("INTENT_CONFLICT");
    if (e.state === "failed")
      return { state: "failed" as const, reference: null };
    // No date/amount search, caller-supplied reference or inferred absence authorizes retry.
    if (!e.reference)
      return { state: "outcome_unknown" as const, reference: null };
    const actual = voucherInput.parse(
      await this.provider.read(actor, c.id, e.reference),
    );
    const matches = (await accountingHash(actual)) === e.hash;
    if (
      matches &&
      (e.state === "outcome_unknown" || e.state === "submitting")
    ) {
      await this.connections.mutate(actor.ownerId, c.id, (current) => {
        const saved = current.bookkeeping?.executions.find(
          (v) => v.id === e.id,
        );
        if (
          !saved ||
          current.generation !== e.generation ||
          saved.hash !== e.hash ||
          JSON.stringify(saved.reference) !== JSON.stringify(e.reference)
        )
          throw new DomainError("INTENT_CONFLICT");
        saved.state = "succeeded";
        if (current.bookkeeping)
          current.bookkeeping.proposals = current.bookkeeping.proposals.filter(
            (v) => v.id !== e.id,
          );
      });
    }
    return {
      state: matches ? ("succeeded" as const) : ("outcome_unknown" as const),
      reference: matches ? e.reference : null,
    };
  }
  // Installation-owner administration supplies the exact reference after inspecting
  // Fortnox. Model-callable tools cannot assert this independent evidence.
  async attestReference(
    owner: string,
    input: ProposalReference,
    reference: VoucherReference,
  ) {
    const ref = proposalReference.parse(input);
    const trusted = voucherReference.parse(reference);
    await this.connections.mutate(owner, ref.company_id, (c) => {
      const e = c.bookkeeping?.executions.find((v) => v.id === ref.proposal_id);
      if (
        !e ||
        e.hash !== ref.proposal_hash ||
        c.generation !== e.generation ||
        !e.dispatched ||
        !["outcome_unknown", "submitting"].includes(e.state)
      )
        throw new DomainError("INTENT_CONFLICT");
      e.reference = trusted;
      e.state = "outcome_unknown";
    });
  }
}
