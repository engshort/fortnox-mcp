import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileRelay } from "../src/file-relay.js";
import { relayFileTransport } from "../src/file-relay-transport.js";
import { workerFileByteBudget } from "../src/file-worker-budget.js";
import { fetchFile } from "../src/files.js";
import { fileOrigin, pngFixture } from "./file-fixtures.js";

const token = "a".repeat(64);
const origin = "https://synthetic-relay.trycloudflare.com";
const config = () => ({
  token,
  until: new Date(Date.now() + 60000).toISOString(),
  origins: fileOrigin,
});
const request = (data: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}/s00-files/fetch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(data),
  });
const input = {
  download_url: `${fileOrigin}/receipt?signature=synthetic`,
  file_id: "synthetic",
};

test("explicit relay preserves exact bytes and both origin boundaries without forwarding client headers", async () => {
  const bytes = pngFixture();
  const seen: string[] = [];
  const session = config();
  const handler = createFileRelay(session, {
    async open(url) {
      seen.push(url.origin);
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    },
  });
  const transport = relayFileTransport(
    { ...session, origin },
    async (url, init) => {
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.cache, "no-store");
      assert.equal(new URL(String(url)).origin, origin);
      assert.doesNotMatch(String(init?.body), /file_id|cookie|authorization/i);
      return handler(new Request(url, init));
    },
  );
  const output = await fetchFile(input, {
    origins: [fileOrigin],
    transport,
    maxBytes: workerFileByteBudget,
  });
  assert.deepEqual(output.bytes, bytes);
  assert.deepEqual(seen, [fileOrigin]);
  const denied = await handler(
    request({ download_url: "https://unapproved.example.com/a" }),
  );
  assert.equal(denied.headers.get("x-s00-file-error"), "FILE_URL_DENIED");
  assert.equal(seen.length, 1);
});

test("relay rejects unauthorized, browser, expired and oversized inputs before upstream access", async () => {
  let calls = 0;
  const session = config();
  const handler = createFileRelay(session, {
    async open() {
      calls++;
      return new Response(pngFixture());
    },
  });
  const deniedHeaders: Array<Record<string, string>> = [
    { authorization: "Bearer wrong" },
    { origin: "https://evil.example.com" },
    { authorization: "" },
  ];
  for (const headers of deniedHeaders) {
    assert.equal(
      (await handler(request({ download_url: input.download_url }, headers)))
        .status,
      401,
    );
  }
  for (const data of [
    { download_url: input.download_url, headers: { cookie: "synthetic" } },
    { download_url: "x".repeat(9000) },
  ])
    assert.equal(
      (await handler(request(data))).headers.get("x-s00-file-error"),
      "FILE_INVALID",
    );
  const expired = createFileRelay(
    { ...session, until: new Date(Date.now() - 1).toISOString() },
    {
      async open() {
        calls++;
        return new Response();
      },
    },
  );
  assert.equal(
    (await expired(request({ download_url: input.download_url }))).status,
    404,
  );
  assert.equal(calls, 0);
  let clock = Date.now();
  const late = createFileRelay(
    session,
    {
      async open() {
        clock += 120000;
        return new Response(pngFixture());
      },
    },
    () => clock,
  );
  assert.equal(
    (await late(request({ download_url: input.download_url }))).headers.get(
      "x-s00-file-error",
    ),
    "FILE_TRANSPORT_UNAVAILABLE",
  );
});

test("relay enforces download count and Worker byte budget, and never follows a relay redirect", async () => {
  let calls = 0;
  const session = config();
  const handler = createFileRelay(session, {
    async open() {
      calls++;
      return new Response(new Uint8Array(workerFileByteBudget + 1));
    },
  });
  for (let i = 0; i < 8; i++)
    assert.equal(
      (
        await handler(request({ download_url: input.download_url }))
      ).headers.get("x-s00-file-error"),
      "FILE_TOO_LARGE",
    );
  assert.equal(
    (await handler(request({ download_url: input.download_url }))).status,
    429,
  );
  assert.equal(calls, 8);
  const redirects = relayFileTransport(
    { ...session, origin },
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://unapproved.example.com" },
      }),
  );
  await assert.rejects(
    () =>
      redirects.open(new URL(input.download_url), new AbortController().signal),
    /FILE_FETCH_FAILED/,
  );
  let sent = 0;
  for (const access of [
    { ...session, origin: "http://localhost" },
    { ...session, origin: "https://unapproved.example.com" },
    {
      ...session,
      origin,
      until: new Date(Date.now() + 16 * 60000).toISOString(),
    },
    { ...session, origin, token: "bad" },
  ]) {
    const transport = relayFileTransport(access, async () => {
      sent++;
      return new Response();
    });
    await assert.rejects(() =>
      transport.open(new URL(input.download_url), new AbortController().signal),
    );
  }
  assert.equal(sent, 0);
});
