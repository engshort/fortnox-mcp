import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Bookkeeping,
  Connections,
  CredentialVault,
  ReceiptAttachments,
  ReceiptFiles,
  Receipts,
  ReceiptWorkflow,
} from "@fortnox-mcp/core";
import { fileValidator } from "@fortnox-mcp/files";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteReceiptFiles } from "../../apps/node/src/receipt-storage.js";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { d1ReceiptFiles } from "../../apps/worker/src/receipt-storage.js";
import { keyA } from "../shared/connections.js";
import { fileFixture, type ReceiptFixture } from "../shared/receipt-files.js";
import { pngFixture } from "../shared/receipt-fixtures.js";
import { attachmentFixture } from "../shared/receipt-provider.js";
import { workflowFixture } from "../shared/receipt-workflow.js";

const schemas = [
  "0002_product_state.sql",
  "0004_product_oauth.sql",
  "0006_receipt_files.sql",
].map((name) =>
  readFileSync(
    new URL(`../../apps/worker/migrations/${name}`, import.meta.url),
    "utf8",
  ),
);
async function stage(fixture: ReceiptFixture) {
  const f = await fileFixture(fixture);
  const staged = await f.service.ingest(f.actor, f.a.id, f.files);
  return { actor: f.actor, staged };
}
async function verify(
  fixture: ReceiptFixture,
  record: Awaited<ReturnType<typeof stage>>,
) {
  let sourceCalls = 0;
  const service = new ReceiptFiles(
    new Connections(fixture.state, new CredentialVault({ a: keyA }, "a")),
    fixture.files,
    async () => {
      sourceCalls++;
      throw new Error("No fetch on recovery");
    },
    fileValidator,
    true,
  );
  for (const file of record.staged.files) {
    expect(
      (
        await service.read(record.actor, {
          company_id: record.staged.company_id,
          workflow_id: record.staged.workflow_id,
          file_id: file.file_id,
        })
      ).bytes,
    ).toEqual(pngFixture());
  }
  expect(sourceCalls).toBe(0);
  await fixture.files.cleanup(Date.now() + 3600000);
  expect(
    await fixture.files.get(
      record.staged.files[0]?.file_id as string,
      record.actor.ownerId,
      record.staged.company_id,
    ),
  ).toBeNull();
}
it("reopens SQLite with two encrypted file outputs and removes bytes after expiry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-sqlite-"));
  let db = new DatabaseSync(join(dir, "test.sqlite"));
  const fixture = () => ({
    state: sqliteState(db),
    files: sqliteReceiptFiles(db),
    raw: async () => "",
  });
  try {
    for (const s of schemas) db.exec(s);
    const record = await stage(fixture());
    db.close();
    db = new DatabaseSync(join(dir, "test.sqlite"));
    await verify(fixture(), record);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("restarts actual workerd/D1 and recovers both encrypted files without refetch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-d1-"));
  const options = convertV4MiniflareOptions({
    name: "m4-restart",
    modules: true,
    script: "export default {fetch(){return new Response('synthetic')}}",
    compatibilityDate: "2026-10-18",
    d1Databases: { DB: "m4-restart" },
    resourcePersistencePath: dir,
  });
  let runtime = new Miniflare(options);
  try {
    const db = await runtime.getD1Database("DB");
    for (const s of schemas)
      await db.exec(s.replace(/--[^\n]*(?:\n|$)/g, "").replace(/\n/g, " "));
    const record = await stage({
      state: d1State(db),
      files: d1ReceiptFiles(db),
      raw: async () => "",
    });
    await runtime.dispose();
    runtime = new Miniflare(options);
    const next = await runtime.getD1Database("DB");
    await verify(
      {
        state: d1State(next),
        files: d1ReceiptFiles(next),
        raw: async () => "",
      },
      record,
    );
  } finally {
    await runtime.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

async function uncertainUpload(fixture: ReceiptFixture) {
  const f = await attachmentFixture(fixture);
  f.mode({ loseUpload: true });
  expect((await f.attachments.upload(f.actor, f.ref)).state).toBe(
    "outcome_unknown",
  );
  return {
    actor: f.actor,
    ref: f.ref,
    p: f.p,
    provider: f.provider,
    gates: f.receipts.bookkeeping.gates,
  };
}
async function verifyUncertainUpload(
  fixture: ReceiptFixture,
  record: Awaited<ReturnType<typeof uncertainUpload>>,
) {
  let calls = 0;
  const unexpected = async () => {
    calls++;
    throw new Error("Unexpected resend");
  };
  const connections = new Connections(
    fixture.state,
    new CredentialVault({ a: keyA }, "a"),
  );
  const files = new ReceiptFiles(
    connections,
    fixture.files,
    unexpected,
    fileValidator,
    true,
  );
  const receipts = new Receipts(
    new Bookkeeping(connections, record.provider, record.gates),
    files,
    true,
  );
  const attachments = new ReceiptAttachments(
    receipts,
    {
      upload: unexpected,
      link: unexpected,
      connection: unexpected,
      retrieve: unexpected,
    },
    { upload: true, link: true, retrieve: true },
  );
  expect((await attachments.upload(record.actor, record.ref)).state).toBe(
    "outcome_unknown",
  );
  const view = await receipts.view(record.actor, {
    company_id: record.ref.company_id,
    batch_id: record.ref.batch_id,
    batch_hash: record.ref.batch_hash,
  });
  expect(view.items[0]?.state).toBe("outcome_unknown");
  expect(view.items[0]?.next_action).toBe("reconcile_before_resending");
  expect(calls).toBe(0);
}
it("reopens SQLite without resending a receipt upload whose accepted response was lost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-upload-sqlite-"));
  let db = new DatabaseSync(join(dir, "test.sqlite"));
  const fixture = () => ({
    state: sqliteState(db),
    files: sqliteReceiptFiles(db),
    raw: async () => "",
  });
  try {
    for (const schema of schemas) db.exec(schema);
    const record = await uncertainUpload(fixture());
    db.close();
    db = new DatabaseSync(join(dir, "test.sqlite"));
    await verifyUncertainUpload(fixture(), record);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("restarts actual workerd/D1 without resending an unknown receipt upload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-upload-d1-"));
  const options = convertV4MiniflareOptions({
    name: "m4-upload-restart",
    modules: true,
    script: "export default {fetch(){return new Response('synthetic')}}",
    compatibilityDate: "2026-10-18",
    d1Databases: { DB: "m4-upload-restart" },
    resourcePersistencePath: dir,
  });
  let runtime = new Miniflare(options);
  try {
    const db = await runtime.getD1Database("DB");
    for (const schema of schemas)
      await db.exec(
        schema.replace(/--[^\n]*(?:\n|$)/g, "").replace(/\n/g, " "),
      );
    const record = await uncertainUpload({
      state: d1State(db),
      files: d1ReceiptFiles(db),
      raw: async () => "",
    });
    await runtime.dispose();
    runtime = new Miniflare(options);
    const next = await runtime.getD1Database("DB");
    await verifyUncertainUpload(
      {
        state: d1State(next),
        files: d1ReceiptFiles(next),
        raw: async () => "",
      },
      record,
    );
  } finally {
    await runtime.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

async function stoppedWorkflow(
  fixture: ReceiptFixture,
  mode: "partial" | "unknown",
) {
  const f = await workflowFixture(fixture);
  if (mode === "partial") f.mode({ linkStatus: 400 });
  else {
    const submit = f.provider.submit;
    f.provider.submit = async (...args) => {
      await submit(...args);
      throw new Error("synthetic lost financial answer");
    };
  }
  await f.commit();
  return {
    actor: f.actor,
    ref: f.ref,
    provider: f.provider,
    gates: f.receipts.bookkeeping.gates,
    mode,
  };
}
async function resumeStoppedWorkflow(
  fixture: ReceiptFixture,
  record: Awaited<ReturnType<typeof stoppedWorkflow>>,
) {
  let sourceCalls = 0,
    financialCalls = 0,
    uploads = 0,
    links = 0;
  const connections = new Connections(
    fixture.state,
    new CredentialVault({ a: keyA }, "a"),
  );
  const files = new ReceiptFiles(
    connections,
    fixture.files,
    async () => {
      sourceCalls++;
      throw new Error("no source replay");
    },
    fileValidator,
    true,
  );
  const receipts = new Receipts(
    new Bookkeeping(
      connections,
      {
        ...record.provider,
        submit: async () => {
          financialCalls++;
          throw new Error("no financial replay");
        },
      },
      record.gates,
    ),
    files,
    true,
  );
  const attachments = new ReceiptAttachments(
    receipts,
    {
      upload: async () => {
        uploads++;
        throw new Error("no upload replay");
      },
      link: async (_actor, ref, before) => {
        await before();
        links++;
        expect(ref.file_id).toBe("provider-file-1");
        expect(ref.voucher).toEqual({
          financial_year: 7,
          series: "A",
          number: 1,
        });
        return { state: "succeeded", reference: ref.file_id };
      },
      connection: async () => true,
      retrieve: async () => {
        throw new Error("not used");
      },
    },
    { upload: true, link: true, retrieve: true },
  );
  const workflow = new ReceiptWorkflow(attachments, true);
  const input = {
    company_id: record.ref.company_id,
    batch_id: record.ref.batch_id,
    batch_hash: record.ref.batch_hash,
    item_ids: [record.ref.item_id],
  };
  const result = await workflow.resume(record.actor, input);
  expect(result.items[0]?.state).toBe(
    record.mode === "partial" ? "completed" : "outcome_unknown",
  );
  await workflow.resume(record.actor, input);
  expect({ sourceCalls, financialCalls, uploads, links }).toEqual({
    sourceCalls: 0,
    financialCalls: 0,
    uploads: 0,
    links: record.mode === "partial" ? 1 : 0,
  });
}
for (const mode of ["partial", "unknown"] as const) {
  it(`reopens SQLite and resumes a ${mode} receipt without resending its financial write`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "m4-workflow-sqlite-"));
    let db = new DatabaseSync(join(dir, "test.sqlite"));
    const fixture = () => ({
      state: sqliteState(db),
      files: sqliteReceiptFiles(db),
      raw: async () => "",
    });
    try {
      for (const schema of schemas) db.exec(schema);
      const record = await stoppedWorkflow(fixture(), mode);
      db.close();
      db = new DatabaseSync(join(dir, "test.sqlite"));
      await resumeStoppedWorkflow(fixture(), record);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it(`restarts actual workerd/D1 and resumes a ${mode} receipt without resending its financial write`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "m4-workflow-d1-"));
    const options = convertV4MiniflareOptions({
      name: "m4-workflow-restart",
      modules: true,
      script: "export default {fetch(){return new Response('synthetic')}}",
      compatibilityDate: "2026-10-18",
      d1Databases: { DB: "m4-workflow-restart" },
      resourcePersistencePath: dir,
    });
    let runtime = new Miniflare(options);
    try {
      const db = await runtime.getD1Database("DB");
      for (const schema of schemas)
        await db.exec(
          schema.replace(/--[^\n]*(?:\n|$)/g, "").replace(/\n/g, " "),
        );
      const record = await stoppedWorkflow(
        { state: d1State(db), files: d1ReceiptFiles(db), raw: async () => "" },
        mode,
      );
      await runtime.dispose();
      runtime = new Miniflare(options);
      const next = await runtime.getD1Database("DB");
      await resumeStoppedWorkflow(
        {
          state: d1State(next),
          files: d1ReceiptFiles(next),
          raw: async () => "",
        },
        record,
      );
    } finally {
      await runtime.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
}
