import { z } from "zod";
import type { AccountingActor } from "./bookkeeping.js";
import { voucherReference } from "./bookkeeping.js";
import { DomainError } from "./errors.js";
import { fileDigest, type ReceiptFileRecord } from "./receipt-files.js";
import {
  type ReceiptItemReference,
  type ReceiptStep,
  type Receipts,
  receiptItemReference,
} from "./receipts.js";
export const providerFileId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const attachmentReference = z
  .object({
    company_id: z.string().uuid(),
    file_id: providerFileId,
    voucher: voucherReference,
  })
  .strict();
export type AttachmentReference = z.infer<typeof attachmentReference>;
export type ReceiptWriteResult =
  | { state: "succeeded"; reference: string }
  | { state: "failed"; code: string }
  | { state: "outcome_unknown"; reference?: string };
export interface ReceiptProvider {
  upload(
    actor: AccountingActor,
    company: string,
    file: { record: ReceiptFileRecord; bytes: Uint8Array },
    beforeDispatch: () => Promise<void>,
  ): Promise<ReceiptWriteResult>;
  link(
    actor: AccountingActor,
    reference: AttachmentReference,
    beforeDispatch: () => Promise<void>,
  ): Promise<ReceiptWriteResult>;
  connection(
    actor: AccountingActor,
    reference: AttachmentReference,
  ): Promise<boolean>;
  retrieve(
    actor: AccountingActor,
    reference: AttachmentReference,
  ): Promise<{ bytes: Uint8Array; mime: string }>;
}
export interface AttachmentGates {
  upload: boolean;
  link: boolean;
  retrieve: boolean;
}
// All remote upload/link entry points share these durable item claims. This class
// does not create vouchers; the accounting service remains the sole write policy.
export class ReceiptAttachments {
  constructor(
    readonly receipts: Receipts,
    readonly provider: ReceiptProvider,
    readonly gates: AttachmentGates,
    readonly now = Date.now,
  ) {}
  private async authorize(
    actor: AccountingActor,
    company: string,
    write: boolean,
  ) {
    if (
      !actor.scopes.includes("mcp:read") ||
      !actor.scopes.includes("mcp:files") ||
      (write && !actor.scopes.includes("mcp:write"))
    )
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.receipts.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    if (write && c.readOnly) throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (write) await this.receipts.connections.assertWritesAllowed();
    return c;
  }
  private async step(
    actor: AccountingActor,
    input: ReceiptItemReference,
    kind: "upload" | "link",
    work: (beforeDispatch: () => Promise<void>) => Promise<ReceiptWriteResult>,
  ) {
    const ref = receiptItemReference.parse(input);
    const { c, batch, item } = await this.receipts.item(actor, ref);
    await this.authorize(actor, c.id, true);
    if (!this.gates[kind]) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const old = item.steps[kind];
    if (old.state === "succeeded" || old.state === "outcome_unknown")
      return old;
    if (old.state === "submitting")
      return { state: "outcome_unknown" as const };
    const attempt = crypto.randomUUID();
    await this.receipts.connections.mutate(actor.ownerId, c.id, (current) => {
      if (
        current.generation !== batch.generation ||
        current.policyVersion !== batch.policy ||
        current.state !== "active" ||
        current.readOnly
      )
        throw new DomainError("INTENT_CONFLICT");
      const saved = current.receiptBatches
        ?.find((b) => b.id === batch.id && b.hash === batch.hash)
        ?.items.find((i) => i.id === item.id);
      if (!saved || !["pending", "failed"].includes(saved.steps[kind].state))
        throw new DomainError("INTENT_CONFLICT");
      saved.steps[kind] = { state: "submitting", attempt, created: this.now() };
    });
    let dispatched = false;
    let result: ReceiptWriteResult;
    try {
      result = await work(async () => {
        await this.authorize(actor, c.id, true);
        const current = await this.receipts.item(actor, ref);
        const step = current.item.steps[kind];
        if (
          current.c.generation !== batch.generation ||
          current.c.policyVersion !== batch.policy ||
          step.state !== "submitting" ||
          step.attempt !== attempt
        )
          throw new DomainError("INTENT_CONFLICT");
        if (kind === "upload") await this.receipts.guard(actor, ref);
        // The claim cannot be reclaimed after a crash, even before dispatch.
        dispatched = true;
      });
      if (!dispatched && result.state !== "failed")
        result = { state: "failed", code: "NOT_DISPATCHED" };
      if (
        result.state === "succeeded" ||
        (result.state === "outcome_unknown" && result.reference)
      )
        providerFileId.parse(result.reference);
      if (result.state === "failed" && !/^[A-Z0-9_]{1,64}$/.test(result.code))
        result = { state: "failed", code: "PROVIDER_REJECTED" };
    } catch (cause) {
      result = dispatched
        ? { state: "outcome_unknown" }
        : {
            state: "failed",
            code: cause instanceof DomainError ? cause.code : "NOT_DISPATCHED",
          };
    }
    try {
      await this.receipts.connections.mutate(actor.ownerId, c.id, (current) => {
        const saved = current.receiptBatches
          ?.find((b) => b.id === batch.id && b.hash === batch.hash)
          ?.items.find((i) => i.id === item.id);
        const prior = saved?.steps[kind];
        if (
          !saved ||
          prior?.state !== "submitting" ||
          prior.attempt !== attempt
        )
          throw new DomainError("INTENT_CONFLICT");
        // A late response records only minimal evidence; no generation/policy/secret is restored.
        saved.steps[kind] = result;
      });
    } catch {
      return { state: "outcome_unknown" as const };
    }
    await this.authorize(actor, c.id, false);
    return result;
  }
  async upload(actor: AccountingActor, input: ReceiptItemReference) {
    const ref = receiptItemReference.parse(input);
    const { item } = await this.receipts.item(actor, ref);
    await this.authorize(actor, ref.company_id, true);
    if (!this.gates.upload) throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (
      ["succeeded", "submitting", "outcome_unknown"].includes(
        item.steps.upload.state,
      )
    )
      return item.steps.upload.state === "submitting"
        ? { state: "outcome_unknown" as const }
        : item.steps.upload;
    await this.receipts.guard(actor, ref);
    const file = await this.receipts.files.read(actor, item.file);
    try {
      return await this.step(actor, ref, "upload", (before) =>
        this.provider.upload(actor, ref.company_id, file, before),
      );
    } finally {
      file.bytes.fill(0);
    }
  }
  async link(actor: AccountingActor, input: ReceiptItemReference) {
    const ref = receiptItemReference.parse(input);
    const { item } = await this.receipts.item(actor, ref);
    if (!item.proposal || item.steps.upload.state !== "succeeded")
      throw new DomainError("INTENT_CONFLICT");
    const status = await this.receipts.bookkeeping.status(actor, item.proposal);
    if (status.state !== "succeeded" || !status.reference)
      throw new DomainError("OUTCOME_UNKNOWN");
    const reference = attachmentReference.parse({
      company_id: ref.company_id,
      file_id: item.steps.upload.reference,
      voucher: status.reference,
    });
    return this.step(actor, ref, "link", (before) =>
      this.provider.link(actor, reference, before),
    );
  }
  async retrieve(actor: AccountingActor, input: AttachmentReference) {
    const ref = attachmentReference.parse(input);
    const before = await this.authorize(actor, ref.company_id, false);
    if (!this.gates.retrieve) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const result = await this.provider.retrieve(actor, ref);
    try {
      const after = await this.authorize(actor, ref.company_id, false);
      if (after.generation !== before.generation)
        throw new DomainError("COMPANY_FORBIDDEN");
      return { ...result, sha256: await fileDigest(result.bytes) };
    } catch (cause) {
      result.bytes.fill(0);
      throw cause;
    }
  }
  // Positive exact provider evidence can resolve a lost link response. A 404 or
  // missing record never proves that an earlier upload or financial write was absent.
  async reconcileLink(
    actor: AccountingActor,
    input: ReceiptItemReference,
  ): Promise<ReceiptStep> {
    const ref = receiptItemReference.parse(input);
    const { c, batch, item } = await this.receipts.item(actor, ref);
    await this.authorize(actor, c.id, false);
    if (
      !this.gates.link ||
      item.steps.upload.state !== "succeeded" ||
      !item.proposal
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const status = await this.receipts.bookkeeping.status(actor, item.proposal);
    if (status.state !== "succeeded" || !status.reference)
      return { state: "outcome_unknown" };
    const fileId = item.steps.upload.reference;
    if (
      !(await this.provider.connection(actor, {
        company_id: c.id,
        file_id: fileId,
        voucher: status.reference,
      }))
    )
      return { state: "outcome_unknown" };
    await this.authorize(actor, c.id, false);
    await this.receipts.connections.mutate(actor.ownerId, c.id, (current) => {
      if (
        current.generation !== batch.generation ||
        current.policyVersion !== batch.policy
      )
        throw new DomainError("INTENT_CONFLICT");
      const saved = current.receiptBatches
        ?.find((b) => b.id === batch.id && b.hash === batch.hash)
        ?.items.find((i) => i.id === item.id);
      if (
        !saved ||
        !["submitting", "outcome_unknown", "succeeded"].includes(
          saved.steps.link.state,
        )
      )
        throw new DomainError("INTENT_CONFLICT");
      saved.steps.link = { state: "succeeded", reference: fileId };
    });
    return { state: "succeeded", reference: fileId };
  }
}
