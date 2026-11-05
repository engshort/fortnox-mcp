import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { fileSchema } from "../src/file-sql.js";
import { sqliteFileStore } from "../src/file-sqlite.js";
import { fileValidator } from "../src/file-validation.js";
import { reviewSchema } from "../src/review.js";
import { sqliteReviewStore } from "../src/review-sqlite.js";
import { handleRuntimeRequest } from "../src/runtime-http.js";
import { runRuntimeProbe, runtimeFile } from "../src/runtime-probe.js";

const token = "a".repeat(64),
  origin = "https://runtime.example.com";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(fileSchema);
  db.exec(reviewSchema);
  return {
    db,
    context: {
      owner: "synthetic-runtime-owner",
      secret: "synthetic-runtime-encryption-key-not-real-credential",
      files: sqliteFileStore(db),
      reviews: sqliteReviewStore(db),
      validator: fileValidator,
    },
  };
}
test("runtime probe verifies exact two-file output and one concurrent winner, then deletes its staged bytes", async () => {
  const f = fixture();
  const file = runtimeFile(1024),
    body = new Uint8Array(2048);
  body.set(file);
  body.set(file, 1024);
  try {
    const result = await runRuntimeProbe(f.context, "small", body);
    assert.equal(result.decimalTotal, "50.00");
    assert.equal(result.acceptedClaims, 1);
    assert.equal(result.concurrentClaims, 16);
    assert.equal(result.totalFileBytes, 2048);
    assert.equal(result.sha256[0], result.sha256[1]);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM s00_file_chunks").get()?.n,
      0,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM s00_files").get()?.n,
      0,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM s00_review WHERE id=?")
        .get(result.stateReference.id)?.state,
      "consumed",
    );
    assert.ok(body.every((v) => v === 0));
  } finally {
    f.db.close();
  }
});
test("operator runtime endpoint is default-off and denies wrong/expired credentials, foreign origins, arbitrary inputs and excess bytes", async () => {
  const f = fixture();
  const until = new Date(Date.now() + 60_000).toISOString();
  const access = { origin, token, until, context: f.context };
  const request = (options: RequestInit = {}) =>
    new Request(`${origin}/s00-runtime/small`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array(2048),
      ...options,
    });
  try {
    assert.equal(
      (await handleRuntimeRequest(request(), { ...access, token: undefined }))
        ?.status,
      404,
    );
    assert.equal(
      (
        await handleRuntimeRequest(request(), {
          ...access,
          until: new Date(Date.now() - 1000).toISOString(),
        })
      )?.status,
      404,
    );
    assert.equal(
      (
        await handleRuntimeRequest(
          request({ headers: { authorization: `Bearer ${"b".repeat(64)}` } }),
          access,
        )
      )?.status,
      401,
    );
    assert.equal(
      (
        await handleRuntimeRequest(
          request({
            headers: {
              authorization: `Bearer ${token}`,
              origin: "https://other.example.com",
            },
          }),
          access,
        )
      )?.status,
      401,
    );
    assert.equal(
      (
        await handleRuntimeRequest(
          request({ body: new Uint8Array(2049) }),
          access,
        )
      )?.status,
      422,
    );
    assert.equal(
      (
        await handleRuntimeRequest(
          new Request(`${origin}/s00-runtime/arbitrary`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
          }),
          access,
        )
      )?.status,
      400,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM s00_files").get()?.n,
      0,
    );
  } finally {
    f.db.close();
  }
});
test("actual workerd executes the operator budget probe and preserves its one-winner state across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "s00-runtime-worker-"));
  const bundle = await build({
    entryPoints: ["test/runtime-worker.fixture.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    external: ["node:*"],
    write: false,
  });
  const options = convertV4MiniflareOptions({
    name: "s00-runtime-test",
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-18",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "s00-runtime-test" },
    resourcePersistencePath: directory,
    bindings: {
      TOKEN: token,
      UNTIL: new Date(Date.now() + 120_000).toISOString(),
    },
  });
  let mf = new Miniflare(options);
  try {
    const db = await mf.getD1Database("DB");
    for (const sql of `${fileSchema};${reviewSchema}`
      .split(";")
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
    const file = runtimeFile(1024),
      body = new Uint8Array(2048);
    body.set(file);
    body.set(file, 1024);
    const response = await mf.dispatchFetch(`${origin}/s00-runtime/small`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      body,
    });
    const result = (await response.json()) as {
      acceptedClaims: number;
      decimalTotal: string;
      stateReference: { id: string; expires: number };
    };
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.acceptedClaims, 1);
    assert.equal(result.decimalTotal, "50.00");
    await mf.dispose();
    mf = new Miniflare(options);
    const reference = new URLSearchParams({
      id: result.stateReference.id,
      expires: String(result.stateReference.expires),
    });
    const state = await mf.dispatchFetch(
      `${origin}/s00-runtime/state?${reference}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.deepEqual(await state.json(), {
      state: "consumed",
      synthetic: true,
      fortnoxEnabled: false,
    });
    const reopened = await mf.getD1Database("DB");
    assert.equal(
      (
        await reopened
          .prepare("SELECT count(*) AS n FROM s00_file_chunks")
          .first<{ n: number }>()
      )?.n,
      0,
    );
  } finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
