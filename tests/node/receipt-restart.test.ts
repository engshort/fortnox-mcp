import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Connections, CredentialVault, ReceiptFiles } from "@fortnox-mcp/core";
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
