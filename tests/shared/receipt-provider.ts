import {
  ReceiptAttachments,
  type ReceiptItemReference,
} from "@fortnox-mcp/core";
import { FortnoxConnections, FortnoxReceiptFiles } from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { expect, it } from "vitest";
import { registerReceiptAttachments } from "../../packages/mcp/src/receipt-attachments.js";
import { batchFixture, batchRef } from "./receipt-batches.js";
import type { ReceiptFixture } from "./receipt-files.js";
import { pngFixture } from "./receipt-fixtures.js";

export async function attachmentFixture(fixture: ReceiptFixture) {
  const f = await batchFixture(fixture);
  await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
    c.scopes.push("inbox", "connectfile");
  });
  const p = await f.receipts.prepare(f.actor, {
    company_id: f.a.id,
    items: f.items,
  });
  const first = p.items[0];
  if (!first?.proposal) throw new Error("fixture");
  const ref: ReceiptItemReference = { ...batchRef(p), item_id: first.item_id };
  let binaryStatuses: number[] = [];
  let disconnectUpload = false;
  let uploads = 0,
    links = 0,
    binaries = 0;
  let uploadStatus = 201,
    linkStatus = 201;
  let loseUpload = false,
    loseLink = false,
    wrongConnection = false,
    redirect = false;
  const files = new Map<string, Uint8Array>(),
    names = new Map<string, string>(),
    connections = new Map<
      string,
      {
        VoucherFileConnection: {
          FileId: string;
          VoucherYear: number;
          VoucherSeries: string;
          VoucherNumber: string;
        };
      }
    >();
  const requests: Array<{
    method: string;
    path: string;
    token: string | null;
  }> = [];
  const fortnox = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const request = input as Request,
        url = new URL(request.url);
      requests.push({
        method: request.method,
        path: url.pathname,
        token: request.headers.get("authorization"),
      });
      if (request.method === "POST" && url.pathname === "/3/inbox") {
        uploads++;
        expect(url.search).toBe("?path=Inbox_v");
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new Error("fixture multipart");
        const current = await f.connections.authorize(
          f.actor.ownerId,
          f.actor.clientId,
          f.a.id,
        );
        const idFromName = file.name.match(/^receipt-(.+)\.png$/)?.[1];
        const selected = current.receiptBatches
          ?.flatMap((b) => b.items)
          .find((i) => i.file.file_id === idFromName);
        expect(selected?.steps.upload.state).toBe("submitting");
        expect(file.type).toBe("image/png");
        expect(file.name).not.toContain("private-name");
        const bytes = new Uint8Array(await file.arrayBuffer());
        expect(bytes).toEqual(pngFixture());
        const id = `provider-file-${uploads}`;
        files.set(id, bytes);
        names.set(id, file.name);
        if (disconnectUpload)
          await f.connections.disconnect(f.actor.ownerId, f.a.id);
        if (loseUpload) throw new Error("synthetic lost upload answer");
        return Response.json(
          { File: { Id: id, Size: bytes.length } },
          { status: uploadStatus },
        );
      }
      if (request.method === "GET" && url.pathname === "/3/inbox") {
        return Response.json({
          Folder: {
            Name: "root",
            Files: [],
            Folders: [
              {
                Name: "Inbox_v",
                Folders: [],
                Files: [...files].map(([Id, bytes]) => ({
                  Id,
                  Name: names.get(Id),
                  Size: bytes.length,
                })),
              },
            ],
          },
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/3/voucherfileconnections"
      ) {
        links++;
        expect(url.searchParams.get("financialyear")).toBe("7");
        const body = (await request.json()) as {
          VoucherFileConnection: {
            FileId: string;
            VoucherNumber: string;
            VoucherSeries: string;
            VoucherYear: number;
          };
        };
        const current = await f.connections.authorize(
          f.actor.ownerId,
          f.actor.clientId,
          f.a.id,
        );
        const selected = current.receiptBatches
          ?.flatMap((b) => b.items)
          .find(
            (i) =>
              i.steps.upload.state === "succeeded" &&
              i.steps.upload.reference === body.VoucherFileConnection.FileId,
          );
        expect(selected?.steps.link.state).toBe("submitting");
        expect(body.VoucherFileConnection).toMatchObject({
          VoucherSeries: "A",
          VoucherYear: 7,
        });
        expect(body.VoucherFileConnection.VoucherNumber).toMatch(/^[1-9]\d*$/);
        const value = { VoucherFileConnection: body.VoucherFileConnection };
        if (linkStatus === 201)
          connections.set(body.VoucherFileConnection.FileId, value);
        if (loseLink) throw new Error("synthetic lost link answer");
        return Response.json(value, { status: linkStatus });
      }
      if (url.pathname.startsWith("/3/voucherfileconnections/")) {
        const id = url.pathname.split("/").at(-1) ?? "";
        const value = connections.get(id);
        if (wrongConnection && value)
          return Response.json({
            VoucherFileConnection: {
              ...value.VoucherFileConnection,
              VoucherYear: 99,
            },
          });
        return value
          ? Response.json(value)
          : Response.json({ ErrorInformation: { Code: 404 } }, { status: 404 });
      }
      if (url.pathname.startsWith("/3/inbox/")) {
        binaries++;
        const status = binaryStatuses.shift();
        if (status && status !== 200) return new Response(null, { status });
        if (redirect)
          return new Response(null, {
            status: 302,
            headers: { location: "https://foreign.example/file" },
          });
        const id = url.pathname.split("/").at(-1) ?? "";
        return new Response(new Uint8Array(files.get(id) ?? new Uint8Array()), {
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error("unregistered synthetic provider operation");
    },
  });
  const gates = {
    upload: true,
    link: true,
    connectionRead: true,
    inboxRead: true,
    formats: ["image/png"],
    rejectedWithoutEffect: {
      inbox_upload: [] as number[],
      voucher_file_link: [400],
    },
  };
  const adapter = new FortnoxReceiptFiles(
    f.connections,
    fortnox,
    f.provider,
    gates,
  );
  const attachments = new ReceiptAttachments(f.receipts, adapter, {
    upload: true,
    link: true,
    retrieve: true,
  });
  const book = async () =>
    f.receipts.bookkeeping.commit(
      f.actor,
      { ...first.proposal, capability: p.capabilities[first.item_id] },
      "review",
      () => f.receipts.guard(f.actor, ref),
    );
  return {
    ...f,
    p,
    ref,
    first,
    adapter,
    attachments,
    gates,
    requests,
    providerFiles: files,
    names,
    book,
    counts: () => ({ uploads, links, binaries }),
    mode: (input: {
      uploadStatus?: number;
      linkStatus?: number;
      loseUpload?: boolean;
      loseLink?: boolean;
      wrongConnection?: boolean;
      redirect?: boolean;
      binaryStatuses?: number[];
      disconnectUpload?: boolean;
    }) => {
      uploadStatus = input.uploadStatus ?? 201;
      linkStatus = input.linkStatus ?? 201;
      loseUpload = input.loseUpload ?? false;
      loseLink = input.loseLink ?? false;
      wrongConnection = input.wrongConnection ?? false;
      redirect = input.redirect ?? false;
      binaryStatuses = [...(input.binaryStatuses ?? [])];
      disconnectUpload = input.disconnectUpload ?? false;
    },
  };
}
export function receiptProviderContract(
  fixture: () => Promise<ReceiptFixture>,
) {
  for (const mode of ["json_body", "binary_body", "cancel"] as const) {
    it(`bounds uncooperative ${mode} while preserving the original upload`, async () => {
      const f = await attachmentFixture(await fixture());
      f.mode({ loseUpload: true });
      await f.attachments.upload(f.actor, f.ref);
      const fetch = f.adapter.provider.config.fetch;
      f.adapter.provider.config.fetch = async (input) => {
        const request = input as Request;
        const url = new URL(request.url);
        const root = url.pathname === "/3/inbox";
        if (
          request.method === "GET" &&
          ((mode === "json_body" && root) || (mode !== "json_body" && !root))
        ) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                if (mode === "cancel") controller.enqueue(pngFixture());
              },
              cancel() {
                return new Promise<void>(() => {});
              },
            }),
            {
              headers: {
                "content-type": root ? "application/json" : "image/png",
              },
            },
          );
        }
        return fetch(input);
      };
      await expect(
        f.attachments.reconcileUpload(f.actor, f.ref),
      ).rejects.toThrow("UPSTREAM_UNAVAILABLE");
      const c = await f.connections.authorize(
        f.actor.ownerId,
        f.actor.clientId,
        f.a.id,
      );
      expect(c.receiptBatches?.[0]?.items[0]?.steps.upload.state).toBe(
        "outcome_unknown",
      );
      expect(f.counts().uploads).toBe(1);
    }, 20000);
  }
  it("does not start a discovery GET after a permit consumes its deadline", async () => {
    const f = await attachmentFixture(await fixture());
    let clock = Date.now();
    const inspector = new FortnoxReceiptFiles(
      f.connections,
      f.adapter.provider,
      f.adapter.accounting,
      f.gates,
      () => clock,
    );
    inspector.http.permit = async () => {
      clock += 15001;
    };
    await expect(
      inspector.inspectUpload(f.actor, f.a.id, {
        fileId: f.first.file.file_id,
        sha256: f.first.sha256 as string,
      }),
    ).rejects.toThrow("UPSTREAM_UNAVAILABLE");
    expect(
      f.requests.filter((r) => r.method === "GET" && r.path === "/3/inbox"),
    ).toHaveLength(0);
  });
  it("bounds an uncooperative discovery fetch without retry or state promotion", async () => {
    const f = await attachmentFixture(await fixture());
    f.mode({ loseUpload: true });
    await f.attachments.upload(f.actor, f.ref);
    f.adapter.provider.config.fetch = async () =>
      new Promise<Response>(() => {});
    await expect(f.attachments.reconcileUpload(f.actor, f.ref)).rejects.toThrow(
      "UPSTREAM_UNAVAILABLE",
    );
    const c = await f.connections.authorize(
      f.actor.ownerId,
      f.actor.clientId,
      f.a.id,
    );
    expect(c.receiptBatches?.[0]?.items[0]?.steps.upload.state).toBe(
      "outcome_unknown",
    );
    expect(f.counts().uploads).toBe(1);
  }, 20000);
  it("never replaces an existing trusted reference with another matching file", async () => {
    const f = await attachmentFixture(await fixture());
    f.mode({ loseUpload: true });
    await f.attachments.upload(f.actor, f.ref);
    await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
      const item = c.receiptBatches?.[0]?.items[0];
      if (item)
        item.steps.upload = {
          state: "outcome_unknown",
          reference: "original-reference",
        };
    });
    expect(await f.attachments.reconcileUpload(f.actor, f.ref)).toEqual({
      state: "outcome_unknown",
      reference: "original-reference",
    });
    expect(f.counts().uploads).toBe(1);
  });
  it("positively reconciles the original upload across a policy change without restoring review or dispatching", async () => {
    const f = await attachmentFixture(await fixture());
    f.mode({ loseUpload: true });
    await f.attachments.upload(f.actor, f.ref);
    await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
      c.policyVersion++;
      c.readOnly = true;
      if (c.bookkeeping) c.bookkeeping.proposals = [];
    });
    await expect(f.receipts.item(f.actor, f.ref)).rejects.toThrow(
      "INTENT_CONFLICT",
    );
    expect(await f.attachments.reconcileUpload(f.actor, f.ref)).toEqual({
      state: "succeeded",
      reference: "provider-file-1",
    });
    expect(await f.attachments.reconcileUpload(f.actor, f.ref)).toEqual({
      state: "succeeded",
      reference: "provider-file-1",
    });
    const c = await f.connections.authorize(
      f.actor.ownerId,
      f.actor.clientId,
      f.a.id,
    );
    expect(c.receiptBatches?.[0]?.policy).not.toBe(c.policyVersion);
    expect(c.receiptBatches?.[0]?.items[0]?.steps.voucher.state).toBe(
      "pending",
    );
    expect(c.bookkeeping?.proposals).toHaveLength(0);
    expect(f.counts()).toEqual({ uploads: 1, links: 0, binaries: 1 });
    expect(f.bookings()).toBe(0);
  });
  it("rejects changed content, incomplete discovery and generation changes without changing the unknown upload", async () => {
    for (const mode of [
      "digest",
      "incomplete",
      "folder_page",
      "generation",
    ] as const) {
      const f = await attachmentFixture(await fixture());
      f.mode({ loseUpload: true });
      await f.attachments.upload(f.actor, f.ref);
      if (mode === "digest") {
        expect(
          await f.adapter.inspectUpload(f.actor, f.a.id, {
            fileId: f.first.file.file_id,
            sha256: "0".repeat(64),
          }),
        ).toBeNull();
      } else {
        const fetch = f.adapter.provider.config.fetch;
        f.adapter.provider.config.fetch = async (input) => {
          const request = input as Request;
          if (
            request.method === "GET" &&
            new URL(request.url).pathname === "/3/inbox"
          ) {
            if (mode === "incomplete")
              return Response.json({
                Folder: { Files: [], Folders: [] },
                MetaInformation: { TotalPages: 2 },
              });
            if (mode === "folder_page")
              return Response.json({
                Folder: { Files: [], Folders: [], NextPage: "hidden" },
              });
            await f.connections.disconnect(f.actor.ownerId, f.a.id);
          }
          return fetch(input);
        };
        await expect(
          f.attachments.reconcileUpload(f.actor, f.ref),
        ).rejects.toThrow();
      }
      const c = (await f.connections.list(f.actor.ownerId)).find(
        (c) => c.id === f.a.id,
      );
      expect(c?.receiptBatches?.[0]?.items[0]?.steps.upload.state).toBe(
        "outcome_unknown",
      );
      expect(c?.receiptBatches?.[0]?.items[0]?.attempts?.upload).toMatchObject({
        dispatched: true,
      });
      expect(f.counts().uploads).toBe(1);
      expect(f.bookings()).toBe(0);
    }
  });
  it("retains unknown for missing, ambiguous or changed candidate evidence and denies foreign clients", async () => {
    for (const mode of ["missing", "ambiguous", "renamed"] as const) {
      const f = await attachmentFixture(await fixture());
      f.mode({ loseUpload: true });
      await f.attachments.upload(f.actor, f.ref);
      if (mode === "missing") f.providerFiles.clear();
      if (mode === "renamed") f.names.set("provider-file-1", "unrelated.png");
      if (mode === "ambiguous") {
        f.providerFiles.set("copy", pngFixture());
        f.names.set("copy", f.names.get("provider-file-1") as string);
      }
      expect((await f.attachments.reconcileUpload(f.actor, f.ref)).state).toBe(
        "outcome_unknown",
      );
      await expect(
        f.attachments.reconcileUpload(
          { ...f.actor, clientId: "foreign" },
          f.ref,
        ),
      ).rejects.toThrow();
      expect(f.counts().uploads).toBe(1);
      expect(f.bookings()).toBe(0);
    }
  });
  it("performs one read-auth renewal and bounded GET retries without retrying a POST", async () => {
    const f = await attachmentFixture(await fixture());
    await f.attachments.upload(f.actor, f.ref);
    await f.book();
    await f.attachments.link(f.actor, f.ref);
    let rotations = 0;
    f.adapter.provider.token = async (_owner, _c, force = false) => {
      if (force) rotations++;
      return "synthetic-read-token";
    };
    f.mode({ binaryStatuses: [401, 500, 200] });
    const data = await f.attachments.retrieve(f.actor, {
      company_id: f.a.id,
      file_id: "provider-file-1",
      voucher: { financial_year: 7, series: "A", number: 1 },
    });
    expect(data.bytes).toEqual(pngFixture());
    expect(rotations).toBe(1);
    expect(f.counts()).toEqual({ uploads: 1, links: 1, binaries: 3 });
  });
  it("records a late upload ID as uncertain evidence without restoring a disconnected connection", async () => {
    const f = await attachmentFixture(await fixture());
    f.mode({ disconnectUpload: true });
    await expect(f.attachments.upload(f.actor, f.ref)).rejects.toThrow(
      "CONNECTION_DISCONNECTED",
    );
    const current = (await f.connections.list(f.actor.ownerId)).find(
      (c) => c.id === f.a.id,
    );
    expect(current?.state).toBe("disconnected");
    expect(current?.secret).toBeNull();
    expect(current?.generation).toBe(2);
    expect(current?.receiptBatches?.[0]?.items[0]?.steps.upload).toEqual({
      state: "outcome_unknown",
      reference: "provider-file-1",
      diagnostic: { stage: "authorization", http_status: 201 },
    });
    expect(f.counts().uploads).toBe(1);
  });

  it("returns original attachment bytes only through authenticated MCP tools/resources and keeps default-off operations out of discovery", async () => {
    const f = await attachmentFixture(await fixture());
    const server = new McpServer(
      { name: "synthetic-attachment-client", version: "0" },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    registerReceiptAttachments(server, f.attachments, f.actor);
    const client = new Client({ name: "synthetic-client", version: "0" }),
      [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const upload = await client.callTool({
        name: "upload_receipt_file",
        arguments: f.ref,
      });
      expect(upload.isError).not.toBe(true);
      await f.book();
      const link = await client.callTool({
        name: "link_receipt_attachment",
        arguments: f.ref,
      });
      expect(link.isError).not.toBe(true);
      const args = {
        company_id: f.a.id,
        file_id: "provider-file-1",
        voucher: { financial_year: 7, series: "A", number: 1 },
      };
      const result = await client.callTool({
        name: "get_receipt_attachment",
        arguments: args,
      });
      expect(result.isError).not.toBe(true);
      const uri = `receipt://attachments/${f.a.id}/7/A/1/provider-file-1`;
      const resource = await client.readResource({ uri });
      expect(resource.contents[0]).toMatchObject({
        uri,
        mimeType: "image/png",
        blob: btoa(String.fromCharCode(...pngFixture())),
      });
      expect(JSON.stringify(result)).not.toContain("private-name");
      expect(JSON.stringify(result)).not.toContain("Bearer");
    } finally {
      await client.close();
      await server.close();
    }
    const disabled = new McpServer({
      name: "synthetic-disabled-client",
      version: "0",
    });
    registerReceiptAttachments(
      disabled,
      new ReceiptAttachments(f.receipts, f.adapter, {
        upload: false,
        link: false,
        retrieve: false,
      }),
      f.actor,
    );
    const denied = new Client({ name: "synthetic-client", version: "0" }),
      [c, d] = InMemoryTransport.createLinkedPair();
    await disabled.connect(c);
    await denied.connect(d);
    try {
      expect((await denied.listTools()).tools).toHaveLength(0);
    } finally {
      await denied.close();
      await disabled.close();
    }
  });
  it("never interprets a 5xx or unverified 403 rejection as safe to resend", async () => {
    for (const status of [400, 403, 429, 500]) {
      const f = await attachmentFixture(await fixture());
      f.mode({ uploadStatus: status });
      expect(await f.attachments.upload(f.actor, f.ref)).toEqual({
        state: "outcome_unknown",
        diagnostic: { stage: "http_response", http_status: status },
      });
      f.mode({});
      expect((await f.attachments.upload(f.actor, f.ref)).state).toBe(
        "outcome_unknown",
      );
      expect(f.counts().uploads).toBe(1);
    }
  });

  it("uploads the exact multipart bytes, books once, links the saved references and retrieves only the owning voucher's attachment", async () => {
    const f = await attachmentFixture(await fixture());
    const upload = await f.attachments.upload(f.actor, f.ref);
    expect(upload.state).toBe("succeeded");
    expect((await f.book()).state).toBe("succeeded");
    expect((await f.attachments.link(f.actor, f.ref)).state).toBe("succeeded");
    const read = await f.attachments.retrieve(f.actor, {
      company_id: f.a.id,
      file_id: "provider-file-1",
      voucher: { financial_year: 7, series: "A", number: 1 },
    });
    expect(read.bytes).toEqual(pngFixture());
    expect(f.counts()).toEqual({ uploads: 1, links: 1, binaries: 1 });
    expect((await f.attachments.upload(f.actor, f.ref)).state).toBe(
      "succeeded",
    );
    expect(f.counts().uploads).toBe(1);
    await f.attachments.link(f.actor, f.ref);
    expect(f.counts().links).toBe(1);
    expect(f.bookings()).toBe(1);
    expect(
      (await f.receipts.view(f.actor, batchRef(f.p))).items[0]?.state,
    ).toBe("completed");
  });
  it("keeps a successful voucher and upload when linking fails and repairs only a proven-not-applied link", async () => {
    const f = await attachmentFixture(await fixture());
    await f.attachments.upload(f.actor, f.ref);
    await f.book();
    f.mode({ linkStatus: 400 });
    expect(await f.attachments.link(f.actor, f.ref)).toEqual({
      state: "failed",
      code: "HTTP_400",
    });
    expect(f.bookings()).toBe(1);
    const partial = await f.receipts.view(f.actor, batchRef(f.p));
    expect(partial.items[0]?.state).toBe("partial");
    expect(partial.items[0]?.next_action).toBe("repair_link_only");
    expect(partial.items[0]?.steps.voucher.state).toBe("succeeded");
    f.mode({});
    expect((await f.attachments.link(f.actor, f.ref)).state).toBe("succeeded");
    expect(f.counts()).toEqual({ uploads: 1, links: 2, binaries: 0 });
    expect(f.bookings()).toBe(1);
  });
  it("never blindly resends a lost upload answer, a lost link answer or an unclassified rejection", async () => {
    const f = await attachmentFixture(await fixture());
    f.mode({ loseUpload: true });
    expect((await f.attachments.upload(f.actor, f.ref)).state).toBe(
      "outcome_unknown",
    );
    f.mode({});
    expect((await f.attachments.upload(f.actor, f.ref)).state).toBe(
      "outcome_unknown",
    );
    expect(f.counts().uploads).toBe(1);
    const other = await attachmentFixture(await fixture());
    await other.attachments.upload(other.actor, other.ref);
    await other.book();
    other.mode({ loseLink: true });
    expect((await other.attachments.link(other.actor, other.ref)).state).toBe(
      "outcome_unknown",
    );
    other.mode({});
    expect((await other.attachments.link(other.actor, other.ref)).state).toBe(
      "outcome_unknown",
    );
    expect(other.counts().links).toBe(1);
    expect(
      (await other.attachments.reconcileLink(other.actor, other.ref)).state,
    ).toBe("succeeded");
    expect(other.counts().links).toBe(1);
  });
  it("claims concurrent uploads once in durable storage and rejects scopes/read-only/foreign IDs before dispatch", async () => {
    const f = await attachmentFixture(await fixture());
    await Promise.allSettled([
      f.attachments.upload(f.actor, f.ref),
      f.attachments.upload(f.actor, f.ref),
    ]);
    expect(f.counts().uploads).toBe(1);
    const calls = f.requests.length;
    await expect(
      f.attachments.retrieve(
        { ...f.actor, scopes: ["mcp:read"] },
        {
          company_id: f.a.id,
          file_id: "provider-file-1",
          voucher: { financial_year: 7, series: "A", number: 1 },
        },
      ),
    ).rejects.toThrow("AUTH_REQUIRED");
    expect(f.requests).toHaveLength(calls);
    await expect(
      f.attachments.link(f.actor, { ...f.ref, company_id: f.b.id }),
    ).rejects.toThrow();
    await expect(
      f.attachments.retrieve(f.actor, {
        company_id: f.a.id,
        file_id: "../private",
        voucher: { financial_year: 7, series: "A", number: 1 },
      }),
    ).rejects.toThrow();
  });
  it("refuses unrelated relationships and redirects before returning any bytes", async () => {
    const f = await attachmentFixture(await fixture());
    await f.attachments.upload(f.actor, f.ref);
    await f.book();
    await f.attachments.link(f.actor, f.ref);
    const ref = {
      company_id: f.a.id,
      file_id: "provider-file-1",
      voucher: { financial_year: 7, series: "A", number: 1 },
    };
    f.mode({ wrongConnection: true });
    await expect(f.attachments.retrieve(f.actor, ref)).rejects.toThrow(
      "COMPANY_FORBIDDEN",
    );
    expect(f.counts().binaries).toBe(0);
    f.mode({ redirect: true });
    await expect(f.attachments.retrieve(f.actor, ref)).rejects.toThrow(
      "UPSTREAM_UNAVAILABLE",
    );
    expect(f.counts().binaries).toBe(1);
  });
  it("keeps each provider operation default-off and requires the actual provider scope and format evidence", async () => {
    const f = await attachmentFixture(await fixture());
    f.gates.upload = false;
    expect((await f.attachments.upload(f.actor, f.ref)).state).toBe("failed");
    expect(f.requests).toHaveLength(0);
    f.gates.upload = true;
    f.gates.formats = [];
    expect((await f.attachments.upload(f.actor, f.ref)).state).toBe("failed");
    expect(f.requests).toHaveLength(0);
    f.gates.formats = ["image/png"];
    await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
      c.scopes = c.scopes.filter((s) => s !== "inbox");
    });
    expect((await f.attachments.upload(f.actor, f.ref)).state).toBe("failed");
    expect(f.requests).toHaveLength(0);
  });
}
