import { ReceiptWorkflow } from "@fortnox-mcp/core";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { expect, it } from "vitest";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
import { registerReceipts } from "../../packages/mcp/src/receipts.js";
import { batchRef } from "./receipt-batches.js";
import type { ReceiptFixture } from "./receipt-files.js";
import { attachmentFixture } from "./receipt-provider.js";

export async function workflowFixture(input: ReceiptFixture) {
  const f = await attachmentFixture(input);
  const workflow = new ReceiptWorkflow(f.attachments, true);
  const commit = () =>
    workflow.commit(f.actor, {
      ...f.ref,
      capability: f.p.capabilities[f.first.item_id],
    });
  const resume = () =>
    workflow.resume(f.actor, { ...batchRef(f.p), item_ids: [f.first.item_id] });
  return { ...f, workflow, commit, resume };
}
export function receiptWorkflowContract(
  fixture: () => Promise<ReceiptFixture>,
) {
  it("rejects an old review rotated concurrently after validation but before its durable financial claim", async () => {
    const f = await workflowFixture(await fixture());
    const references = f.provider.references;
    let release: () => void = () => {},
      arrived: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    f.provider.references = async (...args) => {
      arrived();
      await blocked;
      return references(...args);
    };
    const old = f.commit();
    await ready;
    const renewed = await f.workflow.renewReview(f.actor, f.ref);
    release();
    await expect(old).rejects.toThrow("INTENT_CONFLICT");
    expect(f.bookings()).toBe(0);
    expect(
      (
        await f.workflow.commit(f.actor, {
          ...f.ref,
          capability: renewed.capabilities[f.first.item_id],
        })
      ).counts.completed,
    ).toBe(1);
    expect(f.counts().uploads).toBe(1);
    expect(f.bookings()).toBe(1);
  });
  it("can explicitly re-review a proven pre-dispatch upload failure without approving during resume", async () => {
    const f = await workflowFixture(await fixture());
    f.gates.formats = [];
    expect((await f.commit()).counts.failed).toBe(1);
    await f.resume();
    expect(f.bookings()).toBe(0);
    expect(f.counts().uploads).toBe(0);
    f.gates.formats = ["image/png"];
    const renewed = await f.workflow.renewReview(f.actor, f.ref);
    expect(
      (
        await f.workflow.commit(f.actor, {
          ...f.ref,
          capability: renewed.capabilities[f.first.item_id],
        })
      ).counts.completed,
    ).toBe(1);
    expect(f.counts().uploads).toBe(1);
    expect(f.bookings()).toBe(1);
  });
  it("retains successful voucher references beyond ordinary retention while their attachment repair is unresolved", async () => {
    const f = await workflowFixture(await fixture());
    f.mode({ linkStatus: 400 });
    await f.commit();
    await f.state.put(
      "installation",
      "owner",
      { ownerId: f.actor.ownerId },
      null,
    );
    f.advance(32 * 86400000);
    await cleanupProduct(f.state, f.now());
    await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: [f.items[1]],
    });
    const result = await f.receipts.view(f.actor, batchRef(f.p));
    expect(result.counts.partial).toBe(1);
    expect(result.items[0]?.steps.voucher.state).toBe("succeeded");
    expect(result.items[0]?.next_action).toBe("repair_link_only");
  });
  it("uses client-managed execution only after an explicit owner policy change and fresh preparation", async () => {
    const f = await workflowFixture(await fixture());
    const current = await f.connections.authorize(
      f.actor.ownerId,
      f.actor.clientId,
      f.a.id,
    );
    await f.connections.setAccountingPolicy(
      f.actor.ownerId,
      f.a.id,
      current.policyVersion,
      "client_managed",
      false,
    );
    await expect(f.workflow.commit(f.actor, f.ref, "client")).rejects.toThrow();
    const staged = await f.service.ingest(f.actor, f.a.id, f.files);
    const file = staged.files[0];
    if (!file) throw new Error("fixture");
    const p = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: [
        {
          file: {
            company_id: f.a.id,
            workflow_id: staged.workflow_id,
            file_id: file.file_id,
          },
          voucher: f.voucher,
          duplicate_resolution: "separate_transaction",
        },
      ],
    });
    const item = p.items[0];
    if (!item) throw new Error("fixture");
    const result = await f.workflow.commit(
      f.actor,
      { ...batchRef(p), item_id: item.item_id },
      "client",
    );
    expect(result.counts.completed).toBe(1);
    expect(f.bookings()).toBe(1);
  });
  it("preserves dispatched financial claims when result storage fails and never replays them on resume", async () => {
    const f = await workflowFixture(await fixture());
    const submit = f.provider.submit,
      mutate = f.connections.mutate.bind(f.connections);
    let failStorage = false;
    f.connections.mutate = async (...args) => {
      if (failStorage)
        throw new Error("synthetic storage outage after dispatch");
      return mutate(...args);
    };
    f.provider.submit = async (...args) => {
      const result = await submit(...args);
      failStorage = true;
      return result;
    };
    const result = await f.commit();
    expect(result.counts.unknown).toBe(1);
    failStorage = false;
    await f.resume();
    expect(f.bookings()).toBe(1);
    expect(f.counts()).toMatchObject({ uploads: 1, links: 0 });
    if (!f.first.proposal) throw new Error("fixture");
    expect(
      (await f.receipts.bookkeeping.status(f.actor, f.first.proposal)).state,
    ).toBe("outcome_unknown");
  });
  it("retains an uncertain financial item's batch after expiry instead of evicting its reconciliation context", async () => {
    const f = await workflowFixture(await fixture());
    const submit = f.provider.submit;
    f.provider.submit = async (...args) => {
      await submit(...args);
      throw new Error("synthetic lost answer");
    };
    await f.commit();
    f.advance(2 * 86400000);
    await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: [f.items[1]],
    });
    const saved = await f.receipts.view(f.actor, batchRef(f.p));
    expect(saved.counts.unknown).toBe(1);
    expect(f.bookings()).toBe(1);
  });
  it("does not infer safe link retry from a missing relationship after an unclassified rejection", async () => {
    const f = await workflowFixture(await fixture());
    f.mode({ linkStatus: 500 });
    expect((await f.commit()).counts.unknown).toBe(1);
    f.mode({});
    expect((await f.resume()).counts.unknown).toBe(1);
    expect(f.counts()).toMatchObject({ uploads: 1, links: 1 });
    expect(f.bookings()).toBe(1);
  });
  it("executes only one reviewed item, returns per-step results and removes only its completed temporary file", async () => {
    const f = await workflowFixture(await fixture());
    const result = await f.commit();
    expect(result.counts).toMatchObject({
      completed: 1,
      prepared: 1,
      requested: 2,
    });
    expect(f.counts()).toMatchObject({ uploads: 1, links: 1 });
    expect(f.bookings()).toBe(1);
    expect(
      await f.service.store.get(f.first.file.file_id, f.actor.ownerId, f.a.id),
    ).toBeNull();
    const untouched = f.p.items[1];
    if (!untouched) throw new Error("fixture");
    expect(
      (await f.service.read(f.actor, untouched.file)).bytes.length,
    ).toBeGreaterThan(0);
    await f.resume();
    expect(f.bookings()).toBe(1);
    expect(f.counts()).toMatchObject({ uploads: 1, links: 1 });
  });
  it("returns eight completed and two failed-link partial items, then repairs only those two links", async () => {
    const f = await workflowFixture(await fixture());
    const items = [];
    for (let n = 0; n < 5; n++) {
      const staged = await f.service.ingest(f.actor, f.a.id, f.files);
      for (const file of staged.files)
        items.push({
          file: {
            company_id: f.a.id,
            workflow_id: staged.workflow_id,
            file_id: file.file_id,
          },
          voucher: {
            ...f.voucher,
            description: `Synthetic receipt recovery ${items.length + 1}`,
          },
          duplicate_resolution: "separate_transaction",
        });
    }
    const p = await f.receipts.prepare(f.actor, { company_id: f.a.id, items });
    for (const [index, item] of p.items.entries()) {
      f.mode({ linkStatus: index < 8 ? 201 : 400 });
      await f.workflow.commit(f.actor, {
        ...batchRef(p),
        item_id: item.item_id,
        capability: p.capabilities[item.item_id],
      });
    }
    const before = await f.receipts.view(f.actor, batchRef(p));
    expect(before.counts).toMatchObject({
      requested: 10,
      completed: 8,
      partial: 2,
      failed: 0,
      unknown: 0,
    });
    expect(
      before.items.slice(8).every((i) => i.next_action === "repair_link_only"),
    ).toBe(true);
    f.mode({});
    const after = await f.workflow.resume(f.actor, {
      ...batchRef(p),
      item_ids: p.items.map((i) => i.item_id),
    });
    expect(after.counts.completed).toBe(10);
    expect(f.bookings()).toBe(10);
    expect(f.counts()).toMatchObject({ uploads: 10, links: 12 });
  }, 20000);
  it("checks capabilities, immutable identity and company policy before uploading; client mode cannot downgrade review", async () => {
    const f = await workflowFixture(await fixture());
    await expect(
      f.workflow.commit(f.actor, { ...f.ref, capability: "A".repeat(43) }),
    ).rejects.toThrow("INTENT_CONFLICT");
    await expect(f.workflow.commit(f.actor, f.ref, "client")).rejects.toThrow(
      "CLIENT_UNSUPPORTED",
    );
    await expect(
      f.workflow.commit(f.actor, {
        ...f.ref,
        company_id: f.b.id,
        capability: f.p.capabilities[f.first.item_id],
      }),
    ).rejects.toThrow();
    expect(f.counts().uploads).toBe(0);
    expect(f.bookings()).toBe(0);
    f.receipts.bookkeeping.gates.reviewHost = false;
    await expect(f.commit()).rejects.toThrow("CLIENT_UNSUPPORTED");
    expect(f.counts().uploads).toBe(0);
  });
  it("does not turn resume into approval after an upload-only interruption; a fresh per-item review rotates the old capability", async () => {
    const f = await workflowFixture(await fixture());
    await f.attachments.upload(f.actor, f.ref);
    await f.resume();
    expect(f.bookings()).toBe(0);
    f.advance(16 * 60000);
    const expired = await f.receipts.view(f.actor, batchRef(f.p));
    expect(expired.items[0]?.reason).toBe("REVIEW_EXPIRED");
    const review = await f.workflow.renewReview(f.actor, f.ref);
    const capability = review.capabilities[f.first.item_id];
    expect(capability).not.toBe(f.p.capabilities[f.first.item_id]);
    await expect(f.commit()).rejects.toThrow("INTENT_CONFLICT");
    const result = await f.workflow.commit(f.actor, { ...f.ref, capability });
    expect(result.counts.completed).toBe(1);
    expect(f.counts().uploads).toBe(1);
    expect(f.bookings()).toBe(1);
    await expect(f.workflow.renewReview(f.actor, f.ref)).rejects.toThrow();
  });
  it("keeps lost financial answers unknown with no resubmission until an owner-attested exact reference is reconciled", async () => {
    const f = await workflowFixture(await fixture());
    const submit = f.provider.submit;
    f.provider.submit = async (...args) => {
      await submit(...args);
      throw new Error("synthetic lost financial answer");
    };
    const result = await f.commit();
    expect(result.counts.unknown).toBe(1);
    expect(f.bookings()).toBe(1);
    await f.resume();
    expect(f.bookings()).toBe(1);
    expect(f.counts().links).toBe(0);
    if (!f.first.proposal) throw new Error("fixture");
    await f.receipts.bookkeeping.attestReference(
      f.actor.ownerId,
      f.first.proposal,
      { financial_year: 7, series: "A", number: 1 },
    );
    const recovered = await f.resume();
    expect(recovered.counts.completed).toBe(1);
    expect(f.bookings()).toBe(1);
    expect(f.counts()).toMatchObject({ uploads: 1, links: 1 });
  });
  it("keeps concurrent or lost upload/link calls single and never infers safe retry from a missing relationship", async () => {
    const f = await workflowFixture(await fixture());
    f.mode({ loseLink: true });
    await Promise.allSettled([f.commit(), f.commit()]);
    expect(f.bookings()).toBe(1);
    expect(f.counts()).toMatchObject({ uploads: 1, links: 1 });
    // Positive relationship resolution needs no second POST.
    const result = await f.resume();
    expect(result.counts.completed).toBe(1);
    expect(f.counts().links).toBe(1);
    const other = await workflowFixture(await fixture());
    other.mode({ loseUpload: true });
    await other.commit();
    await other.resume();
    expect(other.counts().uploads).toBe(1);
    expect(other.bookings()).toBe(0);
  });
  it("keeps completed, invalid, expired and unknown outcomes separate without batch-wide approval", async () => {
    const f = await workflowFixture(await fixture());
    const items = [];
    for (let n = 0; n < 2; n++) {
      const staged = await f.service.ingest(f.actor, f.a.id, f.files);
      for (const file of staged.files)
        items.push({
          file: {
            company_id: f.a.id,
            workflow_id: staged.workflow_id,
            file_id: file.file_id,
          },
          voucher: f.voucher,
          duplicate_resolution: "separate_transaction",
        });
    }
    const p = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: items.map((item, index) =>
        index === 1
          ? {
              ...item,
              voucher: {
                ...f.voucher,
                rows: [{ account: 1930, debit: "0.01", credit: "0" }],
              },
            }
          : item,
      ),
    });
    const completed = p.items[0],
      unknown = p.items[3];
    if (!completed || !unknown) throw new Error("fixture");
    await f.workflow.commit(f.actor, {
      ...batchRef(p),
      item_id: completed.item_id,
      capability: p.capabilities[completed.item_id],
    });
    f.mode({ loseUpload: true });
    await f.workflow.commit(f.actor, {
      ...batchRef(p),
      item_id: unknown.item_id,
      capability: p.capabilities[unknown.item_id],
    });
    f.advance(60 * 60000);
    const result = await f.workflow.resume(f.actor, {
      ...batchRef(p),
      item_ids: p.items.map((i) => i.item_id),
    });
    expect(result.counts).toMatchObject({
      requested: 4,
      completed: 1,
      unknown: 1,
      needs_input: 2,
    });
    expect(result.items[1]?.reason).toBe("invalid_or_unverified_voucher");
    expect(result.items[2]?.reason).toBe("FILE_EXPIRED");
    expect(result.items[3]?.next_action).toBe("reconcile_before_resending");
    expect(f.bookings()).toBe(1);
  });
  it("returns UI-only re-review capabilities and app-only commit metadata with strict public resume input", async () => {
    const f = await workflowFixture(await fixture());
    const server = new McpServer(
      { name: "synthetic-workflow", version: "0" },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    registerReceipts(server, f.receipts, f.actor, f.workflow);
    const client = new Client({
      name: "synthetic-workflow-client",
      version: "0",
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const tools = (await client.listTools()).tools;
      expect(
        tools.find((t) => t.name === "commit_reviewed_receipt_item")?._meta?.ui,
      ).toEqual({ visibility: ["app"] });
      const renewed = await client.callTool({
        name: "review_receipt_item_again",
        arguments: f.ref,
      });
      expect(renewed.isError).not.toBe(true);
      const metadata = renewed._meta?.receiptReview as {
        capabilities: Record<string, string>;
      };
      const secret = metadata.capabilities[f.first.item_id];
      expect(secret).toHaveLength(43);
      expect(JSON.stringify(renewed.structuredContent)).not.toContain(secret);
      expect(JSON.stringify(renewed.content)).not.toContain(secret);
      const resumed = await client.callTool({
        name: "resume_receipt_batch",
        arguments: { ...batchRef(f.p), item_ids: [f.first.item_id] },
      });
      expect(resumed.isError).not.toBe(true);
      expect(f.bookings()).toBe(0);
      await expect(
        f.workflow.resume(f.actor, {
          ...batchRef(f.p),
          item_ids: [f.first.item_id],
          confirmed: true,
        }),
      ).rejects.toThrow();
      await expect(
        new ReceiptWorkflow(f.attachments).resume(f.actor, {
          ...batchRef(f.p),
          item_ids: [f.first.item_id],
        }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    } finally {
      await client.close();
      await server.close();
    }
  });
}
