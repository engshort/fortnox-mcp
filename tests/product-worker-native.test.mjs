import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { prepareD1Recovery } from "../dist/product-recovery.js";

test("built M14 experiment exposes only staging/readback and keeps expired administration accessible", {
  timeout: 20000,
}, async (t) => {
  const origin = "https://product.example.invalid";
  const options = (until) =>
    convertV4MiniflareOptions({
      name: "m14-native-file-test",
      modules: true,
      scriptPath: resolve("dist/receipt-test-worker.js"),
      compatibilityDate: "2026-10-18",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "m14-native-file-test" },
      bindings: {
        PRODUCT_ENABLED: "true",
        FORTNOX_TEST_MODE: "true",
        PUBLIC_ORIGIN: origin,
        AUTH_SECRET: "synthetic-native-file-test-auth-secret",
        CREDENTIAL_ACTIVE_KEY: "a",
        CREDENTIAL_KEYS: JSON.stringify({
          a: Buffer.alloc(32, 11).toString("base64"),
        }),
        MCP_REDIRECT_URIS: JSON.stringify([
          "https://client.example.invalid/callback",
        ]),
        FORTNOX_CLIENT_ID: "synthetic-client",
        FORTNOX_CLIENT_SECRET: "synthetic-secret",
        FORTNOX_TEST_TENANTS: "100001,100002",
        RECEIPT_FILE_TRANSPORT: "node-relay",
        M14_FILE_TEST_UNTIL: new Date(until).toISOString(),
      },
      outboundService: async () => {
        throw new Error("No provider or source access in discovery checks");
      },
    });
  const runtime = new Miniflare(options(Date.now() + 60000));
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("DB");
  for (const file of [
    "0002_product_state.sql",
    "0003_product_auth.sql",
    "0004_product_oauth.sql",
    "0006_receipt_files.sql",
  ])
    await db.exec(
      (await readFile(resolve("apps/worker/migrations", file), "utf8"))
        .replace(/--[^\n]*(?:\n|$)/g, "")
        .replace(/\n/g, " "),
    );
  const health = await (await runtime.dispatchFetch(`${origin}/health`)).json();
  assert.equal(health.file_test.active, true);
  assert.match(health.file_test.source_commit, /^[a-f0-9]{40}$/);
  assert.equal(health.file_test.financial_writes, false);
  assert.equal(health.file_test.provider_file_writes, false);
  assert.equal(health.file_test.review_host_verified, false);
  const request = () =>
    runtime.dispatchFetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  const discovery = await request();
  assert.equal(discovery.status, 200);
  const names = (await discovery.json()).result.tools.map((tool) => tool.name);
  assert.deepEqual([...names].sort(), [
    "get_company_profile",
    "get_connection_status",
    "ingest_receipt_files",
    "list_companies",
    "open_receipt_file_picker",
    "read_receipt_file",
  ]);
  assert.ok(names.includes("ingest_receipt_files"));
  assert.ok(names.includes("read_receipt_file"));
  assert.equal(
    names.some((name) =>
      /prepare_receipt|commit_reviewed|upload_receipt|link_receipt/.test(name),
    ),
    false,
  );
  assert.equal((await runtime.dispatchFetch(`${origin}/admin`)).status, 401);
  await runtime.setOptions(options(Date.now() - 1000));
  assert.equal((await request()).status, 503);
  assert.equal(
    (await (await runtime.dispatchFetch(`${origin}/health`)).json()).file_test
      .active,
    false,
  );
  assert.equal((await runtime.dispatchFetch(`${origin}/sign-in`)).status, 200);
  assert.equal(
    (await runtime.dispatchFetch(`${origin}/reset-password`)).status,
    200,
  );
});

test("built product Worker uses native fetch for consent against an isolated synthetic provider", {
  timeout: 20000,
}, async (t) => {
  const origin = "https://product.example.invalid";
  let tokenCalls = 0;
  let profileCalls = 0;
  const options = (key) =>
    convertV4MiniflareOptions({
      name: "product-native-fetch-test",
      modules: true,
      scriptPath: resolve("dist/product-worker.js"),
      compatibilityDate: "2026-10-18",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "product-native-fetch-test" },
      bindings: {
        PRODUCT_ENABLED: "true",
        FORTNOX_TEST_MODE: "true",
        PUBLIC_ORIGIN: origin,
        AUTH_SECRET: "synthetic-native-worker-auth-secret",
        CREDENTIAL_ACTIVE_KEY: "a",
        CREDENTIAL_KEYS: JSON.stringify({
          a: Buffer.alloc(32, key).toString("base64"),
        }),
        MCP_REDIRECT_URIS: JSON.stringify([
          "https://client.example.invalid/callback",
        ]),
        FORTNOX_CLIENT_ID: "synthetic-client",
        FORTNOX_CLIENT_SECRET: "synthetic-client-secret",
        FORTNOX_TEST_TENANTS: "100001,100002",
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.href === "https://apps.fortnox.se/oauth-v1/token") {
          tokenCalls++;
          return Response.json({
            access_token: "synthetic-native-access-token",
            token_type: "bearer",
            expires_in: 3600,
            scope: "companyinformation profile",
          });
        }
        assert.equal(url.href, "https://api.fortnox.se/3/companyinformation");
        profileCalls++;
        return Response.json({
          CompanyInformation: {
            DatabaseNumber: "100001",
            CompanyName: "Synthetic native provider",
          },
        });
      },
    });
  const runtime = new Miniflare(options(11));
  t.after(() => runtime.dispose());
  let database = await runtime.getD1Database("DB");
  for (const file of [
    "0002_product_state.sql",
    "0003_product_auth.sql",
    "0004_product_oauth.sql",
  ])
    await database.exec(
      (await readFile(resolve("apps/worker/migrations", file), "utf8")).replace(
        /\n/g,
        " ",
      ),
    );
  const token = "synthetic-native-bootstrap-code-123456";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  await database
    .prepare(
      "INSERT INTO product_state(space,id,version,value) VALUES('installation','owner',1,?)",
    )
    .bind(
      JSON.stringify({
        phase: "ready",
        ownerId: "",
        tokenHash: Buffer.from(digest).toString("hex"),
        expiresAt: Date.now() + 60000,
      }),
    )
    .run();
  const bootstrap = await runtime.dispatchFetch(`${origin}/admin/bootstrap`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      token,
      email: "native@example.invalid",
      password: "Synthetic-native-password",
    }),
  });
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const started = await runtime.dispatchFetch(`${origin}/admin/fortnox/start`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "service" }),
  });
  assert.equal(started.status, 200);
  const authorization = new URL((await started.json()).url);
  const params = new URLSearchParams({
    state: authorization.searchParams.get("state"),
    code: "synthetic-native-code",
  });
  const finished = await runtime.dispatchFetch(
    `${origin}/admin/fortnox/callback?${params}`,
    { headers: { cookie }, redirect: "manual" },
  );
  assert.equal(
    finished.status,
    303,
    finished.status === 303 ? undefined : await finished.text(),
  );
  assert.equal(tokenCalls, 2);
  assert.equal(profileCalls, 2);
  await runtime.setOptions(options(22));
  const wrongKey = await runtime.dispatchFetch(`${origin}/admin/state`, {
    headers: { cookie },
  });
  assert.equal(wrongKey.status, 503);
  assert.equal(
    (await wrongKey.text()).includes("Synthetic native provider"),
    false,
  );
  await runtime.setOptions(options(11));
  database = await runtime.getD1Database("DB");
  const restored = await runtime.dispatchFetch(`${origin}/admin/state`, {
    headers: { cookie },
  });
  assert.equal(restored.status, 200);
  assert.equal(
    (await restored.text()).includes("Synthetic native provider"),
    true,
  );
  assert.equal(tokenCalls, 2);
  assert.equal(profileCalls, 2);
  const owner = await database
    .prepare(
      "SELECT json_extract(value,'$.ownerId') AS ownerId FROM product_state WHERE space='installation' AND id='owner'",
    )
    .first();
  const recovery = {
    origin,
    secret: "synthetic-native-worker-auth-secret",
    ownerId: owner.ownerId,
    email: "native@example.invalid",
  };
  for (const wrong of [
    { ...recovery, ownerId: "unmatched-owner' OR 1=1 --" },
    { ...recovery, email: "other@example.invalid" },
  ]) {
    const prepared = await prepareD1Recovery(wrong);
    assert.equal((await database.prepare(prepared.sql).run()).meta.changes, 0);
  }
  const page = await runtime.dispatchFetch(`${origin}/reset-password`);
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /form-action 'self'/,
  );
  const reset = async (code, requestOrigin = origin) =>
    runtime.dispatchFetch(`${origin}/auth/reset-password`, {
      method: "POST",
      headers: { origin: requestOrigin, "content-type": "application/json" },
      body: JSON.stringify({
        token: code,
        newPassword: "Synthetic-native-new-password",
      }),
    });
  const expired = await prepareD1Recovery(recovery);
  assert.equal((await database.prepare(expired.sql).run()).meta.changes, 1);
  await database
    .prepare('UPDATE "verification" SET expiresAt=? WHERE value=?')
    .bind(new Date(Date.now() - 1000).toISOString(), owner.ownerId)
    .run();
  assert.equal((await reset(expired.token)).status, 401);
  const prepared = await prepareD1Recovery(recovery);
  assert.equal((await database.prepare(prepared.sql).run()).meta.changes, 1);
  assert.equal((await database.prepare(prepared.sql).run()).meta.changes, 0);
  assert.equal(
    (await reset(prepared.token, "https://foreign.example.invalid")).status,
    403,
  );
  assert.equal((await reset(prepared.token)).status, 200);
  assert.equal((await reset(prepared.token)).status, 401);
  const revoked = await runtime.dispatchFetch(`${origin}/admin`, {
    headers: { cookie },
  });
  assert.equal(revoked.status, 401);
  const login = await runtime.dispatchFetch(`${origin}/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      email: recovery.email,
      password: "Synthetic-native-new-password",
    }),
  });
  assert.equal(login.status, 200);
  const newCookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.equal(
    (
      await runtime.dispatchFetch(`${origin}/admin/companies`, {
        headers: { cookie: newCookie },
      })
    ).status,
    200,
  );
  const currentOwner = await database
    .prepare(
      "SELECT json_extract(value,'$.ownerId') AS ownerId FROM product_state WHERE space='installation' AND id='owner'",
    )
    .first();
  assert.equal(currentOwner.ownerId, owner.ownerId);
});

test("operator recovery CLI writes private output without printing its capability or owner", {
  timeout: 10000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "product-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = {
    origin: "https://product.example.invalid",
    secret: "synthetic-private-operator-auth-secret",
    ownerId: "synthetic-operator-owner",
    email: "operator@example.invalid",
  };
  const input = join(directory, "operator.json");
  await writeFile(
    input,
    JSON.stringify({
      origin: config.origin,
      ownerId: config.ownerId,
      email: config.email,
    }),
    { mode: 0o600 },
  );
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      resolve("node_modules/tsx/dist/loader.mjs"),
      resolve("scripts/product-recovery.ts"),
      input,
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        AUTH_SECRET: config.secret,
        PRODUCT_MIGRATIONS_DIR: resolve("apps/worker/migrations"),
      },
      timeout: 8000,
    },
  );
  const code = await readFile(
    join(directory, ".data/product-recovery-code.txt"),
    "utf8",
  );
  assert.ok(code.length >= 20);
  for (const value of [code, config.secret, config.email, config.ownerId])
    assert.equal((result.stdout + result.stderr).includes(value), false);
  for (const name of ["product-recovery-code.txt", "product-recovery.sql"])
    assert.equal(
      (await stat(join(directory, ".data", name))).mode & 0o777,
      0o600,
    );
});
