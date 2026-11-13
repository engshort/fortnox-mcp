import { OpenItems, type StateStore } from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxOpenItems,
  type InvoiceHistoryVerification,
  openItemReadOperations,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { DocumentHttp } from "../../packages/fortnox/src/document-http.js";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";

export function invoiceHistoryContract(fixture: () => Promise<StateStore>) {
  describe("S08 historical invoice provider and ordinary read boundaries", () => {
    async function setup(ordinary = false) {
      const f = await accountingFixture(await fixture());
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes.push("invoice", "supplierinvoice");
        c.programs = {
          revision: 1,
          enabled: ["bookkeeping", "invoicing"],
          features: [
            "financial-analysis",
            "sales-invoices",
            "supplier-invoices",
          ],
        };
      });
      const flags = {
        verified: true,
        changed: false,
        missingMeta: false,
        currency: false,
        cancelled: false,
        writeOff: false,
        credit: false,
      };
      const requests: Request[] = [];
      let clock = Date.now();
      const now = () => clock;
      const provider = new FortnoxConnections({
        now,
        origin: "https://product.example.invalid",
        connections: f.connections,
        ...(ordinary ? {} : { testTenants: ["100001", "100002"] }),
        fetch: async (input) => {
          clock += 1000;
          const request = input as Request,
            url = new URL(request.url);
          requests.push(request);
          const payable = url.pathname.includes("supplierinvoice");
          const invoice = {
            [payable ? "GivenNumber" : "DocumentNumber"]: "1",
            Booked: true,
            Cancelled: flags.cancelled,
            InvoiceDate: "2025-12-01",
            DueDate: "2025-12-20",
            Currency: "SEK",
            Total: flags.credit ? "-1000.00" : "1000.00",
            Balance: "0.00",
          };
          if (url.pathname.endsWith("payments"))
            return Response.json({
              [payable ? "SupplierInvoicePayments" : "InvoicePayments"]: [
                {
                  Number: "1",
                  InvoiceNumber: "1",
                  Booked: true,
                  PaymentDate: "2025-12-31",
                  AmountCurrency: flags.credit ? "-200.00" : "200.00",
                  Currency: flags.currency ? "EUR" : "SEK",
                  WriteOffExist: false,
                  WriteOffs: [],
                },
                {
                  Number: "2",
                  InvoiceNumber: "1",
                  Booked: true,
                  PaymentDate: "2026-01-10",
                  AmountCurrency: flags.changed
                    ? "799.00"
                    : flags.credit
                      ? "-800.00"
                      : flags.writeOff
                        ? "750.00"
                        : "800.00",
                  Currency: "SEK",
                  WriteOffExist: flags.writeOff,
                  WriteOffs: flags.writeOff
                    ? [{ Amount: "50.00", Currency: "SEK" }]
                    : [],
                },
              ],
              ...(!flags.missingMeta
                ? {
                    MetaInformation: {
                      "@CurrentPage": 1,
                      "@TotalPages": 1,
                      "@TotalResources": 2,
                    },
                  }
                : {}),
            });
          if (url.pathname.endsWith("/1"))
            return Response.json({
              [payable ? "SupplierInvoice" : "Invoice"]: invoice,
            });
          return Response.json({
            [payable ? "SupplierInvoices" : "Invoices"]: [invoice],
            MetaInformation: {
              "@CurrentPage": 1,
              "@TotalPages": 1,
              "@TotalResources": 1,
            },
          });
        },
      });
      const verification: InvoiceHistoryVerification = {
        version: "synthetic/1",
        sha256: "e".repeat(64),
        invoice_currency_amounts: true,
        signed_credit_amounts: true,
        effective_dates: true,
        full_payment_history: true,
        immutable_terms: true,
      };
      const adapter = new FortnoxOpenItems(
        f.connections,
        provider,
        openItemReadOperations,
        () => true,
        now,
        () => (flags.verified ? verification : undefined),
      );
      const service = new OpenItems(
        f.connections,
        adapter,
        ["receivable", "payable"],
        now,
      );
      return { ...f, flags, requests, provider, adapter, service };
    }
    it("reconstructs both invoice kinds through MCP and keeps provider/current amounts separate", async () => {
      const f = await setup();
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider: f.provider,
        testMode: true,
        openItems: f.service,
      });
      const client = new Client({ name: "synthetic-history", version: "1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);
      try {
        for (const name of ["list_receivables", "list_payables"]) {
          const result = await client.callTool({
            name,
            arguments: { company_id: f.a.id, as_of: "2025-12-31" },
          });
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toMatchObject({
            status: "ok",
            data: {
              observation_point: "computed_as_of",
              as_of: "2025-12-31",
              collection_complete: true,
              complete: false,
              reconciliation: { status: "unavailable" },
              records: [
                {
                  balance: "0.00",
                  current_provider_balance: "0.00",
                  balance_as_of: "800.00",
                  overdue: true,
                },
              ],
            },
          });
        }
        expect(
          f.requests.every(
            (r) =>
              r.method === "GET" && !new URL(r.url).searchParams.has("filter"),
          ),
        ).toBe(true);
        const paymentRequests = f.requests.filter((r) =>
          new URL(r.url).pathname.endsWith("payments"),
        );
        expect(
          paymentRequests.every(
            (r) => new URL(r.url).searchParams.get("invoicenumber") === "1",
          ),
        ).toBe(true);
      } finally {
        await client.close();
        await server.close();
      }
    });
    it("handles signed credits and write-offs and withholds incomplete, foreign or conflicting payment histories", async () => {
      const f = await setup();
      const q = { company_id: f.a.id, kind: "receivable", as_of: "2025-12-31" };
      f.flags.credit = true;
      expect((await f.service.list(f.actor, q)).records[0]).toMatchObject({
        balance_as_of: "-800.00",
      });
      f.flags.credit = false;
      f.flags.writeOff = true;
      expect((await f.service.list(f.actor, q)).records[0]).toMatchObject({
        balance_as_of: "800.00",
      });
      for (const flag of [
        "verified",
        "missingMeta",
        "currency",
        "cancelled",
        "changed",
      ] as const) {
        f.flags.writeOff = false;
        f.flags[flag] = flag !== "verified";
        const result = await f.service.list(f.actor, q);
        expect(result.complete).toBe(false);
        expect(result.records[0]).toMatchObject({
          balance_as_of: null,
          open_status: "unknown",
        });
        f.flags[flag] = flag === "verified";
      }
    });
    it("retains company, feature and read-only boundaries in ordinary mode", async () => {
      const f = await setup(true);
      expect(
        (
          await f.service.list(f.actor, {
            company_id: f.a.id,
            kind: "receivable",
            as_of: "2025-12-31",
          })
        ).records[0],
      ).toMatchObject({ balance_as_of: "800.00" });
      const http = new DocumentHttp(
        f.connections,
        f.provider,
        openItemReadOperations,
        () => true,
      );
      const context = await http.context(
        f.actor,
        f.a.id,
        "open_receivable.list",
        "invoice",
      );
      const before = f.requests.length;
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.readOnly = true;
      });
      await expect(
        http.context(f.actor, f.a.id, "open_receivable.list", "invoice", true),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.tenant = "100002";
      });
      await expect(context.assertActive()).rejects.toThrow("COMPANY_FORBIDDEN");
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.tenant = "100001";
      });
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        if (c.programs) c.programs.features = [];
      });
      await expect(
        f.service.list(f.actor, { company_id: f.a.id, kind: "receivable" }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.requests).toHaveLength(before);
    });
  });
}
