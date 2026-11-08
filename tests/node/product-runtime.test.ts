import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  nodeEnvironment,
  nodeRuntimeSettings,
  proxyRequest,
} from "../../apps/node/src/runtime-config.js";

it("keeps local defaults, honors an explicit database, and rejects invalid runtime settings", () => {
  expect(nodeRuntimeSettings({}).host).toBe("127.0.0.1");
  expect(nodeRuntimeSettings({}).port).toBe(8787);
  expect(
    nodeRuntimeSettings({
      DATA_DIR: "/tmp/m5",
      PRODUCT_DATABASE: "/tmp/m5-other.sqlite",
    }).database,
  ).toBe("/tmp/m5-other.sqlite");
  expect(nodeRuntimeSettings({ DATA_DIR: "/tmp/m5" }).database).toBe(
    "/tmp/m5/product.sqlite",
  );
  for (const env of [
    { PORT: "NaN" },
    { HOST: "bad\nhost" },
    { NODE_PROXY_MODE: "automatic" },
  ])
    expect(() => nodeRuntimeSettings(env)).toThrow();
});

it("loads file-mounted secrets without ambiguous fallback or secret-bearing errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m5-secrets-"));
  try {
    const path = join(dir, "secret");
    await writeFile(path, "synthetic-private-value\n", { mode: 0o600 });
    expect(
      (await nodeEnvironment({ AUTH_SECRET_FILE: path })).AUTH_SECRET,
    ).toBe("synthetic-private-value");
    await expect(
      nodeEnvironment({ AUTH_SECRET: "synthetic", AUTH_SECRET_FILE: path }),
    ).rejects.toThrow("Conflicting AUTH_SECRET");
    await expect(
      nodeEnvironment({ AUTH_SECRET_FILE: join(dir, "missing") }),
    ).rejects.toThrow(/^Unavailable AUTH_SECRET file$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("normalizes only the configured proxy authority without rewriting browser Origin", () => {
  const request = new Request("http://mvp.invalid/mcp", {
    headers: {
      "x-forwarded-proto": "https",
      origin: "https://foreign.invalid",
    },
  });
  expect(proxyRequest(request, "https://mvp.invalid", "none")).toBe(request);
  const adapted = proxyRequest(request, "https://mvp.invalid", "nginx");
  expect(adapted.url).toBe("https://mvp.invalid/mcp");
  expect(adapted.headers.get("origin")).toBe("https://foreign.invalid");
  for (const candidate of [
    new Request("http://other.invalid/", {
      headers: { "x-forwarded-proto": "https" },
    }),
    new Request("http://mvp.invalid/", {
      headers: { "x-forwarded-proto": "https,http" },
    }),
  ])
    expect(() =>
      proxyRequest(candidate, "https://mvp.invalid", "nginx"),
    ).toThrow("PROXY_DENIED");
});

it("boots the actual Node entry behind HTTPS proxy headers, keeps secure sessions through SIGTERM/restart, and rejects foreign Origin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m5-runtime-"));
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const port = address.port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PRODUCT_ENABLED: "true",
    PUBLIC_ORIGIN: "https://mvp.invalid",
    NODE_PROXY_MODE: "nginx",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dir,
    AUTH_SECRET: "synthetic-owner-secret-at-least-thirty-two-characters",
    AUTH_SECRET_FILE: "",
    CREDENTIAL_KEYS_FILE: "",
    CREDENTIAL_KEYS: JSON.stringify({
      a: Buffer.alloc(32, 7).toString("base64"),
    }),
    CREDENTIAL_ACTIVE_KEY: "a",
    MCP_REDIRECT_URIS:
      '["https://chatgpt.com/connector_platform_oauth_redirect"]',
    FORTNOX_TEST_MODE: "false",
  };
  delete env.PRODUCT_DATABASE;
  const start = () =>
    spawn(
      process.execPath,
      ["--import", "tsx", "apps/node/src/product-main.ts"],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
  let child = start();
  const request = (path: string, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        `http://127.0.0.1:${port}${path}`,
        {
          method: init.method ?? "GET",
          headers: {
            host: "mvp.invalid",
            "x-forwarded-proto": "https",
            ...Object.fromEntries(new Headers(init.headers)),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (part) => chunks.push(Buffer.from(part)));
          response.on("end", () => {
            const headers = new Headers();
            for (let i = 0; i < response.rawHeaders.length; i += 2)
              headers.append(
                response.rawHeaders[i] as string,
                response.rawHeaders[i + 1] as string,
              );
            resolve(
              new Response(new Uint8Array(Buffer.concat(chunks)), {
                status: response.statusCode,
                headers,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(5000, () =>
        req.destroy(new Error("Synthetic request timeout")),
      );
      req.end(init.body ? String(init.body) : undefined);
    });
  const ready = async () => {
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw new Error("Synthetic server exited");
      try {
        if ((await request("/health")).ok) return;
      } catch {}
      await delay(30);
    }
    throw new Error("Synthetic server startup timeout");
  };
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exit = new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    child.kill("SIGTERM");
    expect(await exit).toBe(0);
  };
  try {
    await ready();
    const token = await readFile(join(dir, "bootstrap-code.txt"), "utf8");
    const body = JSON.stringify({
      token,
      email: "owner@example.invalid",
      password: "synthetic-test-password",
    });
    expect(
      (
        await request("/admin/bootstrap", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://foreign.invalid",
          },
          body,
        })
      ).status,
    ).toBe(403);
    const accepted = await request("/admin/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://mvp.invalid",
      },
      body,
    });
    expect(accepted.status).toBe(200);
    const cookies = accepted.headers.getSetCookie();
    expect(cookies.some((c) => /; Secure/i.test(c))).toBe(true);
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    expect((await request("/admin", { headers: { cookie } })).status).toBe(200);
    await stop();
    child = start();
    await ready();
    expect((await request("/admin", { headers: { cookie } })).status).toBe(200);
    expect(
      (
        await request("/admin/bootstrap", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://mvp.invalid",
          },
          body,
        })
      ).status,
    ).toBe(403);
    await stop();
  } finally {
    child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
