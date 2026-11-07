import {
  Bookkeeping,
  type ReceiptBatchReference,
  Receipts,
} from "@fortnox-mcp/core";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { expect, it } from "vitest";
import { registerReceipts } from "../../packages/mcp/src/receipts.js";
import { syntheticReferences } from "./accounting.js";
import { fileFixture, type ReceiptFixture } from "./receipt-files.js";

export async function batchFixture(fixture: ReceiptFixture) {
  const f = await fileFixture(fixture);
  const staged = await f.service.ingest(f.actor, f.a.id, f.files);
  f.provider.references = async (_actor, company) =>
    syntheticReferences(company, f.now());
  const service = new Receipts(
    new Bookkeeping(f.connections, f.provider, f.gates, f.now),
    f.service,
    true,
    f.now,
  );
  const items = staged.files.map((file, index) => ({
    file: {
      company_id: f.a.id,
      workflow_id: staged.workflow_id,
      file_id: file.file_id,
    },
    voucher: { ...f.voucher, description: `Synthetic receipt ${index + 1}` },
    duplicate_resolution: "separate_transaction" as const,
  }));
  return { ...f, receipts: service, staged, items };
}
export const batchRef = (p: {
  company_id: string;
  batch_id: string;
  batch_hash: string;
}): ReceiptBatchReference => ({
  company_id: p.company_id,
  batch_id: p.batch_id,
  batch_hash: p.batch_hash,
});
export function receiptBatchesContract(fixture: () => Promise<ReceiptFixture>) {
  it("does not lose duplicate warnings when two preparations race for the same file", async () => {
    const f = await batchFixture(await fixture());
    let arrived = 0;
    let release: () => void = () => {};
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.provider.references = async (_actor, company) => {
      arrived++;
      if (arrived === 2) release();
      await both;
      return syntheticReferences(company, f.now());
    };
    const original = f.items[0];
    if (!original) throw new Error("fixture");
    const { duplicate_resolution: _resolution, ...item } = original;
    const result = await Promise.allSettled([
      f.receipts.prepare(f.actor, { company_id: f.a.id, items: [item] }),
      f.receipts.prepare(f.actor, { company_id: f.a.id, items: [item] }),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const retry = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: [item],
    });
    expect(retry.items[0]?.reason).toBe(
      "duplicate_candidate_requires_resolution",
    );
    expect(f.bookings()).toBe(0);
  });

  it("caps both proposal and review expiry to the actual staged file lifetime", async () => {
    const f = await batchFixture(await fixture());
    f.advance(50 * 60000);
    const p = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: [f.items[0]],
    });
    const item = p.items[0];
    if (!item?.proposal) throw new Error("fixture");
    const proposal = await f.receipts.bookkeeping.proposal(
      f.actor,
      item.proposal,
    );
    expect(proposal.p.expires).toBe(f.staged.files[0]?.expires_at);
    expect(proposal.p.reviewExpires).toBe(proposal.p.expires);
    f.advance(5 * 60000);
    await expect(
      f.receipts.guard(f.actor, { ...batchRef(p), item_id: item.item_id }),
    ).rejects.toThrow("FILE_EXPIRED");
  });

  it("prepares ten individually balanced items within a bounded file and proposal budget", async () => {
    const f = await batchFixture(await fixture());
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
            description: `Synthetic receipt ${items.length + 1}`,
          },
          duplicate_resolution: "separate_transaction",
        });
    }
    const p = await f.receipts.prepare(f.actor, { company_id: f.a.id, items });
    expect(p.items).toHaveLength(10);
    expect(p.items.every((i) => i.state === "prepared")).toBe(true);
    expect(Object.values(p.capabilities)).toHaveLength(10);
    expect(f.bookings()).toBe(0);
  });

  it("keeps per-item capabilities outside model content and serves a strict, network-free review resource", async () => {
    const f = await batchFixture(await fixture());
    const server = new McpServer(
      { name: "synthetic-receipts", version: "0" },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    registerReceipts(server, f.receipts, f.actor);
    const client = new Client({
      name: "synthetic-receipt-client",
      version: "0",
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(["prepare_receipt_batch", "get_receipt_batch"]);
      const result = await client.callTool({
        name: "prepare_receipt_batch",
        arguments: { company_id: f.a.id, items: f.items },
      });
      expect(result.isError).not.toBe(true);
      const metadata = result._meta?.receiptReview as {
        capabilities: Record<string, string>;
      };
      expect(Object.keys(metadata.capabilities)).toHaveLength(2);
      for (const secret of Object.values(metadata.capabilities)) {
        expect(JSON.stringify(result.structuredContent)).not.toContain(secret);
        expect(JSON.stringify(result.content)).not.toContain(secret);
      }
      const body = result.structuredContent as {
        status: string;
        data: { company_id: string; batch_id: string; batch_hash: string };
      };
      const saved = await client.callTool({
        name: "get_receipt_batch",
        arguments: batchRef(body.data),
      });
      expect(saved._meta).toBeUndefined();
      expect(saved.isError).not.toBe(true);
      const resource = await client.readResource({
        uri: "ui://fortnox/receipt-review-v1.html",
      });
      const html = resource.contents[0];
      expect(html).toHaveProperty("text");
      expect(JSON.stringify(resource)).toContain("default-src 'none'");
      expect(JSON.stringify(resource)).not.toContain("synthetic-secret");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("prepares separate immutable per-receipt totals and capabilities without any financial write or cleartext voucher storage", async () => {
    const f = await batchFixture(await fixture());
    const p = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: f.items,
    });
    expect(p.items).toHaveLength(2);
    expect(p.items.map((i) => i.state)).toEqual(["prepared", "prepared"]);
    expect(p.items.map((i) => i.totals)).toEqual(
      Array(2).fill({ debit: "0.30", credit: "0.30", difference: "0.00" }),
    );
    expect(new Set(Object.values(p.capabilities)).size).toBe(2);
    expect(f.calls()).toBe(2);
    expect(f.bookings()).toBe(0);
    expect(
      JSON.stringify(await f.state.get("connections", f.actor.ownerId)),
    ).not.toContain("Synthetic receipt");
    const saved = await f.receipts.view(f.actor, batchRef(p));
    expect(saved).not.toHaveProperty("capabilities");
    await expect(
      f.receipts.batch(f.actor, { ...batchRef(p), batch_hash: "a".repeat(64) }),
    ).rejects.toThrow("INTENT_CONFLICT");
  });
  it("returns needs_input for independently unbalanced vouchers instead of pooling their balances", async () => {
    const f = await batchFixture(await fixture());
    const items = f.items.map((i, index) => ({
      ...i,
      voucher: {
        ...i.voucher,
        rows: [
          { account: 1930, debit: index ? "0.20" : "0.30", credit: "0" },
          { account: 4000, debit: "0", credit: index ? "0.30" : "0.20" },
        ],
      },
    }));
    const p = await f.receipts.prepare(f.actor, { company_id: f.a.id, items });
    expect(p.items.map((i) => i.state)).toEqual(["needs_input", "needs_input"]);
    expect(Object.keys(p.capabilities)).toHaveLength(0);
    expect(p.items.every((i) => i.proposal === null)).toBe(true);
  });
  it("missing facts and company-scoped duplicate candidates require explicit input without a blanket duplicate ban", async () => {
    const f = await batchFixture(await fixture());
    const first = f.items[0];
    const second = f.items[1];
    if (!first || !second) throw new Error("fixture");
    const p = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: [
        { ...first, missing_facts: ["tax_treatment"] },
        { ...second, duplicate_resolution: "review_candidate" },
      ],
    });
    expect(p.items[0]?.reason).toBe("missing_facts");
    expect(p.items[1]?.reason).toBe("duplicate_candidate_requires_resolution");
    expect(p.items[1]?.duplicate_candidates).toHaveLength(1);
    const resolved = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: [second],
    });
    expect(resolved.items[0]?.state).toBe("prepared");
  });
  it("cannot approve a receipt-bound voucher through ordinary manual-voucher routes or swap item capabilities", async () => {
    const f = await batchFixture(await fixture());
    const p = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: f.items,
    });
    const first = p.items[0],
      second = p.items[1];
    if (!first?.proposal || !second?.proposal) throw new Error("fixture");
    await expect(
      f.receipts.bookkeeping.commit(
        f.actor,
        { ...first.proposal, capability: p.capabilities[first.item_id] },
        "review",
      ),
    ).rejects.toThrow("INTENT_CONFLICT");
    const firstRef = { ...batchRef(p), item_id: first.item_id };
    await expect(
      f.receipts.bookkeeping.commit(
        f.actor,
        { ...first.proposal, capability: p.capabilities[second.item_id] },
        "review",
        () => f.receipts.guard(f.actor, firstRef),
      ),
    ).rejects.toThrow("INTENT_CONFLICT");
    expect(
      (await f.receipts.bookkeeping.status(f.actor, first.proposal)).state,
    ).toBe("prepared");
    expect(
      (await f.receipts.bookkeeping.status(f.actor, second.proposal)).state,
    ).toBe("prepared");
    const accepted = await f.receipts.bookkeeping.commit(
      f.actor,
      { ...first.proposal, capability: p.capabilities[first.item_id] },
      "review",
      () => f.receipts.guard(f.actor, firstRef),
    );
    expect(accepted.state).toBe("succeeded");
    expect(
      (await f.receipts.bookkeeping.status(f.actor, second.proposal)).state,
    ).toBe("prepared");
    expect(f.bookings()).toBe(1);
  });
  it("file expiration, policy changes and foreign-company inputs invalidate pending receipt review without creating foreign proposals", async () => {
    const f = await batchFixture(await fixture());
    const p = await f.receipts.prepare(f.actor, {
      company_id: f.a.id,
      items: f.items,
    });
    const first = p.items[0];
    if (!first) throw new Error("fixture");
    f.advance(3600000);
    await expect(
      f.receipts.guard(f.actor, { ...batchRef(p), item_id: first.item_id }),
    ).rejects.toThrow("FILE_EXPIRED");
    expect(
      (await f.receipts.view(f.actor, batchRef(p))).items.every(
        (i) => i.state === "needs_input",
      ),
    ).toBe(true);
    await f.connections.setAccountingPolicy(
      f.actor.ownerId,
      f.a.id,
      2,
      "review_required",
      false,
    );
    await expect(f.receipts.view(f.actor, batchRef(p))).rejects.toThrow(
      "INTENT_CONFLICT",
    );
    const fresh = await batchFixture(await fixture());
    const foreign = fresh.items.map((i) => ({
      ...i,
      voucher: { ...i.voucher, company_id: fresh.b.id },
    }));
    await expect(
      fresh.receipts.prepare(fresh.actor, {
        company_id: fresh.a.id,
        items: foreign,
      }),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    expect(
      (
        await fresh.connections.authorize(
          fresh.actor.ownerId,
          fresh.actor.clientId,
          fresh.b.id,
        )
      ).bookkeeping?.proposals ?? [],
    ).toHaveLength(0);
  });
}
