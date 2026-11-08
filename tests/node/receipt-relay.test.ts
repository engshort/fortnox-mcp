import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchFile, receiptRelayTransport } from "@fortnox-mcp/files";
import {
  createReceiptRelay,
  receiptRelayAttempts,
} from "@fortnox-mcp/files/relay-node";
import { expect, it } from "vitest";
import { fileOrigin, pngFixture } from "../shared/receipt-fixtures.js";

const token = "b".repeat(64),
  origin = "https://synthetic-receipt-helper.trycloudflare.com";
const config = () => ({
  token,
  until: new Date(Date.now() + 60000).toISOString(),
  origins: fileOrigin,
});
const request = (input: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}/receipts/fetch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(input),
  });
const input = { download_url: `${fileOrigin}/a?synthetic-private-signature` };
it("runs the actual product relay protocol through the Node helper without forwarding credentials to the source", async () => {
  const session = config(),
    seen: string[] = [];
  const handler = createReceiptRelay(session, {
    async open(url) {
      seen.push(url.href);
      return new Response(pngFixture(), {
        headers: { "content-type": "image/png" },
      });
    },
  });
  const transport = receiptRelayTransport(
    { ...session, origin },
    async (url, init) => {
      expect(init?.redirect).toBe("manual");
      expect(init?.cache).toBe("no-store");
      expect(JSON.parse(String(init?.body))).toEqual(input);
      return handler(new Request(url, init));
    },
  );
  const result = await fetchFile(
    {
      ...input,
      file_id: "synthetic-private-client-id",
      file_name: "private-file.png",
    },
    { origins: [fileOrigin], transport },
  );
  expect(result.bytes).toEqual(pngFixture());
  expect(seen).toEqual([input.download_url]);
});
it("the Node helper denies missing/wrong credentials, browser origins, extra fields and excessive bodies before upstream access", async () => {
  let calls = 0;
  const handler = createReceiptRelay(config(), {
    async open() {
      calls++;
      return new Response(pngFixture());
    },
  });
  const deniedHeaders: Array<Record<string, string>> = [
    { authorization: "" },
    { authorization: "Bearer wrong" },
    { origin: "https://foreign.example" },
  ];
  for (const headers of deniedHeaders)
    expect((await handler(request(input, headers))).status).toBe(401);
  for (const value of [
    { ...input, headers: { cookie: "synthetic" } },
    { download_url: "x".repeat(9000) },
    { download_url: "https://foreign.example.com/a" },
  ]) {
    const denied = await handler(request(value));
    expect(denied.status).toBe(502);
    const text = await denied.text();
    expect(text).not.toContain(token);
    expect(text).not.toContain("synthetic-private-signature");
  }
  expect(calls).toBe(0);
});
it("the relay CLI refuses a public or malformed private config without printing its content", () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-relay-cli-"));
  try {
    const cases = [
      { mode: 0o644, text: JSON.stringify(config()) },
      {
        mode: 0o600,
        text: `${JSON.stringify(config())} invalid synthetic-private-suffix`,
      },
    ];
    for (const [index, value] of cases.entries()) {
      const path = join(dir, `session-${index}.json`);
      writeFileSync(path, value.text, { mode: value.mode });
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/serve-receipt-relay.ts", path],
        { cwd: process.cwd(), encoding: "utf8", timeout: 5000 },
      );
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        "Private receipt relay configuration unavailable",
      );
      expect(result.stdout + result.stderr).not.toContain(token);
      expect(result.stdout + result.stderr).not.toContain(
        "synthetic-private-suffix",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("reserves the bounded helper attempt count atomically across concurrent body readers and preserves exact bytes", async () => {
  let calls = 0;
  const handler = createReceiptRelay(config(), {
    async open() {
      calls++;
      return new Response(pngFixture(), {
        headers: { "content-type": "image/png" },
      });
    },
  });
  const results = await Promise.all(
    Array.from({ length: receiptRelayAttempts + 1 }, () =>
      handler(request(input)),
    ),
  );
  expect(results.filter((r) => r.status === 200)).toHaveLength(
    receiptRelayAttempts,
  );
  expect(results.filter((r) => r.status === 429)).toHaveLength(1);
  expect(calls).toBe(receiptRelayAttempts);
  const first = results.find((r) => r.status === 200);
  if (!first) throw new Error("Missing synthetic response");
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(pngFixture());
});
it("refuses stale/overlong sessions and discards a response that arrives after the operator session", async () => {
  let now = Date.now(),
    calls = 0;
  const session = { ...config(), until: new Date(now + 60000).toISOString() };
  const transport = {
    async open() {
      calls++;
      now += 120000;
      return new Response(pngFixture());
    },
  };
  const handler = createReceiptRelay(session, transport, () => now);
  const late = await handler(request(input));
  expect(late.headers.get("x-receipt-file-error")).toBe(
    "FILE_TRANSPORT_UNAVAILABLE",
  );
  expect((await handler(request(input))).status).toBe(404);
  expect(calls).toBe(1);
  for (const until of [
    new Date(Date.now() - 1).toISOString(),
    new Date(Date.now() + 16 * 60000).toISOString(),
  ])
    expect(() => createReceiptRelay({ ...config(), until }, transport)).toThrow(
      "FILE_TRANSPORT_UNAVAILABLE",
    );
});
it("caps helper downloads and rejects redirects, query strings and unsupported request routes", async () => {
  let calls = 0;
  const handler = createReceiptRelay(config(), {
    async open() {
      calls++;
      return new Response(new Uint8Array(1024 * 1024 + 1));
    },
  });
  expect(
    (await handler(request(input))).headers.get("x-receipt-file-error"),
  ).toBe("FILE_TOO_LARGE");
  const queried = request(input);
  const withQuery = new Request(`${queried.url}?extra=true`, queried);
  expect((await handler(withQuery)).status).toBe(400);
  expect(
    (
      await handler(
        new Request(`${origin}/private`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      )
    ).status,
  ).toBe(400);
  expect(calls).toBe(1);
  const redirected = createReceiptRelay(config(), {
    async open() {
      return new Response(null, {
        status: 302,
        headers: { location: "https://foreign.example.com" },
      });
    },
  });
  expect(
    (await redirected(request(input))).headers.get("x-receipt-file-error"),
  ).toBe("FILE_FETCH_FAILED");
});

it("prepares a private independent relay session without printing its credential or replacing an existing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-relay-prepare-")),
    path = join(dir, "session.json");
  try {
    const run = () =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/prepare-receipt-relay.ts", path],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 5000,
          env: { ...process.env, RECEIPT_FILE_ORIGINS: fileOrigin },
        },
      );
    const first = run();
    expect(first.status).toBe(0);
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      token: string;
      until: string;
      origins: string;
    };
    expect(/^[0-9a-f]{64}$/.test(value.token)).toBe(true);
    expect(first.stdout + first.stderr).not.toContain(value.token);
    expect(statSync(path).mode & 0o077).toBe(0);
    expect(value.origins).toBe(fileOrigin);
    expect(Date.parse(value.until)).toBeGreaterThan(Date.now());
    const repeated = run();
    expect(repeated.status).not.toBe(0);
    expect(readFileSync(path, "utf8")).toBe(JSON.stringify(value));
    expect(repeated.stdout + repeated.stderr).not.toContain(value.token);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
