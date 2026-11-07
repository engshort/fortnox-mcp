import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readReceiptProviderAttachments } from "../../scripts/receipt-provider-acceptance-lib.mjs";
import { jpegFixture, pngFixture } from "../shared/receipt-fixtures.js";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
function fixture() {
  const bytes = [pngFixture(), jpegFixture()];
  const attachments = ids.map((company_id, index) => {
    const content = bytes[index];
    if (!content) throw new Error("fixture");
    return {
      company_id,
      file_id: `synthetic-file-${index}`,
      voucher: { financial_year: 7, series: "A", number: 1 },
      expectedSha256: createHash("sha256").update(content).digest("hex"),
      expectedBytes: content.length,
      expectedMime: index === 0 ? "image/png" : "image/jpeg",
    };
  });
  const config = {
    origin: "https://product.example.com",
    serverCommit: "a".repeat(40),
    accessToken: "SYNTHETIC-PRIVATE-TOKEN",
    companyIds: ids,
    attachments,
  };
  const resources = attachments.map((a, index) => ({
    uri: `receipt://attachments/${a.company_id}/${a.voucher.financial_year}/${a.voucher.series}/${a.voucher.number}/${a.file_id}`,
    mimeType: a.expectedMime,
    blob: Buffer.from(bytes[index] ?? []).toString("base64"),
  }));
  const calls: string[] = [];
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe(`${config.origin}/mcp`);
    expect(request.redirect).toBe("error");
    expect(request.headers.get("authorization")).toBe(
      `Bearer ${config.accessToken}`,
    );
    const body = (await request.json()) as {
      id: number;
      params: {
        name: string;
        arguments: { company_id?: string; file_id?: string };
      };
    };
    calls.push(body.params.name);
    const index = attachments.findIndex(
      (a) =>
        a.company_id === body.params.arguments.company_id &&
        a.file_id === body.params.arguments.file_id,
    );
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result:
        body.params.name === "list_companies"
          ? {
              structuredContent: {
                status: "ok",
                data: { companies: ids.map((company_id) => ({ company_id })) },
              },
            }
          : { content: [{ type: "resource", resource: resources[index] }] },
    });
  };
  return { config, resources, calls, send };
}
it("compares two companies' original resource bytes and returns only redacted readback counts", async () => {
  const f = fixture(),
    result = await readReceiptProviderAttachments(f.config, f.send);
  expect(f.calls).toEqual([
    "list_companies",
    "get_receipt_attachment",
    "get_receipt_attachment",
  ]);
  expect(result).toMatchObject({
    companies: 2,
    attachments: 2,
    bookkeepingOrFileMutationRequested: false,
    browserExecutedByThisScript: false,
    providerAcceptanceComplete: false,
  });
  expect(result.bytesCompared).toBe(
    f.config.attachments.reduce((sum, a) => sum + a.expectedBytes, 0),
  );
  for (const value of [
    ...ids,
    f.config.accessToken,
    "synthetic-file-",
    f.resources[0]?.blob ?? "unused",
  ])
    expect(JSON.stringify(result)).not.toContain(value);
});
it("rejects wrong company/file relationships, changed bytes, MIME and noncanonical base64", async () => {
  for (const mode of ["company", "file", "bytes", "mime", "base64"]) {
    const f = fixture(),
      r = f.resources[0];
    if (!r) throw new Error("fixture");
    if (mode === "company") r.uri = r.uri.replace(ids[0] ?? "", ids[1] ?? "");
    else if (mode === "file") r.uri += "-foreign";
    else if (mode === "mime") r.mimeType = "application/pdf";
    else if (mode === "base64") r.blob = "====";
    else r.blob = Buffer.from("synthetic-corrupt-bytes").toString("base64");
    await expect(
      readReceiptProviderAttachments(f.config, f.send),
    ).rejects.toThrow();
  }
});
it("handles a maximum-size canonical resource without unbounded parsing or regex recursion", async () => {
  const f = fixture(),
    r = f.resources[0],
    sample = f.config.attachments[0];
  if (!r || !sample) throw new Error("fixture");
  const bytes = Buffer.alloc(1048576, 7);
  r.blob = bytes.toString("base64");
  sample.expectedBytes = bytes.length;
  sample.expectedSha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await readReceiptProviderAttachments(f.config, f.send);
  expect(result.bytesCompared).toBe(
    1048576 + (f.config.attachments[1]?.expectedBytes ?? 0),
  );
});
it("refuses arbitrary URLs, unowned samples and incomplete/private malformed configurations before any request", async () => {
  const f = fixture();
  for (const config of [
    { ...f.config, provider_url: "https://foreign.example.com" },
    { ...f.config, companyIds: [ids[0], ids[0]] },
    { ...f.config, attachments: [f.config.attachments[0]] },
    { ...f.config, origin: "ftp://localhost" },
    { ...f.config, serverCommit: "0".repeat(40) },
    {
      ...f.config,
      attachments: f.config.attachments.map((a) => ({
        ...a,
        company_id: crypto.randomUUID(),
      })),
    },
  ])
    await expect(
      readReceiptProviderAttachments(config, f.send),
    ).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
it("rejects protocol/errors/redirects and bounds the encoded response before decoding", async () => {
  const f = fixture();
  let cancelled = false;
  const oversized: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(2097153));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  await expect(
    readReceiptProviderAttachments(f.config, oversized),
  ).rejects.toThrow("MCP response limit");
  expect(cancelled).toBe(true);
  for (const r of [
    new Response(null, { status: 302 }),
    Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        structuredContent: { privateData: "SYNTHETIC-PRIVATE" },
      },
    }),
    Response.json({ jsonrpc: "2.0", id: 9, result: {} }),
  ])
    await expect(
      readReceiptProviderAttachments(f.config, async () => r),
    ).rejects.toThrow();
});
it("the provider CLI requires explicit test confirmation and redacts malformed private configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-provider-read-"));
  try {
    const path = join(dir, "record.json"),
      secret = "SYNTHETIC-PRIVATE-ACCESS-TOKEN";
    writeFileSync(path, JSON.stringify({ accessToken: secret }), {
      mode: 0o600,
    });
    for (const confirmation of ["", "test-companies-only"]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/receipt-provider-acceptance.mjs"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            ACCEPTANCE_CONFIG: path,
            RECEIPT_ACCEPTANCE_CONFIRM: confirmation,
          },
          timeout: 5000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No private values emitted");
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
