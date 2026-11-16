import {
  type OpenItemProvider,
  OpenItems,
  openItemProviderPage,
  type StateStore,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxOpenItems,
  openItemReadOperations,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";

async function setup(state: StateStore) {
  const f = await accountingFixture(state);
  for (const company of [f.a, f.b])
    await f.connections.mutate(f.actor.ownerId, company.id, (c) => {
      c.scopes.push("invoice", "supplierinvoice");
    });
  const requests: Request[] = [];
  const flags = {
    pages: 1,
    changed: false,
    denied: false,
    noMeta: false,
    disconnect: false,
    invalidMoney: false,
  };
  const provider = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const request = input as Request,
        url = new URL(request.url);
      requests.push(request);
      if (flags.denied)
        return Response.json(
          { ErrorInformation: { Message: "SYNTHETIC_PRIVATE_MESSAGE" } },
          { status: 403 },
        );
      if (flags.disconnect)
        await f.connections.disconnect(f.actor.ownerId, f.a.id);
      const page = Number(url.searchParams.get("page")),
        payable = url.pathname === "/3/supplierinvoices";
      const base = {
        InvoiceDate: "2026-01-01",
        DueDate: "2026-02-01",
        Currency: "SEK",
        Balance: flags.invalidMoney ? "0.001" : "0.10",
        Booked: true,
        Cancelled: false,
        Credit: payable ? false : "false",
        [payable ? "SupplierNumber" : "CustomerNumber"]: "SYNTHETIC",
      };
      const rows = [
        { ...base, [payable ? "GivenNumber" : "DocumentNumber"]: String(page) },
        {
          ...base,
          [payable ? "GivenNumber" : "DocumentNumber"]: "20",
          Balance: "0",
        },
        {
          ...base,
          [payable ? "GivenNumber" : "DocumentNumber"]: "21",
          Cancelled: true,
        },
        {
          ...base,
          [payable ? "GivenNumber" : "DocumentNumber"]: "22",
          Booked: false,
        },
        {
          ...base,
          [payable ? "GivenNumber" : "DocumentNumber"]: "23",
          Balance: null,
          DueDate: "",
        },
      ];
      if (flags.changed)
        rows[0] = { ...rows[0], Balance: "0.11" } as (typeof rows)[0];
      return Response.json({
        [payable ? "SupplierInvoices" : "Invoices"]: rows,
        ...(flags.noMeta
          ? {}
          : {
              MetaInformation: {
                "@CurrentPage": page,
                "@TotalPages": flags.pages,
                "@TotalResources": 5 * flags.pages,
              },
            }),
      });
    },
  });
  const adapter = new FortnoxOpenItems(
    f.connections,
    provider,
    openItemReadOperations,
    () => true,
  );
  const service = new OpenItems(f.connections, adapter, [
    "receivable",
    "payable",
  ]);
  return { ...f, requests, flags, provider, adapter, service };
}
export function openItemsContract(fixture: () => Promise<StateStore>) {
  describe("S08 current open invoice observations", () => {
    it("exposes strict focused MCP reads without historical status, currency conversion or unverified cash flow", async () => {
      const f = await setup(await fixture());
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider: f.provider,
        testMode: true,
        openItems: f.service,
      });
      const client = new Client({ name: "synthetic-open-items", version: "1" }),
        [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);
      try {
        const catalog = (await client.listTools()).tools.filter((t) =>
          ["list_receivables", "list_payables"].includes(t.name),
        );
        expect(catalog).toHaveLength(2);
        expect(catalog.every((t) => t.annotations?.readOnlyHint)).toBe(true);
        for (const name of ["list_receivables", "list_payables"]) {
          const result = (
            await client.callTool({ name, arguments: { company_id: f.a.id } })
          ).structuredContent;
          expect(result).toMatchObject({
            status: "ok",
            data: {
              complete: false,
              historical_status_supported: false,
              balance_semantics_verified: false,
              totals_scope: "returned_page_only",
              records: [
                { id: "1", balance: "0.10", expected_signed_cash_flow: null },
                { id: "23", balance: null, due_date: null },
              ],
              totals: [
                {
                  currency: "SEK",
                  provider_balance_sum: null,
                  expected_signed_cash_flow: null,
                },
              ],
              page: { source_record_count: 5 },
            },
          });
        }
        expect(
          f.requests.every(
            (r) =>
              r.method === "GET" && !new URL(r.url).searchParams.has("filter"),
          ),
        ).toBe(true);
        expect(JSON.stringify((await client.listTools()).tools)).not.toContain(
          "SYNTHETIC_PRIVATE_MESSAGE",
        );
      } finally {
        await client.close();
        await server.close();
      }
    });
    it("binds page continuation to company/kind/selection/source and never calls a final page a complete collection", async () => {
      const f = await setup(await fixture());
      f.flags.pages = 2;
      const query = { company_id: f.a.id, kind: "receivable" };
      const first = await f.service.list(f.actor, query);
      const last = await f.service.list(f.actor, {
        ...query,
        continuation: first.page.next,
      });
      expect(last).toMatchObject({
        complete: false,
        page: { number: 2, exhausted: true, next: null },
      });
      const count = f.requests.length;
      await expect(
        f.service.list(f.actor, {
          ...query,
          kind: "payable",
          continuation: first.page.next,
        }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
      expect(f.requests).toHaveLength(count);
      f.flags.changed = true;
      await expect(
        f.service.list(f.actor, { ...query, continuation: first.page.next }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
      f.flags.noMeta = true;
      expect(await f.service.list(f.actor, query)).toMatchObject({
        complete: false,
        page: { metadata_verified: false, exhausted: false },
      });
    });
    it("authorizes before source reads and discards missing rights and a late disconnect", async () => {
      const f = await setup(await fixture()),
        query = { company_id: f.a.id, kind: "receivable" };
      await expect(
        f.service.list({ ...f.actor, scopes: [] }, query),
      ).rejects.toThrow("AUTH_REQUIRED");
      await expect(
        f.service.list(f.actor, { ...query, company_id: crypto.randomUUID() }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      expect(f.requests).toHaveLength(0);
      await f.connections.setAccountingPolicy(
        f.actor.ownerId,
        f.a.id,
        2,
        "review_required",
        true,
      );
      expect((await f.service.list(f.actor, query)).records).toHaveLength(2);
      f.flags.denied = true;
      await expect(f.service.list(f.actor, query)).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      f.flags.denied = false;
      f.flags.invalidMoney = true;
      await expect(f.service.list(f.actor, query)).rejects.toThrow(
        "UPSTREAM_UNAVAILABLE",
      );
      f.flags.invalidMoney = false;
      f.flags.disconnect = true;
      await expect(f.service.list(f.actor, query)).rejects.toThrow();
    });
    it("computes exact page-only per-currency signed flows only from a trusted verified balance contract", async () => {
      const f = await setup(await fixture());
      const records = [
        {
          id: "1",
          counterparty_id: "SYNTHETIC",
          invoice_date: "2026-01-01",
          due_date: "2026-02-01",
          currency: "SEK",
          balance: "0.10",
          booked: true,
          cancelled: false,
          credit: false,
        },
        {
          id: "2",
          counterparty_id: "SYNTHETIC",
          invoice_date: "2026-01-01",
          due_date: "2026-02-01",
          currency: "SEK",
          balance: "0.20",
          booked: true,
          cancelled: false,
          credit: false,
        },
        {
          id: "3",
          counterparty_id: "SYNTHETIC",
          invoice_date: "2026-01-01",
          due_date: "2026-02-01",
          currency: "EUR",
          balance: "-0.10",
          booked: true,
          cancelled: false,
          credit: true,
        },
      ];
      const provider: OpenItemProvider = {
        page: async (_a, company, kind) =>
          openItemProviderPage.parse({
            company_id: company,
            kind,
            records,
            metadata_verified: true,
            exhausted: true,
            next_page: null,
            total_records: 3,
            source: {
              operation: "synthetic_verified_balance",
              record_id: "1",
              sha256: "a".repeat(64),
            },
            signed_balance_verified: true,
          }),
      };
      const service = new OpenItems(f.connections, provider, [
        "receivable",
        "payable",
      ]);
      const incoming = await service.list(f.actor, {
        company_id: f.a.id,
        kind: "receivable",
      });
      expect(incoming).toMatchObject({
        complete: true,
        totals: [
          { currency: "EUR", expected_signed_cash_flow: "-0.10" },
          { currency: "SEK", expected_signed_cash_flow: "0.30" },
        ],
      });
      const outgoing = await service.list(f.actor, {
        company_id: f.a.id,
        kind: "payable",
      });
      expect(outgoing.totals).toEqual([
        {
          currency: "EUR",
          provider_balance_sum: "-0.10",
          expected_signed_cash_flow: "0.10",
        },
        {
          currency: "SEK",
          provider_balance_sum: "0.30",
          expected_signed_cash_flow: "-0.30",
        },
      ]);
      records[0] = { ...records[0], balance: "NaN" } as (typeof records)[0];
      await expect(
        service.list(f.actor, { company_id: f.a.id, kind: "receivable" }),
      ).rejects.toThrow();
    });
  });
}
