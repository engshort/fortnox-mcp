import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  type FileSocket,
  socketFileTransport,
} from "../src/file-socket-transport.js";
import { fileSchema } from "../src/file-sql.js";
import { sqliteFileStore } from "../src/file-sqlite.js";
import { fileValidator } from "../src/file-validation.js";
import {
  approvedFileUrl,
  digest,
  type FileContext,
  FileError,
  fetchFile,
  fileLimits,
  fileService,
  isPublicAddress,
  parseFileOrigins,
} from "../src/files.js";
import { createProbeServer } from "../src/server.js";
import {
  fileOrigin,
  fixtureSecret,
  jpegFixture,
  pdfFixture,
  pngFixture,
} from "./file-fixtures.js";

const now = 2_000_000_000_000;
const input = (url = `${fileOrigin}/receipt`) => ({
  download_url: url,
  file_id: "synthetic-client-file",
});
const batch = { files: [input(), input(`${fileOrigin}/receipt2`)] };
function fixture(db = new DatabaseSync(":memory:")) {
  db.exec(fileSchema);
  const bytes = pngFixture();
  const context: FileContext = {
    owner: "owner-a",
    company: "company-a",
    secret: fixtureSecret,
    origins: [fileOrigin],
    store: sqliteFileStore(db),
    validator: fileValidator,
    now: () => now,
    transport: {
      async open() {
        return new Response(new Uint8Array(bytes), {
          headers: { "content-type": "image/png" },
        });
      },
    },
  };
  return { db, context, bytes, service: fileService(context) };
}
test("file URL boundary rejects local/private literals, credentials, redirects and unapproved origins before transfer", async () => {
  for (const url of [
    "file:///etc/passwd",
    "http://files.example.com/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://169.254.169.254/a",
    "https://2130706433/a",
    "https://files.example.com.evil.com/a",
    "https://files.example.com:444/a",
    "https://user:password@files.example.com/a",
    "https://files.example.com/a#fragment",
    "https://files.example.com./a",
  ])
    assert.throws(() => approvedFileUrl(url, [fileOrigin]), FileError);
  assert.equal(
    approvedFileUrl(`${fileOrigin}/a?private=fixture`, [fileOrigin]).hostname,
    "files.example.com",
  );
  assert.throws(() => parseFileOrigins(`${fileOrigin}/`), FileError);
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  let cancelled = false;
  await assert.rejects(
    () =>
      fetchFile(input(), {
        origins: [fileOrigin],
        transport: {
          async open() {
            return new Response(
              new ReadableStream({
                cancel() {
                  cancelled = true;
                },
              }),
              { status: 302, headers: { location: "https://127.0.0.1" } },
            );
          },
        },
      }),
    /FILE_FETCH_FAILED/,
  );
  assert.equal(cancelled, true);
});
test("file reads bound actual streamed bytes and reject expired, broken and mismatched files without leaking URLs", async () => {
  const { context, service, db } = fixture();
  for (const status of [401, 403, 404, 410])
    await assert.rejects(
      () =>
        fetchFile(input(), {
          ...context,
          transport: {
            async open() {
              return new Response(null, { status });
            },
          },
        }),
      /FILE_EXPIRED/,
    );
  let cancelled = false;
  await assert.rejects(
    () =>
      fetchFile(input(), {
        ...context,
        transport: {
          async open() {
            return new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(new Uint8Array(fileLimits.bytes));
                  c.enqueue(new Uint8Array(1));
                },
                cancel() {
                  cancelled = true;
                },
              }),
            );
          },
        },
      }),
    /FILE_TOO_LARGE/,
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    () =>
      fetchFile(input(), {
        ...context,
        transport: {
          async open() {
            return new Response("x", {
              headers: { "content-length": String(fileLimits.bytes + 1) },
            });
          },
        },
      }),
    /FILE_TOO_LARGE/,
  );
  await assert.rejects(
    () =>
      fetchFile(input(), {
        ...context,
        transport: {
          async open() {
            throw new Error("secret URL or credential must not escape");
          },
        },
      }),
    /^FileError: FILE_FETCH_FAILED$/,
  );
  await assert.rejects(
    () =>
      service.ingest({ files: [{ ...input(), mime_type: "application/pdf" }] }),
    /FILE_INVALID/,
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM s00_files").get()?.n, 0);
  db.close();
});
test("content validation decodes PNG/JPEG and bounded plain PDF; rejects truncation, bad CRC, encryption, page and expansion hazards", async () => {
  for (const [bytes, mime] of [
    [pngFixture(), "image/png"],
    [jpegFixture(), "image/jpeg"],
    [await pdfFixture(), "application/pdf"],
  ] as const)
    assert.equal((await fileValidator.validate(bytes)).mime, mime);
  const badPng = pngFixture();
  badPng[badPng.length - 5] ^= 1;
  const bomb = pngFixture();
  new DataView(bomb.buffer).setUint32(16, 1_000_000);
  for (const bytes of [
    new Uint8Array([1, 2]),
    pngFixture().slice(0, 40),
    badPng,
    bomb,
    jpegFixture().slice(0, -2),
    await pdfFixture(11),
    new TextEncoder().encode("%PDF-1.7\n/Encrypt <<>>\n%%EOF"),
    new TextEncoder().encode("%PDF-1.7\n/Filter /FlateDecode\n%%EOF"),
  ])
    await assert.rejects(() => fileValidator.validate(bytes), FileError);
});
test("two files retain exact hashes, encrypt chunks, isolate owner/company, reject tampering and enforce atomic capacity", async () => {
  const { context, service, db, bytes } = fixture();
  const result = await service.ingest(batch);
  assert.equal(result.files.length, 2);
  assert.equal(result.fortnoxEnabled, false);
  for (const f of result.files) {
    assert.equal(f.sha256, await digest(bytes));
    assert.equal(f.bytes, bytes.length);
    assert.deepEqual(
      Buffer.from((await service.read(f.id)).blob, "base64"),
      Buffer.from(bytes),
    );
    for (const change of [
      { owner: "other-owner" },
      { company: "other-company" },
    ])
      await assert.rejects(
        () => fileService({ ...context, ...change }).read(f.id),
        /FILE_UNAVAILABLE/,
      );
  }
  const rows = db.prepare("SELECT data FROM s00_file_chunks").all();
  assert.ok(
    rows.every(
      (r) => !String(r.data).includes(Buffer.from(bytes).toString("base64")),
    ),
  );
  const limited = await Promise.allSettled([
    service.ingest(batch),
    service.ingest(batch),
  ]);
  assert.equal(limited.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM s00_files").get()?.n, 4);
  db.prepare("UPDATE s00_file_chunks SET data='invalid' WHERE file_id=?").run(
    result.files[0].id,
  );
  await assert.rejects(
    () => service.read(result.files[0].id),
    /FILE_UNAVAILABLE/,
  );
  await assert.rejects(
    () =>
      fileService({
        ...context,
        secret: "another-synthetic-secret-with-32-characters",
      }).read(result.files[1].id),
    /FILE_UNAVAILABLE/,
  );
  db.close();
});
test("failed second file removes the first staged file; expiry clears bytes and references cannot revive after SQLite restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "s00-files-"));
  const path = join(dir, "files.sqlite");
  let db = new DatabaseSync(path);
  const first = fixture(db);
  let calls = 0;
  await assert.rejects(
    () =>
      fileService({
        ...first.context,
        transport: {
          async open() {
            calls++;
            if (calls === 2) throw new Error("outage");
            return new Response(pngFixture());
          },
        },
      }).ingest(batch),
    /FILE_FETCH_FAILED/,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM s00_file_chunks").get()?.n,
    0,
  );
  const result = await first.service.ingest(batch);
  db.close();
  db = new DatabaseSync(path);
  const after = fixture(db);
  assert.equal(
    (await after.service.read(result.files[0].id)).sha256,
    result.files[0].sha256,
  );
  const expired = fileService({
    ...after.context,
    now: () => now + fileLimits.ttlMs,
  });
  await assert.rejects(
    () => expired.read(result.files[0].id),
    /FILE_UNAVAILABLE/,
  );
  await expired.cleanup();
  for (const table of ["s00_files", "s00_file_chunks"])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
  db.close();
  await rm(dir, { recursive: true, force: true });
});
test("pinned socket transport rejects private DNS before connecting and validates TLS host without forwarding credentials", async () => {
  let target = "",
    tlsHost = "",
    requestText = "";
  const bytes = pngFixture();
  const response = Buffer.concat([
    Buffer.from(
      `HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${bytes.length}\r\n\r\n`,
    ),
    bytes,
  ]);
  const makeSocket = (): FileSocket => ({
    opened: Promise.resolve({}),
    readable: new ReadableStream({
      start(c) {
        c.enqueue(response);
        c.close();
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        requestText += new TextDecoder().decode(chunk);
      },
    }),
    async close() {},
    startTls(options) {
      tlsHost = options.expectedServerHostname;
      return this;
    },
  });
  const transport = socketFileTransport({
    async resolve() {
      return ["8.8.8.8"];
    },
    connect(address) {
      target = address;
      return makeSocket();
    },
  });
  const result = await fetchFile(
    input(`${fileOrigin}/receipt?opaque=synthetic`),
    { origins: [fileOrigin], transport },
  );
  assert.deepEqual(result.bytes, bytes);
  assert.equal(target, "8.8.8.8");
  assert.equal(tlsHost, "files.example.com");
  assert.match(
    requestText,
    /^GET \/receipt\?opaque=synthetic HTTP\/1.1\r\nHost: files.example.com/,
  );
  assert.doesNotMatch(requestText, /authorization|cookie/i);
  let connected = false;
  const denied = socketFileTransport({
    async resolve() {
      return ["8.8.8.8", "::ffff:127.0.0.1"];
    },
    connect() {
      connected = true;
      return makeSocket();
    },
  });
  await assert.rejects(
    () => denied.open(new URL(fileOrigin), new AbortController().signal),
    /FILE_URL_DENIED/,
  );
  assert.equal(connected, false);
});
test("actual workerd/D1 stores encrypted files, isolates reads, persists through restart and cleans expired bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "s00-file-worker-"));
  const built = await build({
    entryPoints: ["test/file-worker.fixture.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    external: ["node:*"],
    write: false,
  });
  const script = built.outputFiles[0].text;
  const make = () =>
    new Miniflare(
      convertV4MiniflareOptions({
        name: "files-test",
        modules: true,
        script,
        compatibilityDate: "2026-10-18",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { DB: "00000000-0000-0000-0000-000000000123" },
        resourcePersistencePath: dir,
      }),
    );
  let mf = make();
  const db = await mf.getD1Database("DB");
  for (const sql of fileSchema.split(";").filter((s) => s.trim()))
    await db.prepare(sql).run();
  const call = async (path: string, extra: Record<string, unknown> = {}) => {
    const response = await mf.dispatchFetch(
      `https://fixture.example.com${path}`,
      {
        method: "POST",
        body: JSON.stringify({
          owner: "owner-a",
          company: "company-a",
          now,
          bytes: [...pngFixture()],
          ...extra,
        }),
      },
    );
    return (await response.json()) as {
      files: Array<{ id: string; sha256: string }>;
      sha256?: string;
      error?: string;
    };
  };
  try {
    const pdf = await pdfFixture();
    const padded = new Uint8Array(130 * 1024).fill(32);
    padded.set(pdf.slice(0, -5));
    padded.set(new TextEncoder().encode("%%EOF"), padded.length - 5);
    const result = await call("/ingest", {
      bytes: [...padded],
      mime: "application/pdf",
    });
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].sha256, await digest(padded));
    const id = result.files[0].id;
    assert.equal((await call("/read", { id })).sha256, result.files[0].sha256);
    assert.equal(
      (await call("/read", { id, company: "company-b" })).error,
      "FILE_UNAVAILABLE",
    );
    assert.equal(
      (await call("/read", { id, owner: "owner-b" })).error,
      "FILE_UNAVAILABLE",
    );
    await mf.dispose();
    mf = make();
    assert.equal((await call("/read", { id })).sha256, result.files[0].sha256);
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => call("/ingest")),
    );
    assert.equal(attempts.filter((r) => !r.error).length, 3);
    await call("/cleanup", { now: now + fileLimits.ttlMs });
    assert.equal((await call("/read", { id })).error, "FILE_UNAVAILABLE");
    const restored = await mf.getD1Database("DB");
    assert.equal(
      (
        await restored
          .prepare("SELECT count(*) AS n FROM s00_file_chunks")
          .first<{ n: number }>()
      )?.n,
      0,
    );
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("MCP file descriptors use complete host schemas, default off, scoped calls and authenticated resources", async () => {
  const f = fixture();
  const connect = async (enabled: boolean, authorized: boolean) => {
    const server = createProbeServer(
      undefined,
      enabled
        ? {
            context: f.context,
            origin: "https://probe.example.com",
            authorized,
          }
        : undefined,
    );
    const client = new Client({ name: "synthetic-files-test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    return {
      client,
      async close() {
        await client.close();
        await server.close();
      },
    };
  };
  const disabled = await connect(false, false);
  assert.ok(
    !(await disabled.client.listTools()).tools.some(
      (t) => t.name === "probe_synthetic_files",
    ),
  );
  await disabled.close();
  const denied = await connect(true, false);
  assert.equal(
    (
      await denied.client.callTool({
        name: "probe_synthetic_files",
        arguments: batch,
      })
    ).isError,
    true,
  );
  await denied.close();
  const allowed = await connect(true, true);
  try {
    const catalog = await allowed.client.listTools();
    const descriptor = catalog.tools.find(
      (t) => t.name === "probe_synthetic_files",
    );
    assert.deepEqual(descriptor?._meta?.["openai/fileParams"], ["files"]);
    const json = JSON.stringify(descriptor?.inputSchema);
    for (const name of ["download_url", "file_id", "mime_type", "file_name"])
      assert.ok(json.includes(name));
    const result = await allowed.client.callTool({
      name: "probe_synthetic_files",
      arguments: batch,
    });
    assert.notEqual(result.isError, true);
    assert.doesNotMatch(
      JSON.stringify(result),
      /download_url|synthetic-client-file/,
    );
    const data = result.structuredContent as {
      files: Array<{ id: string; uri: string; sha256: string }>;
    };
    const output = await allowed.client.readResource({
      uri: data.files[0].uri,
    });
    assert.ok("blob" in output.contents[0]);
    assert.deepEqual(
      Buffer.from(output.contents[0].blob as string, "base64"),
      Buffer.from(f.bytes),
    );
    const noScope = await connect(true, false);
    await assert.rejects(
      () => noScope.client.readResource({ uri: data.files[0].uri }),
      /FILE_SCOPE_REQUIRED/,
    );
    await noScope.close();
  } finally {
    await allowed.close();
    f.db.close();
  }
});

test("runtime byte budgets reject oversized ingress and stored output before decoding chunks", async () => {
  const f = fixture();
  try {
    const limited = fileService({ ...f.context, maxBytes: 16 });
    await assert.rejects(
      () => limited.ingest({ files: [input()] }),
      /FILE_TOO_LARGE/,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM s00_files").get()?.n,
      0,
    );
    const prepared = await f.service.ingest({ files: [input()] });
    assert.equal(
      await f.context.store.get(
        prepared.files[0].id,
        f.context.owner,
        f.context.company,
        now,
        16,
      ),
      null,
    );
    await assert.rejects(
      () => limited.read(prepared.files[0].id),
      /FILE_UNAVAILABLE/,
    );
  } finally {
    f.db.close();
  }
});

test("file download deadline aborts a stalled body without staging bytes", async () => {
  const f = fixture();
  let aborted = false,
    cancelled = false;
  try {
    const service = fileService({
      ...f.context,
      transport: {
        async open(_url, signal) {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
          );
        },
      },
    });
    await assert.rejects(
      () => service.ingest({ files: [input()] }),
      /FILE_TIMEOUT/,
    );
    assert.equal(aborted, true);
    assert.equal(cancelled, true);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM s00_files").get()?.n,
      0,
    );
  } finally {
    f.db.close();
  }
});
