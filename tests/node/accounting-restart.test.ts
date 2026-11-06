import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Bookkeeping,
  Connections,
  CredentialVault,
  type StateStore,
} from "@fortnox-mcp/core";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { accountingFixture } from "../shared/accounting.js";
import { keyA } from "../shared/connections.js";

const migration = readFileSync(
  new URL(
    "../../apps/worker/migrations/0002_product_state.sql",
    import.meta.url,
  ),
  "utf8",
);
async function uncertain(state: StateStore) {
  const f = await accountingFixture(state);
  const p = await f.service.prepare(f.actor, f.voucher);
  f.provider.submit = async (_a, _v, dispatch) => {
    await dispatch();
    throw new Error("synthetic lost response");
  };
  await f.service.commit(
    f.actor,
    {
      company_id: p.company_id,
      proposal_id: p.proposal_id,
      proposal_hash: p.proposal_hash,
      capability: p.capability,
    },
    "review",
  );
  return { f, p };
}
async function verify(
  state: StateStore,
  record: Awaited<ReturnType<typeof uncertain>>,
) {
  const { f, p } = record;
  let calls = 0;
  const service = new Bookkeeping(
    new Connections(state, new CredentialVault({ a: keyA }, "a")),
    {
      ...f.provider,
      submit: async () => {
        calls++;
        throw new Error("unexpected resend");
      },
    },
    f.gates,
  );
  const ref = {
    company_id: p.company_id,
    proposal_id: p.proposal_id,
    proposal_hash: p.proposal_hash,
  };
  expect((await service.status(f.actor, ref)).state).toBe("outcome_unknown");
  await expect(
    service.commit(f.actor, { ...ref, capability: p.capability }, "review"),
  ).rejects.toThrow("INTENT_CONFLICT");
  expect(calls).toBe(0);
}
it("bookkeeping's encrypted proposal and unknown intent survive closing and reopening SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m3-sqlite-"));
  let db = new DatabaseSync(join(dir, "test.sqlite"));
  try {
    db.exec(migration);
    const record = await uncertain(sqliteState(db));
    db.close();
    db = new DatabaseSync(join(dir, "test.sqlite"));
    await verify(sqliteState(db), record);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("bookkeeping's encrypted proposal and unknown intent survive an actual workerd/D1 restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m3-d1-"));
  const options = convertV4MiniflareOptions({
    name: "m3-restart",
    modules: true,
    script: "export default { fetch() { return new Response('synthetic'); } };",
    compatibilityDate: "2026-10-18",
    d1Databases: { DB: "m3-restart" },
    resourcePersistencePath: dir,
  });
  let runtime = new Miniflare(options);
  try {
    const db = await runtime.getD1Database("DB");
    await db.exec(migration.replace(/\n/g, " "));
    const record = await uncertain(d1State(db));
    await runtime.dispose();
    runtime = new Miniflare(options);
    await verify(d1State(await runtime.getD1Database("DB")), record);
  } finally {
    await runtime.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
