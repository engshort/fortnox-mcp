import {
  type BusinessReference,
  type SalesDocumentProvider,
  type SalesDocumentRecord,
  SalesDocuments,
  type StateStore,
  salesOperationIds,
} from "@fortnox-mcp/core";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { syntheticReferences } from "./accounting.js";
import { registerFixture } from "./registers.js";

async function setup(
  state: StateStore,
  anonymous = false,
  enabled: readonly string[] = salesOperationIds,
) {
  const f = await registerFixture(state);
  for (const c of [f.a, f.b])
    await f.connections.mutate(f.actor.ownerId, c.id, (current) => {
      current.scopes.push("offer", "order", "invoice");
    });
  f.seed("customer", "C1", { Name: "Synthetic customer", Active: true });
  f.seed("currency", "SEK", { Description: "Synthetic currency" });
  f.seed("terms_of_payment", "30", { Description: "Synthetic payment terms" });
  const document: SalesDocumentRecord = {
    id: "1",
    version: "a".repeat(64),
    fields: {
      CustomerNumber: "C1",
      Currency: "SEK",
      VATIncluded: false,
      TermsOfPayment: "30",
      OfferDate: "2026-01-01",
      ExpireDate: "2026-01-31",
      NotCompleted: false,
    },
    rows: [
      {
        RowId: "11",
        Description: "Synthetic service",
        AccountNumber: 4000,
        Price: "0.10",
        VAT: "25",
        Quantity: "1",
      },
    ],
    complete: true,
    editable: true,
    observed: {
      cancelled: false,
      booked: false,
      sent: false,
      credit: false,
      order_reference: null,
      invoice_reference: null,
      credit_reference: null,
    },
  };
  let calls = 0;
  const provider: SalesDocumentProvider = {
    get: async (_actor, company) => {
      calls++;
      if (company !== f.a.id) throw new Error("synthetic document absent");
      return structuredClone(document);
    },
    page: async () => ({
      records: [
        {
          ...structuredClone(document),
          fields: { CustomerNumber: "C1" },
          rows: [],
          complete: false,
          editable: false,
          observed: { ...document.observed, sent: null },
        },
      ],
      complete: true,
      next_page: null,
    }),
    write: async (_actor, _company, _resource, _action, _input, before) => {
      await before();
      calls++;
      return { state: "succeeded", reference: "1" };
    },
  };
  const service = new SalesDocuments(
    f.connections,
    provider,
    f.service,
    { references: async (_actor, company) => syntheticReferences(company) },
    enabled,
    ["approved@example.invalid"],
  );
  const server = companyServer({
    identity: anonymous ? null : f.actor,
    connections: f.connections,
    provider: f.provider,
    testMode: true,
    salesDocuments: service,
  });
  const pair = InMemoryTransport.createLinkedPair(),
    client = new Client({ name: "synthetic-sales-client", version: "1" });
  await server.connect(pair[0]);
  await client.connect(pair[1]);
  return { ...f, client, server, calls: () => calls, service };
}
const close = async (f: Awaited<ReturnType<typeof setup>>) => {
  await f.client.close();
  await f.server.close();
};
export function salesMcpContract(fixture: () => Promise<StateStore>) {
  describe("focused sales MCP tools", () => {
    it("publishes strict separate effects and validates a real prepared update round trip", async () => {
      const f = await setup(await fixture());
      try {
        const tools = (await f.client.listTools()).tools;
        expect(
          tools.find((t) => t.name === "list_offers")?.annotations,
        ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
        expect(
          tools.find((t) => t.name === "prepare_offer_update")?.annotations,
        ).toMatchObject({ readOnlyHint: false, idempotentHint: false });
        expect(
          tools.find((t) => t.name === "email_invoice")?.annotations,
        ).toMatchObject({ readOnlyHint: false, openWorldHint: true });
        expect(
          tools.find((t) => t.name === "reconcile_invoice_email")?.annotations,
        ).toMatchObject({ readOnlyHint: false });
        expect(
          tools.some((t) => /eprint|einvoice|reminder|bank/.test(t.name)),
        ).toBe(false);
        const get = await f.client.callTool({
          name: "get_offer",
          arguments: { company_id: f.a.id, id: "1" },
        });
        expect(get.isError).not.toBe(true);
        const summary = await f.client.callTool({
          name: "list_offers",
          arguments: { company_id: f.a.id },
        });
        expect(summary.isError).not.toBe(true);
        expect(summary.structuredContent).toMatchObject({
          data: {
            complete: true,
            records: [{ complete: false, observed: { sent: null } }],
          },
        });
        const p = await f.client.callTool({
          name: "prepare_offer_update",
          arguments: {
            company_id: f.a.id,
            id: "1",
            financial_year: 7,
            fields: { Comments: "Synthetic MCP update" },
            rows: [{ RowId: "11" }],
            removed_row_ids: [],
          },
        });
        expect(p.isError).not.toBe(true);
        expect(p.structuredContent).toMatchObject({
          data: {
            preview: {
              intended_fields: { Comments: "Synthetic MCP update" },
              intended_rows: [{ RowId: "11" }],
              removed_row_ids: [],
            },
          },
        });
        const data = (p.structuredContent as { data: BusinessReference }).data;
        const ref = {
          company_id: data.company_id,
          proposal_id: data.proposal_id,
          proposal_hash: data.proposal_hash,
        };
        const executed = await f.client.callTool({
          name: "update_offer",
          arguments: ref,
        });
        expect(executed.structuredContent).toMatchObject({
          data: { state: "succeeded", reference: "1" },
        });
        const before = f.calls();
        const replay = await f.client.callTool({
          name: "update_offer",
          arguments: ref,
        });
        expect(replay.structuredContent).toMatchObject({
          data: { state: "succeeded" },
        });
        expect(f.calls()).toBe(before);
        const invalid = await f.client.callTool({
          name: "prepare_offer_create",
          arguments: {
            company_id: f.a.id,
            financial_year: 7,
            fields: { HTTPMethod: "POST" },
            rows: [],
            removed_row_ids: [],
          },
        });
        expect(invalid.isError).toBe(true);
        expect(f.calls()).toBe(before);
        const replaced = await f.client.callTool({
          name: "update_offer",
          arguments: {
            ...ref,
            fields: { Comments: "Synthetic substituted content" },
          },
        });
        expect(replaced.isError).toBe(true);
        expect(f.calls()).toBe(before);
      } finally {
        await close(f);
      }
    });
    it("keeps default-off and read-only catalogs bounded and enforces anonymous and foreign-company access", async () => {
      const off = await setup(await fixture(), false, []);
      try {
        expect(
          (await off.client.listTools()).tools.some(
            (t) => t.name === "get_offer",
          ),
        ).toBe(false);
      } finally {
        await close(off);
      }
      const read = await setup(await fixture(), false, [
        "offer.get",
        "offer.list",
      ]);
      try {
        const names = (await read.client.listTools()).tools.map((t) => t.name);
        expect(names).toContain("get_offer");
        expect(
          names.some(
            (n) => n.startsWith("prepare_offer") || n === "email_offer",
          ),
        ).toBe(false);
        const foreign = await read.client.callTool({
          name: "get_offer",
          arguments: { company_id: crypto.randomUUID(), id: "1" },
        });
        expect(foreign.structuredContent).toMatchObject({
          status: "error",
          error: { code: "COMPANY_FORBIDDEN" },
        });
        expect(read.calls()).toBe(0);
      } finally {
        await close(read);
      }
      const anonymous = await setup(await fixture(), true, ["offer.get"]);
      try {
        const r = await anonymous.client.callTool({
          name: "get_offer",
          arguments: { company_id: anonymous.a.id, id: "1" },
        });
        expect(r.structuredContent).toMatchObject({
          status: "error",
          error: { code: "AUTH_REQUIRED" },
        });
        expect(anonymous.calls()).toBe(0);
      } finally {
        await close(anonymous);
      }
    });
  });
}

export function documentReadProfileContract(
  fixture: () => Promise<
    import("../../apps/shared/product-auth.js").AuthConfig
  >,
) {
  it("isolates document read selection, rejects write activation and expires before MCP dispatch", async () => {
    const { createProductApplication } = await import(
      "../../apps/shared/product.js"
    );
    const { keyA } = await import("./connections.js");
    const config = await fixture();
    let now = Date.now(),
      calls = 0;
    const settings = {
      origin: config.origin,
      secret: config.secret,
      keys: { a: keyA },
      activeKey: "a",
      redirects: ["https://client.example.invalid/callback"],
      testMode: true,
      clientId: "",
      clientSecret: "",
      testTenants: ["100001", "100002"],
    };
    const profile = {
      sourceCommit: "1".repeat(40),
      until: now + 1000,
      operations: ["customer.get"] as const,
      documentReads: ["offer.list", "order.get"],
      now: () => now,
    };
    const upstream: typeof fetch = async () => {
      calls++;
      throw new Error("No provider call expected");
    };
    const app = createProductApplication(
      settings,
      config,
      upstream,
      undefined,
      profile,
    );
    const health = (await (
      await app.fetch(new Request(`${config.origin}/health`))
    ).json()) as {
      register_test: {
        document_operations: string[];
        financial_writes: boolean;
      };
    };
    expect(health.register_test.document_operations).toEqual([
      "offer.list",
      "order.get",
    ]);
    expect(health.register_test.financial_writes).toBe(false);
    expect(app.bookkeeping.gates.writes).toBe(false);
    expect(() =>
      createProductApplication(settings, config, upstream, undefined, {
        ...profile,
        documentReads: ["invoice.bookkeep"],
      }),
    ).toThrow("CAPABILITY_UNAVAILABLE");
    expect(() =>
      createProductApplication(settings, config, upstream, undefined, {
        ...profile,
        documentReads: ["offer.get", "offer.get"],
      }),
    ).toThrow("CAPABILITY_UNAVAILABLE");
    now += 1001;
    const denied = await app.fetch(
      new Request(`${config.origin}/mcp`, { method: "POST" }),
    );
    expect(denied.status).toBe(503);
    expect(await denied.json()).toEqual({ error: "BUSINESS_TEST_EXPIRED" });
    const ordinary = createProductApplication(settings, config, upstream);
    expect(
      await (
        await ordinary.fetch(new Request(`${config.origin}/health`))
      ).json(),
    ).not.toHaveProperty("register_test");
    expect(calls).toBe(0);
  });
}
