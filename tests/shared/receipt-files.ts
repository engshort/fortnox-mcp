import {
  Connections,
  CredentialVault,
  fileDigest,
  type ReceiptFileStore,
  ReceiptFiles,
  receiptFileLimits,
  type StateStore,
} from "@fortnox-mcp/core";
import {
  approvedFileUrl,
  fetchFile,
  fileValidator,
  isPublicAddress,
} from "@fortnox-mcp/files";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { expect, it } from "vitest";
import { registerReceiptFiles } from "../../packages/mcp/src/receipt-files.js";
import { accountingFixture } from "./accounting.js";
import { keyA, keyB } from "./connections.js";
import {
  fileOrigin,
  jpegFixture,
  pdfFixture,
  pngFixture,
} from "./receipt-fixtures.js";

export interface ReceiptFixture {
  state: StateStore;
  files: ReceiptFileStore;
  raw: () => Promise<string>;
}
export async function fileFixture(input: ReceiptFixture) {
  const f = await accountingFixture(input.state);
  const actor = { ...f.actor, scopes: [...f.actor.scopes, "mcp:files"] };
  let now = Date.now();
  let calls = 0;
  let source = async (_url: URL) =>
    new Response(pngFixture(), { headers: { "content-type": "image/png" } });
  const transport = {
    open: async (url: URL) => {
      calls++;
      return source(url);
    },
  };
  const sourceFile = (file: Parameters<typeof fetchFile>[0]) =>
    fetchFile(file, { origins: [fileOrigin], transport });
  const service = new ReceiptFiles(
    f.connections,
    input.files,
    sourceFile,
    fileValidator,
    true,
    () => now,
  );
  const files = ["a", "b"].map((id) => ({
    download_url: `${fileOrigin}/${id}?synthetic-secret=do-not-retain`,
    file_id: `client-${id}`,
    file_name: "private-name.png",
    mime_type: "image/png",
  }));
  return {
    ...f,
    ...input,
    actor,
    files,
    service,
    sourceFile,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    calls: () => calls,
    source: (fn: typeof source) => {
      source = fn;
    },
  };
}
export function receiptFilesContract(fixture: () => Promise<ReceiptFixture>) {
  it("exposes complete host file descriptors only when enabled and returns authenticated original bytes through MCP", async () => {
    const f = await fileFixture(await fixture());
    const createServer = () =>
      new McpServer(
        { name: "synthetic-files", version: "0" },
        { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
      );
    const disabledServer = createServer();
    registerReceiptFiles(
      disabledServer,
      new ReceiptFiles(
        f.connections,
        f.service.store,
        f.sourceFile,
        fileValidator,
      ),
      f.actor,
    );
    const disabledClient = new Client({
      name: "synthetic-disabled-files",
      version: "0",
    });
    const [disabledA, disabledB] = InMemoryTransport.createLinkedPair();
    await disabledServer.connect(disabledA);
    await disabledClient.connect(disabledB);
    try {
      expect((await disabledClient.listTools()).tools).toHaveLength(0);
    } finally {
      await disabledClient.close();
      await disabledServer.close();
    }
    const server = createServer();
    registerReceiptFiles(server, f.service, f.actor);
    const client = new Client({ name: "synthetic-file-client", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const tools = (await client.listTools()).tools;
      const descriptor = tools.find((t) => t.name === "ingest_receipt_files");
      expect(descriptor?._meta?.["openai/fileParams"]).toEqual(["files"]);
      const schema = descriptor?.inputSchema.properties?.files as {
        items?: { properties?: unknown; required?: unknown };
      };
      expect(Object.keys(schema.items?.properties ?? {}).sort()).toEqual([
        "download_url",
        "file_id",
        "file_name",
        "mime_type",
      ]);
      expect(schema.items?.required).toEqual(["download_url", "file_id"]);
      const result = await client.callTool({
        name: "ingest_receipt_files",
        arguments: { company_id: f.a.id, files: f.files },
      });
      expect(result.isError).not.toBe(true);
      const view = result.structuredContent as {
        workflow_id: string;
        files: Array<{ file_id: string }>;
      };
      const uri = `receipt://files/${f.a.id}/${view.workflow_id}/${view.files[0]?.file_id}`;
      const output = await client.readResource({ uri });
      expect(output.contents[0]).toMatchObject({
        uri,
        mimeType: "image/png",
        blob: btoa(String.fromCharCode(...pngFixture())),
      });
      const foreign = await client.callTool({
        name: "read_receipt_file",
        arguments: {
          company_id: f.b.id,
          workflow_id: view.workflow_id,
          file_id: view.files[0]?.file_id,
        },
      });
      expect(foreign.isError).toBe(true);
      expect(JSON.stringify(foreign)).not.toContain("synthetic-secret");
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("rejects ciphertext, manifest and chunk-order tampering instead of returning partial plaintext", async () => {
    const f = await fileFixture(await fixture());
    const staged = await f.service.ingest(f.actor, f.a.id, f.files);
    const ref = {
      company_id: f.a.id,
      workflow_id: staged.workflow_id,
      file_id: staged.files[0]?.file_id as string,
    };
    for (const mutation of ["cipher", "manifest", "index"]) {
      const store = {
        ...f.service.store,
        get: async (id: string, owner: string, company: string) => {
          const value = await f.service.store.get(id, owner, company);
          if (!value) throw new Error("fixture");
          if (mutation === "manifest") value.record.mime = "image/jpeg";
          const chunk = value.chunks[0];
          if (!chunk) throw new Error("fixture");
          if (mutation === "cipher") chunk.data = "AAAA";
          if (mutation === "index") chunk.index = 1;
          return value;
        },
      };
      const service = new ReceiptFiles(
        f.connections,
        store,
        f.sourceFile,
        fileValidator,
        true,
      );
      await expect(service.read(f.actor, ref)).rejects.toThrow();
    }
  });

  it("round-trips two independently hashed files without source IDs, URLs, names or clear bytes in durable state", async () => {
    const f = await fileFixture(await fixture());
    f.source(async (url) =>
      url.pathname === "/b"
        ? new Response(jpegFixture(), {
            headers: { "content-type": "image/jpeg" },
          })
        : new Response(pngFixture()),
    );
    const inputs = f.files.map((x, i) => ({
      ...x,
      mime_type: i ? "image/jpeg" : "image/png",
    }));
    const staged = await f.service.ingest(f.actor, f.a.id, inputs);
    expect(staged.files).toHaveLength(2);
    for (const [i, file] of staged.files.entries()) {
      const read = await f.service.read(f.actor, {
        company_id: f.a.id,
        workflow_id: staged.workflow_id,
        file_id: file.file_id,
      });
      const expected = i ? jpegFixture() : pngFixture();
      expect(read.bytes).toEqual(expected);
      expect(file.sha256).toBe(await fileDigest(expected));
    }
    const raw = await f.raw();
    for (const secret of [
      "synthetic-secret",
      "private-name",
      "client-a",
      btoa(String.fromCharCode(...pngFixture())),
    ])
      expect(raw).not.toContain(secret);
  });
  it("requires owner, client, scope, company, generation, policy and exact workflow for reads", async () => {
    const f = await fileFixture(await fixture());
    const staged = await f.service.ingest(f.actor, f.a.id, f.files);
    const ref = {
      company_id: f.a.id,
      workflow_id: staged.workflow_id,
      file_id: staged.files[0]?.file_id as string,
    };
    for (const actor of [
      { ...f.actor, ownerId: "other" },
      { ...f.actor, clientId: "other" },
      { ...f.actor, scopes: ["mcp:read"] },
    ])
      await expect(f.service.read(actor, ref)).rejects.toThrow();
    await expect(
      f.service.read(f.actor, { ...ref, company_id: f.b.id }),
    ).rejects.toThrow();
    await expect(
      f.service.read(f.actor, { ...ref, workflow_id: crypto.randomUUID() }),
    ).rejects.toThrow();
    await f.connections.setAccountingPolicy(
      f.actor.ownerId,
      f.a.id,
      2,
      "review_required",
      false,
    );
    await expect(f.service.read(f.actor, ref)).rejects.toThrow(
      "COMPANY_FORBIDDEN",
    );
    await f.connections.disconnect(f.actor.ownerId, f.a.id);
    await expect(f.service.read(f.actor, ref)).rejects.toThrow(
      "CONNECTION_DISCONNECTED",
    );
  });
  it("rejects read-only staging and disabled ingress before any remote request", async () => {
    const f = await fileFixture(await fixture());
    await expect(f.service.ingest(f.actor, f.b.id, f.files)).rejects.toThrow(
      "CAPABILITY_UNAVAILABLE",
    );
    const disabled = new ReceiptFiles(
      f.connections,
      f.service.store,
      f.sourceFile,
      fileValidator,
    );
    await expect(disabled.ingest(f.actor, f.a.id, f.files)).rejects.toThrow(
      "CAPABILITY_UNAVAILABLE",
    );
    expect(f.calls()).toBe(0);
  });
  it("removes only its own workflow when the second file fails validation", async () => {
    const f = await fileFixture(await fixture());
    const good = await f.service.ingest(f.actor, f.a.id, [f.files[0]]);
    f.source(
      async (url) =>
        new Response(
          url.pathname === "/b" ? new Uint8Array([1, 2, 3]) : pngFixture(),
        ),
    );
    await expect(f.service.ingest(f.actor, f.a.id, f.files)).rejects.toThrow(
      "FILE_TYPE_UNSUPPORTED",
    );
    const raw = JSON.parse(await f.raw());
    expect(raw.files).toHaveLength(1);
    await expect(
      f.service.read(f.actor, {
        company_id: f.a.id,
        workflow_id: good.workflow_id,
        file_id: good.files[0]?.file_id as string,
      }),
    ).resolves.toBeDefined();
  });
  it("atomically enforces a durable four-file owner budget under competing ingestion", async () => {
    const f = await fileFixture(await fixture());
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        f.service.ingest(f.actor, f.a.id, f.files),
      ),
    );
    expect(results.some((r) => r.status === "rejected")).toBe(true);
    const raw = JSON.parse(await f.raw());
    expect(raw.files.length).toBeLessThanOrEqual(4);
    expect(raw.chunks.length).toBe(raw.files.length);
  });
  it("expires immediately on read and physically removes encrypted chunks during cleanup", async () => {
    const f = await fileFixture(await fixture());
    const staged = await f.service.ingest(f.actor, f.a.id, f.files);
    f.advance(receiptFileLimits.ttlMs);
    await expect(
      f.service.read(f.actor, {
        company_id: f.a.id,
        workflow_id: staged.workflow_id,
        file_id: staged.files[0]?.file_id as string,
      }),
    ).rejects.toThrow("FILE_EXPIRED");
    await f.service.store.cleanup(f.now());
    expect(JSON.parse(await f.raw())).toEqual({ files: [], chunks: [] });
  });
  it("fails closed with a wrong or unavailable credential key", async () => {
    const f = await fileFixture(await fixture());
    const staged = await f.service.ingest(f.actor, f.a.id, f.files);
    const wrong = new ReceiptFiles(
      new Connections(f.state, new CredentialVault({ a: keyB }, "a")),
      f.service.store,
      f.sourceFile,
      fileValidator,
      true,
    );
    await expect(
      wrong.read(f.actor, {
        company_id: f.a.id,
        workflow_id: staged.workflow_id,
        file_id: staged.files[0]?.file_id as string,
      }),
    ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    const rotated = new ReceiptFiles(
      new Connections(f.state, new CredentialVault({ a: keyA, b: keyB }, "b")),
      f.service.store,
      f.sourceFile,
      fileValidator,
      true,
    );
    // Old file key versions remain usable during a coordinated key rotation.
    await rotated.connections.rotateKey(f.actor.ownerId);
    expect(
      (
        await rotated.read(f.actor, {
          company_id: f.a.id,
          workflow_id: staged.workflow_id,
          file_id: staged.files[0]?.file_id as string,
        })
      ).bytes,
    ).toEqual(pngFixture());
  });
  it("cleans staged bytes if disconnect wins during the second fetch", async () => {
    const f = await fileFixture(await fixture());
    f.source(async (url) => {
      if (url.pathname === "/b")
        await f.connections.disconnect(f.actor.ownerId, f.a.id);
      return new Response(pngFixture());
    });
    await expect(f.service.ingest(f.actor, f.a.id, f.files)).rejects.toThrow(
      "CONNECTION_DISCONNECTED",
    );
    expect(JSON.parse(await f.raw())).toEqual({ files: [], chunks: [] });
  });
  it("decodes format content, rejects forged MIME, corrupt image, encrypted/unsupported PDF and page overflow", async () => {
    const f = await fileFixture(await fixture());
    expect(await fileValidator.validate(await pdfFixture())).toEqual({
      mime: "application/pdf",
      pages: 1,
    });
    await expect(fileValidator.validate(await pdfFixture(11))).rejects.toThrow(
      "FILE_INVALID",
    );
    await expect(
      fileValidator.validate(
        new TextEncoder().encode("%PDF-1.7\n/Encrypt\n%%EOF"),
      ),
    ).rejects.toThrow("FILE_ENCRYPTED");
    await expect(
      fileValidator.validate(
        new TextEncoder().encode("%PDF-1.7\n/JavaScript\n%%EOF"),
      ),
    ).rejects.toThrow("FILE_PDF_UNSUPPORTED");
    const bad = pngFixture();
    bad[bad.length - 1] = 0;
    await expect(fileValidator.validate(bad)).rejects.toThrow("FILE_INVALID");
    await expect(
      f.service.ingest(f.actor, f.a.id, [
        { ...f.files[0], mime_type: "application/pdf" },
      ]),
    ).rejects.toThrow("FILE_INVALID");
  });
  it("rejects private destinations, redirects, expired inputs and oversized bodies without retaining URLs", async () => {
    const f = await fileFixture(await fixture());
    for (const ip of [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "10.0.0.2",
      "169.254.169.254",
      "100.64.0.1",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    for (const url of [
      "http://files.example.com/x",
      "https://127.0.0.1/x",
      "https://metadata.internal/x",
      "https://files.example.com:8443/x",
      "https://user:pass@files.example.com/x",
    ])
      expect(() => approvedFileUrl(url, [fileOrigin])).toThrow(
        "FILE_URL_DENIED",
      );
    f.source(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1" },
        }),
    );
    await expect(f.service.ingest(f.actor, f.a.id, f.files)).rejects.toThrow(
      "FILE_FETCH_FAILED",
    );
    f.source(async () => new Response(null, { status: 410 }));
    await expect(f.service.ingest(f.actor, f.a.id, f.files)).rejects.toThrow(
      "FILE_EXPIRED",
    );
    f.source(
      async () => new Response(new Uint8Array(receiptFileLimits.bytes + 1)),
    );
    await expect(f.service.ingest(f.actor, f.a.id, f.files)).rejects.toThrow(
      "FILE_TOO_LARGE",
    );
    expect(JSON.parse(await f.raw())).toEqual({ files: [], chunks: [] });
  });
}
