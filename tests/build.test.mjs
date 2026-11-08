import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import installation from "../dist/installation.js";
import product from "../dist/product-worker.js";
import worker from "../dist/worker.js";

test("built docs entry serves guides without bundling an external specification", {
  timeout: 10_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "built-docs-"));
  const environment = { ...process.env, PORT: "8798" };
  delete environment.FORTNOX_OPENAPI_PATH;
  const child = spawn(
    process.execPath,
    ["--disallow-code-generation-from-strings", resolve("dist/docs-node.js")],
    {
      cwd: directory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const started = await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => {
      throw new Error(`Docs entry exited before startup: ${code}`);
    }),
  ]);
  assert.match(String(started[0]), /docs_server_started/);
  const request = syntheticRequest();
  const body = await request.json();
  body.params = { name: "search_api_docs", arguments: { query: "OAuth" } };
  const response = await fetch("http://127.0.0.1:8798/mcp", {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
  const result = (await response.json()).result;
  assert.equal(result.structuredContent.api_reference.status, "unavailable");
  assert.equal(result.structuredContent.results[0].doc_id, "guide:oauth");
});

function syntheticRequest() {
  return new Request("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "read_synthetic_status", arguments: { dataset: "s01" } },
    }),
  });
}

async function expectSyntheticResult(response) {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.result.structuredContent, {
    dataset: "s01",
    synthetic: true,
    status: "ok",
  });
}

test("bundled Worker runs with dynamic code generation disabled in Node", async () => {
  await expectSyntheticResult(await worker.fetch(syntheticRequest()));
});

test("built product Worker is disabled without explicit configuration", async () => {
  assert.equal(
    (
      await product.fetch(
        new Request("https://product.example.invalid/mcp"),
        {},
      )
    ).status,
    503,
  );
});

test("built product Node entry migrates, bootstraps once and starts without provider access", {
  timeout: 15000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "built-product-"));
  const port = "8797";
  const child = spawn(
    process.execPath,
    [
      "--disallow-code-generation-from-strings",
      resolve("dist/product-node.js"),
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        PRODUCT_ENABLED: "true",
        PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
        PORT: port,
        PRODUCT_DATABASE: join(directory, "product.sqlite"),
        PRODUCT_MIGRATIONS_DIR: resolve("apps/worker/migrations"),
        AUTH_SECRET: "synthetic-built-product-auth-secret",
        CREDENTIAL_ACTIVE_KEY: "a",
        CREDENTIAL_KEYS: JSON.stringify({
          a: Buffer.alloc(32, 11).toString("base64"),
        }),
        MCP_REDIRECT_URIS: '["https://client.example.invalid/callback"]',
        FORTNOX_TEST_MODE: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => {
      throw new Error("Product exited before startup");
    }),
  ]);
  const token = await readFile(join(directory, "bootstrap-code.txt"), "utf8");
  const response = await fetch(`http://127.0.0.1:${port}/admin/bootstrap`, {
    method: "POST",
    headers: {
      origin: `http://127.0.0.1:${port}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token,
      email: "built@example.invalid",
      password: "Synthetic-built-password",
    }),
  });
  assert.equal(response.status, 200);
  const replay = await fetch(`http://127.0.0.1:${port}/admin/bootstrap`, {
    method: "POST",
    headers: {
      origin: `http://127.0.0.1:${port}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token,
      email: "built@example.invalid",
      password: "Synthetic-built-password",
    }),
  });
  assert.equal(replay.status, 403);
});

test("bundled installation reports missing storage and keeps remote MCP disabled", async () => {
  const health = await installation.fetch(
    new Request("https://installation.example.invalid/health"),
  );
  assert.equal(health.status, 503);
  assert.deepEqual(await health.json(), {
    ok: false,
    runtime: "worker",
    database: "unavailable",
    fortnox: "disabled",
    remoteMcp: "disabled",
  });
  const mcp = await installation.fetch(
    new Request("https://installation.example.invalid/mcp", { method: "POST" }),
  );
  assert.equal(mcp.status, 403);
});

for (const experiment of [false, true])
  test(`built Node file profile is ${experiment ? "separate, direct-only and expiring" : "unavailable in the ordinary entry"}`, {
    timeout: 10000,
  }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "built-node-file-test-"));
    const port = experiment ? "8796" : "8793",
      origin = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      [
        resolve(
          experiment ? "dist/receipt-test-node.js" : "dist/product-node.js",
        ),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          PRODUCT_ENABLED: "true",
          HOST: "127.0.0.1",
          PORT: port,
          NODE_PROXY_MODE: "none",
          PUBLIC_ORIGIN: origin,
          PRODUCT_DATABASE: join(directory, "product.sqlite"),
          PRODUCT_MIGRATIONS_DIR: resolve("apps/worker/migrations"),
          UI_ASSETS_DIR: resolve("dist/admin"),
          AUTH_SECRET: "synthetic-node-file-profile-secret-at-least-32",
          CREDENTIAL_KEYS: JSON.stringify({
            a: Buffer.alloc(32, 11).toString("base64"),
          }),
          CREDENTIAL_ACTIVE_KEY: "a",
          MCP_REDIRECT_URIS: '["https://client.example.invalid/callback"]',
          FORTNOX_TEST_MODE: "true",
          FORTNOX_TEST_TENANTS: "100001,100002",
          RECEIPT_FILE_TRANSPORT: "node-direct",
          M14_FILE_TEST_UNTIL: new Date(Date.now() + 1800).toISOString(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(async () => {
      if (child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await stopped;
      }
      await rm(directory, { recursive: true, force: true });
    });
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw new Error("Fixture startup failed");
      }),
    ]);
    const health = await (await fetch(`${origin}/health`)).json();
    if (experiment) {
      assert.match(health.file_test.source_commit, /^[a-f0-9]{40}$/);
      assert.equal(health.file_test.financial_writes, false);
      assert.equal(health.file_test.provider_file_writes, false);
      assert.equal(health.file_test.review_host_verified, false);
      await new Promise((r) => setTimeout(r, 1900));
      assert.equal(
        (await (await fetch(`${origin}/health`)).json()).file_test.active,
        false,
      );
      assert.equal(
        (await fetch(`${origin}/mcp`, { method: "POST" })).status,
        503,
      );
    } else assert.equal(health.file_test, undefined);
    assert.equal((await fetch(`${origin}/setup`)).status, 200);
    assert.equal((await fetch(`${origin}/admin-assets/admin.js`)).status, 200);
  });

test("built Node entry starts on loopback and serves the synthetic tool", {
  timeout: 10_000,
}, async (t) => {
  const child = spawn(process.execPath, ["dist/node.js"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });
  const started = await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => {
      throw new Error(`Node entry exited before startup: ${code}`);
    }),
  ]);
  assert.match(String(started[0]), /server_started/);
  await expectSyntheticResult(await fetch(syntheticRequest()));
});
