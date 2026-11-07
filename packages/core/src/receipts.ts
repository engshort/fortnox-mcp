import { z } from "zod";
import {
  AccountingValidationError,
  accountingHash,
  type VoucherInput,
  voucherInput,
} from "./accounting.js";
import type {
  AccountingActor,
  Bookkeeping,
  ProposalReference,
  ReceiptProposalBinding,
} from "./bookkeeping.js";
import { DomainError } from "./errors.js";
import { sumAmounts } from "./money.js";
import {
  ReceiptFileError,
  type ReceiptFileReference,
  type ReceiptFiles,
  receiptFileReference,
} from "./receipt-files.js";

export type ReceiptStep =
  | { state: "pending" }
  | { state: "submitting"; attempt: string; created: number }
  | { state: "succeeded"; reference: string }
  | { state: "failed"; code: string }
  | { state: "outcome_unknown"; reference?: string };
export interface ReceiptItem {
  id: string;
  file: ReceiptFileReference;
  fileHash: string | null;
  fileExpires: number;
  state: "prepared" | "needs_input";
  reason: string | null;
  duplicateCandidates: string[];
  proposal: ProposalReference | null;
  steps: { upload: ReceiptStep; voucher: ReceiptStep; link: ReceiptStep };
}
export interface ReceiptBatch {
  id: string;
  client: string;
  generation: number;
  policy: number;
  created: number;
  expires: number;
  hash: string;
  items: ReceiptItem[];
}
export const receiptBatchInput = z
  .object({
    company_id: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            file: receiptFileReference,
            voucher: z.unknown().optional(),
            missing_facts: z
              .array(
                z.enum([
                  "company",
                  "date",
                  "amount",
                  "account",
                  "tax_treatment",
                  "currency",
                  "year",
                  "series",
                ]),
              )
              .max(8)
              .optional(),
            duplicate_resolution: z
              .enum(["review_candidate", "separate_transaction"])
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
export const receiptBatchReference = z
  .object({
    company_id: z.string().uuid(),
    batch_id: z.string().uuid(),
    batch_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ReceiptBatchReference = z.infer<typeof receiptBatchReference>;
export const receiptItemReference = receiptBatchReference
  .extend({ item_id: z.string().uuid() })
  .strict();
export type ReceiptItemReference = z.infer<typeof receiptItemReference>;
export const receiptReviewInput = receiptItemReference
  .extend({ capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
const manifestHash = (items: ReceiptItem[]) =>
  accountingHash(
    items.map((i) => ({
      id: i.id,
      file: i.file,
      fileHash: i.fileHash,
      proposal: i.proposal,
    })),
  );

export class Receipts {
  constructor(
    readonly bookkeeping: Bookkeeping,
    readonly files: ReceiptFiles,
    readonly enabled = false,
    readonly now = Date.now,
  ) {}
  get connections() {
    return this.bookkeeping.connections;
  }
  private async authorize(
    actor: AccountingActor,
    company: string,
    write = false,
  ) {
    if (
      !actor.scopes.includes("mcp:read") ||
      !actor.scopes.includes("mcp:files") ||
      (write && !actor.scopes.includes("mcp:write"))
    )
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    if (!this.enabled || !this.files.enabled || (write && c.readOnly))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  async prepare(actor: AccountingActor, input: unknown) {
    const value = receiptBatchInput.parse(input);
    const c = await this.authorize(actor, value.company_id, true);
    if (
      new Set(value.items.map((i) => i.file.file_id)).size !==
        value.items.length ||
      value.items.some((i) => i.file.company_id !== c.id)
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    const batch: ReceiptBatch = {
      id: crypto.randomUUID(),
      client: actor.clientId,
      generation: c.generation,
      policy: c.policyVersion,
      created: this.now(),
      expires: this.now() + 86400000,
      hash: "",
      items: [],
    };
    const capabilities: Record<string, string> = {};
    const createdProposals: string[] = [];
    try {
      for (const input of value.items) {
        const item: ReceiptItem = {
          id: crypto.randomUUID(),
          file: input.file,
          fileHash: null,
          fileExpires: 0,
          state: "needs_input",
          reason: null,
          duplicateCandidates: [],
          proposal: null,
          steps: {
            upload: { state: "pending" },
            voucher: { state: "pending" },
            link: { state: "pending" },
          },
        };
        batch.items.push(item);
        try {
          const read = await this.files.read(actor, input.file);
          item.fileHash = read.record.hash;
          item.fileExpires = read.record.expires;
          read.bytes.fill(0);
          item.duplicateCandidates = [
            ...(c.receiptBatches ?? []).flatMap((b) => b.items),
            ...batch.items.filter((i) => i.id !== item.id),
          ]
            .filter((i) => i.fileHash === item.fileHash)
            .map((i) => i.id)
            .slice(0, 10);
          if (
            item.duplicateCandidates.length &&
            input.duplicate_resolution !== "separate_transaction"
          ) {
            item.reason = "duplicate_candidate_requires_resolution";
            continue;
          }
          if (input.missing_facts?.length || !input.voucher) {
            item.reason = "missing_facts";
            continue;
          }
          const voucher = voucherInput.parse(input.voucher);
          if (voucher.company_id !== c.id)
            throw new DomainError("COMPANY_FORBIDDEN");
          const context: ReceiptProposalBinding = {
            batch_id: batch.id,
            item_id: item.id,
            workflow_id: item.file.workflow_id,
            file_id: item.file.file_id,
            sha256: read.record.hash,
            file_expires_at: read.record.expires,
          };
          const prepared = await this.bookkeeping.prepare(
            actor,
            voucher,
            context,
          );
          createdProposals.push(prepared.proposal_id);
          if (prepared.company_id !== c.id)
            throw new DomainError("COMPANY_FORBIDDEN");
          item.proposal = {
            company_id: c.id,
            proposal_id: prepared.proposal_id,
            proposal_hash: prepared.proposal_hash,
          };
          item.state = "prepared";
          capabilities[item.id] = prepared.capability;
        } catch (cause) {
          if (cause instanceof ReceiptFileError) item.reason = cause.code;
          else if (
            cause instanceof AccountingValidationError ||
            cause instanceof z.ZodError
          )
            item.reason = "invalid_or_unverified_voucher";
          else throw cause;
        }
      }
      batch.hash = await manifestHash(batch.items);
      await this.connections.mutate(actor.ownerId, c.id, (current) => {
        if (
          current.generation !== batch.generation ||
          current.policyVersion !== batch.policy ||
          current.state !== "active" ||
          current.readOnly
        )
          throw new DomainError("INTENT_CONFLICT");
        current.receiptBatches ??= [];
        // Preserve unresolved outcomes; no capacity eviction can authorize a resend.
        current.receiptBatches = current.receiptBatches.filter(
          (b) =>
            b.expires > this.now() ||
            b.items.some((i) =>
              Object.values(i.steps).some((s) =>
                ["submitting", "outcome_unknown"].includes(s.state),
              ),
            ),
        );
        if (current.receiptBatches.length >= 4)
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        // A concurrent preparation must not omit a newly durable duplicate warning.
        for (const [index, item] of batch.items.entries()) {
          if (
            item.state === "prepared" &&
            value.items[index]?.duplicate_resolution !==
              "separate_transaction" &&
            current.receiptBatches.some((b) =>
              b.items.some(
                (i) =>
                  i.fileHash === item.fileHash &&
                  !item.duplicateCandidates.includes(i.id),
              ),
            )
          )
            throw new DomainError("INTENT_CONFLICT");
        }
        current.receiptBatches.push(batch);
      });
      return {
        ...(await this.view(actor, {
          company_id: c.id,
          batch_id: batch.id,
          batch_hash: batch.hash,
        })),
        capabilities,
      };
    } catch (cause) {
      await this.connections.mutate(actor.ownerId, c.id, (current) => {
        if (current.bookkeeping)
          current.bookkeeping.proposals = current.bookkeeping.proposals.filter(
            (p) => !createdProposals.includes(p.id),
          );
      });
      throw cause;
    }
  }
  async batch(actor: AccountingActor, input: ReceiptBatchReference) {
    const ref = receiptBatchReference.parse(input);
    const c = await this.authorize(actor, ref.company_id);
    const batch = c.receiptBatches?.find((b) => b.id === ref.batch_id);
    if (
      !batch ||
      batch.hash !== ref.batch_hash ||
      batch.client !== actor.clientId ||
      batch.generation !== c.generation ||
      batch.policy !== c.policyVersion ||
      (await manifestHash(batch.items)) !== batch.hash
    )
      throw new DomainError("INTENT_CONFLICT");
    return { c, batch };
  }
  async item(actor: AccountingActor, input: ReceiptItemReference) {
    const ref = receiptItemReference.parse(input);
    const { c, batch } = await this.batch(actor, {
      company_id: ref.company_id,
      batch_id: ref.batch_id,
      batch_hash: ref.batch_hash,
    });
    const item = batch.items.find((i) => i.id === ref.item_id);
    if (!item) throw new DomainError("INTENT_CONFLICT");
    return { c, batch, item };
  }
  async view(actor: AccountingActor, input: ReceiptBatchReference) {
    const { c, batch } = await this.batch(actor, input);
    const items = [];
    for (const item of batch.items) {
      let voucher: VoucherInput | null = null,
        totals: { debit: string; credit: string; difference: string } | null =
          null;
      let state: string = item.state,
        reason = item.reason;
      let nextAction = "review_or_supply_input";
      const steps = { ...item.steps };
      const execution = item.proposal
        ? c.bookkeeping?.executions.find(
            (e) =>
              e.id === item.proposal?.proposal_id &&
              e.hash === item.proposal.proposal_hash &&
              e.generation === c.generation &&
              e.client === actor.clientId,
          )
        : undefined;
      if (execution) {
        if (execution.state === "succeeded" && execution.reference)
          steps.voucher = {
            state: "succeeded",
            reference: JSON.stringify(execution.reference),
          };
        else if (execution.state === "failed")
          steps.voucher = {
            state: "failed",
            code: execution.code ?? "PROVIDER_REJECTED",
          };
        else
          steps.voucher = {
            state: "outcome_unknown",
            ...(execution.reference
              ? { reference: JSON.stringify(execution.reference) }
              : {}),
          };
      }
      const uncertain = Object.values(steps).some((s) =>
        ["submitting", "outcome_unknown"].includes(s.state),
      );
      const expired =
        (item.fileExpires > 0 && item.fileExpires <= this.now()) ||
        batch.expires <= this.now();
      if (uncertain) {
        state = "outcome_unknown";
        reason = "reconciliation_required";
        nextAction = "reconcile_before_resending";
      } else if (steps.voucher.state === "succeeded") {
        state = steps.link.state === "succeeded" ? "completed" : "partial";
        nextAction = state === "completed" ? "none" : "repair_link_only";
        reason = steps.link.state === "failed" ? steps.link.code : null;
      } else if (steps.voucher.state === "failed") {
        state = steps.upload.state === "succeeded" ? "partial" : "failed";
        reason = steps.voucher.code;
        nextAction = "inspect_rejection_and_prepare_new_review";
      } else if (expired) {
        state = "needs_input";
        reason = "FILE_EXPIRED";
        nextAction = "reattach_and_review";
      } else if (steps.upload.state === "failed") {
        state = "failed";
        reason = steps.upload.code;
        nextAction = "retry_proven_unapplied_step";
      }
      if (!execution && !expired && item.proposal) {
        const read = await this.bookkeeping.proposal(actor, item.proposal);
        voucher = read.voucher;
        const debit = sumAmounts(
          voucher.rows.map((r) => r.debit),
          2,
        );
        const credit = sumAmounts(
          voucher.rows.map((r) => r.credit),
          2,
        );
        totals = {
          debit,
          credit,
          difference: sumAmounts([debit, `-${credit}`], 2),
        };
      }
      items.push({
        item_id: item.id,
        file: item.file,
        sha256: item.fileHash,
        state,
        reason,
        duplicate_candidates: item.duplicateCandidates,
        proposal: item.proposal,
        voucher,
        totals,
        review_expires_at: item.proposal
          ? (c.bookkeeping?.proposals.find(
              (p) => p.id === item.proposal?.proposal_id,
            )?.reviewExpires ?? null)
          : null,
        steps,
        next_action: nextAction,
      });
    }
    return {
      company_id: c.id,
      company_name: c.name,
      batch_id: batch.id,
      batch_hash: batch.hash,
      expires_at: batch.expires,
      execution_available:
        this.bookkeeping.gates.writes && this.bookkeeping.gates.reviewHost,
      items,
      counts: {
        requested: items.length,
        completed: items.filter((i) => i.state === "completed").length,
        partial: items.filter((i) => i.state === "partial").length,
        failed: items.filter((i) => i.state === "failed").length,
        unknown: items.filter((i) => i.state === "outcome_unknown").length,
        needs_input: items.filter((i) => i.state === "needs_input").length,
        prepared: items.filter((i) => i.state === "prepared").length,
      },
    };
  }
  // File checking is repeated at claim and immediately before voucher dispatch.
  async guard(actor: AccountingActor, input: ReceiptItemReference) {
    const { batch, item } = await this.item(actor, input);
    await this.authorize(actor, input.company_id, true);
    if (
      batch.expires <= this.now() ||
      item.state !== "prepared" ||
      !item.proposal
    )
      throw new DomainError("INTENT_CONFLICT");
    const read = await this.files.read(actor, item.file);
    read.bytes.fill(0);
    if (read.record.hash !== item.fileHash)
      throw new DomainError("INTENT_CONFLICT");
    const { p } = await this.bookkeeping.proposal(actor, item.proposal);
    const expected: ReceiptProposalBinding = {
      batch_id: batch.id,
      item_id: item.id,
      workflow_id: item.file.workflow_id,
      file_id: item.file.file_id,
      sha256: read.record.hash,
      file_expires_at: read.record.expires,
    };
    if (JSON.stringify(p.receipt) !== JSON.stringify(expected))
      throw new DomainError("INTENT_CONFLICT");
  }
}
