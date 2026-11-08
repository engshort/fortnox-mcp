import { ReceiptFiles } from "@fortnox-mcp/core";
import {
  fetchFile,
  fileValidator,
  receiptFileSource,
  receiptRelayTransport,
  receiptSourceSettings,
} from "@fortnox-mcp/files";
import { expect, it } from "vitest";
import { fileFixture, type ReceiptFixture } from "./receipt-files.js";
import { fileOrigin, jpegFixture, pngFixture } from "./receipt-fixtures.js";

const helper = "https://synthetic-receipt-helper.trycloudflare.com";
const token = "c".repeat(64);
const access = () => ({
  origin: helper,
  token,
  until: new Date(Date.now() + 60000).toISOString(),
});
export function receiptRelayContract(fixture: () => Promise<ReceiptFixture>) {
  it("stages two original files through an explicitly selected relay and preserves product owner/company encryption", async () => {
    const f = await fileFixture(await fixture());
    const settings = {
      transport: "node-relay" as const,
      origins: [fileOrigin],
      relay: access(),
    };
    const requests: Request[] = [];
    const source = receiptFileSource(
      settings,
      "worker",
      undefined,
      async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        expect(request.url).toBe(`${helper}/receipts/fetch`);
        expect(request.redirect).toBe("manual");
        expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(request.headers.has("cookie")).toBe(false);
        const body = (await request.json()) as Record<string, string>;
        expect(Object.keys(body)).toEqual(["download_url"]);
        const jpeg = new URL(body.download_url ?? "").pathname.endsWith("/b");
        return new Response(jpeg ? jpegFixture() : pngFixture(), {
          headers: { "content-type": jpeg ? "image/jpeg" : "image/png" },
        });
      },
    );
    const service = new ReceiptFiles(
      f.connections,
      f.service.store,
      source,
      fileValidator,
      true,
      f.now,
    );
    const result = await service.ingest(f.actor, f.a.id, [
      f.files[0],
      { ...f.files[1], mime_type: "image/jpeg" },
    ]);
    expect(requests).toHaveLength(2);
    for (const [index, file] of result.files.entries()) {
      const bytes = await service.read(f.actor, {
        company_id: f.a.id,
        workflow_id: result.workflow_id,
        file_id: file.file_id,
      });
      expect(bytes.bytes).toEqual(index === 0 ? pngFixture() : jpegFixture());
      bytes.bytes.fill(0);
    }
    await expect(
      service.ingest(f.actor, crypto.randomUUID(), f.files),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    expect(requests).toHaveLength(2);
    const raw = await f.raw();
    expect(raw).not.toContain("download_url");
    expect(raw).not.toContain(token);
  });
  it("never uses direct Worker fetch or automatically selects a relay, and refuses non-test source activation", async () => {
    const input = { download_url: `${fileOrigin}/a`, file_id: "synthetic" };
    let direct = 0,
      sent = 0;
    const directTransport = {
      async open() {
        direct++;
        return new Response(pngFixture());
      },
    };
    const send: typeof fetch = async () => {
      sent++;
      return new Response(pngFixture());
    };
    for (const transport of ["none", "node-direct"] as const) {
      const source = receiptFileSource(
        { transport, origins: [fileOrigin], relay: access() },
        "worker",
        directTransport,
        send,
      );
      await expect(source(input)).rejects.toThrow("FILE_TRANSPORT_UNAVAILABLE");
    }
    await expect(
      receiptFileSource(
        { transport: "node-relay", origins: [fileOrigin], relay: {} },
        "worker",
        directTransport,
        send,
      )(input),
    ).rejects.toThrow("FILE_TRANSPORT_UNAVAILABLE");
    expect({ direct, sent }).toEqual({ direct: 0, sent: 0 });
    expect(receiptSourceSettings({}, false).transport).toBe("none");
    for (const value of ["node-direct", "node-relay", "unknown"])
      expect(() =>
        receiptSourceSettings({ RECEIPT_FILE_TRANSPORT: value }, false),
      ).toThrow("FILE_TRANSPORT_UNAVAILABLE");
    expect(() =>
      receiptSourceSettings(
        { RECEIPT_FILE_ORIGINS: "https://*.example.com" },
        true,
      ),
    ).toThrow();
    const bytes = await receiptFileSource(
      { transport: "node-direct", origins: [fileOrigin], relay: {} },
      "node",
      directTransport,
    )(input);
    expect(bytes.bytes).toEqual(pngFixture());
    expect(direct).toBe(1);
  });
  it("rejects unsafe or expired helper configuration and redirects without forwarding source credentials", async () => {
    let sent = 0;
    const input = new URL(`${fileOrigin}/a?synthetic-private-source`);
    for (const config of [
      { ...access(), origin: "http://localhost" },
      { ...access(), origin: "https://foreign.example.com" },
      { ...access(), origin: `${helper}/extra` },
      { ...access(), token: "wrong" },
      { ...access(), until: new Date(Date.now() - 1).toISOString() },
      { ...access(), until: new Date(Date.now() + 16 * 60000).toISOString() },
    ]) {
      const transport = receiptRelayTransport(config, async () => {
        sent++;
        return new Response();
      });
      await expect(
        transport.open(input, new AbortController().signal),
      ).rejects.toThrow();
    }
    expect(sent).toBe(0);
    const redirect = receiptRelayTransport(access(), async () => {
      sent++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://foreign.example.com" },
      });
    });
    await expect(
      redirect.open(input, new AbortController().signal),
    ).rejects.toThrow("FILE_FETCH_FAILED");
    expect(sent).toBe(1);
  });
  it("cancels a late relay response and applies the same bounded binary pipeline to relayed bytes", async () => {
    let now = Date.now(),
      cancelled = false;
    const session = { ...access(), until: new Date(now + 60000).toISOString() };
    const transport = receiptRelayTransport(
      session,
      async () => {
        now += 120000;
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
      () => now,
    );
    await expect(
      transport.open(new URL(`${fileOrigin}/a`), new AbortController().signal),
    ).rejects.toThrow("FILE_TRANSPORT_UNAVAILABLE");
    expect(cancelled).toBe(true);
    const oversized = receiptRelayTransport(
      access(),
      async () => new Response(new Uint8Array(1024 * 1024 + 1)),
    );
    await expect(
      fetchFile(
        { download_url: `${fileOrigin}/a`, file_id: "synthetic" },
        { origins: [fileOrigin], transport: oversized },
      ),
    ).rejects.toThrow("FILE_TOO_LARGE");
  });
}
