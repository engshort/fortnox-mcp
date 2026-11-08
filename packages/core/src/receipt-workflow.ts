import { z } from "zod";
import type { AccountingActor } from "./bookkeeping.js";
import { DomainError } from "./errors.js";
import type { ReceiptAttachments } from "./receipt-provider.js";
import {
  type ReceiptBatchReference,
  type ReceiptItemReference,
  receiptBatchReference,
  receiptItemReference,
  receiptReviewInput,
} from "./receipts.js";

export const receiptResumeInput = receiptBatchReference
  .extend({
    item_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

const batchReference = (ref: ReceiptBatchReference) => ({
  company_id: ref.company_id,
  batch_id: ref.batch_id,
  batch_hash: ref.batch_hash,
});

// Upload, voucher creation and linking are independent durable steps. In
// particular, resume never creates a voucher or manufactures a human approval.
export class ReceiptWorkflow {
  constructor(
    readonly attachments: ReceiptAttachments,
    readonly enabled = false,
  ) {}
  get receipts() {
    return this.attachments.receipts;
  }
  private async authorize(actor: AccountingActor, company: string) {
    if (!this.enabled || !this.receipts.bookkeeping.gates.writes)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (
      !actor.scopes.includes("mcp:write") ||
      !actor.scopes.includes("mcp:files") ||
      !actor.scopes.includes("mcp:read")
    )
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.receipts.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    if (c.readOnly) throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  async commit(
    actor: AccountingActor,
    input: unknown,
    mode: "review" | "client" = "review",
  ) {
    const parsed =
      mode === "review"
        ? receiptReviewInput.parse(input)
        : receiptItemReference.parse(input);
    const ref = receiptItemReference.parse({
      ...batchReference(parsed),
      item_id: parsed.item_id,
    });
    const c = await this.authorize(actor, ref.company_id);
    const { item } = await this.receipts.item(actor, ref);
    if (!item.proposal) throw new DomainError("INTENT_CONFLICT");
    if (mode === "review") {
      // Verify before a file mutation, and repeat inside the financial service.
      await this.receipts.bookkeeping.assertReview(actor, {
        ...item.proposal,
        capability: "capability" in parsed ? parsed.capability : "",
      });
    } else if (c.review !== "client_managed")
      throw new DomainError("CLIENT_UNSUPPORTED");
    await this.receipts.guard(actor, ref);
    const uploaded = await this.attachments.upload(actor, ref);
    if (uploaded.state === "succeeded") {
      await this.receipts.bookkeeping.commit(
        actor,
        mode === "review"
          ? {
              ...item.proposal,
              capability: "capability" in parsed ? parsed.capability : "",
            }
          : item.proposal,
        mode,
        () => this.receipts.guard(actor, ref),
      );
      await this.resumeOne(actor, ref);
    }
    return this.receipts.view(actor, batchReference(ref));
  }
  async renewReview(actor: AccountingActor, input: ReceiptItemReference) {
    const ref = receiptItemReference.parse(input);
    await this.authorize(actor, ref.company_id);
    const { item } = await this.receipts.item(actor, ref);
    if (!item.proposal) throw new DomainError("INTENT_CONFLICT");
    const capability = await this.receipts.bookkeeping.renewReceiptReview(
      actor,
      item.proposal,
      () => this.receipts.guard(actor, ref),
    );
    return {
      ...(await this.receipts.view(actor, batchReference(ref))),
      capabilities: { [item.id]: capability },
    };
  }
  private async resumeOne(actor: AccountingActor, ref: ReceiptItemReference) {
    const { item } = await this.receipts.item(actor, ref);
    if (!item.proposal || item.steps.upload.state !== "succeeded") return;
    let status = await this.receipts.bookkeeping.status(actor, item.proposal);
    if (status.state === "outcome_unknown") {
      await this.receipts.bookkeeping.reconcile(actor, item.proposal);
      status = await this.receipts.bookkeeping.status(actor, item.proposal);
    }
    if (status.state !== "succeeded") return;
    if (["submitting", "outcome_unknown"].includes(item.steps.link.state))
      await this.attachments.reconcileLink(actor, ref);
    else if (item.steps.link.state !== "succeeded")
      await this.attachments.link(actor, ref);
    const { c, batch, item: saved } = await this.receipts.item(actor, ref);
    if (saved.steps.link.state === "succeeded") {
      await this.receipts.connections.mutate(actor.ownerId, c.id, (current) => {
        if (
          current.generation !== batch.generation ||
          current.policyVersion !== batch.policy
        )
          throw new DomainError("INTENT_CONFLICT");
        const execution = current.bookkeeping?.executions.find(
          (e) =>
            e.id === saved.proposal?.proposal_id &&
            e.hash === saved.proposal.proposal_hash,
        );
        if (execution?.state !== "succeeded")
          throw new DomainError("INTENT_CONFLICT");
        execution.attachmentComplete = true;
      });
    }
    await this.cleanupItem(actor, ref);
  }
  private async cleanupItem(actor: AccountingActor, ref: ReceiptItemReference) {
    const { c, item } = await this.receipts.item(actor, ref);
    const references =
      c.receiptBatches
        ?.flatMap((b) => b.items)
        .filter((i) => i.file.file_id === item.file.file_id) ?? [];
    if (
      !references.length ||
      references.some(
        (i) =>
          i.steps.upload.state !== "succeeded" ||
          i.steps.link.state !== "succeeded" ||
          !c.bookkeeping?.executions.some(
            (e) =>
              e.id === i.proposal?.proposal_id &&
              e.hash === i.proposal.proposal_hash &&
              e.state === "succeeded",
          ),
      )
    )
      return;
    await this.receipts.files.store.remove(
      item.file.file_id,
      actor.ownerId,
      c.id,
    );
  }
  async resume(actor: AccountingActor, input: unknown) {
    const ref = receiptResumeInput.parse(input);
    await this.authorize(actor, ref.company_id);
    const { batch } = await this.receipts.batch(actor, batchReference(ref));
    if (ref.item_ids.some((id) => !batch.items.some((i) => i.id === id)))
      throw new DomainError("INTENT_CONFLICT");
    for (const id of ref.item_ids) {
      try {
        await this.resumeOne(actor, { ...batchReference(ref), item_id: id });
      } catch {
        // Failure of one repair cannot hide other durable results. Reauthorize
        // before continuing; disconnect/revocation still abort the whole request.
        await this.authorize(actor, ref.company_id);
      }
    }
    return this.receipts.view(actor, batchReference(ref));
  }
}
