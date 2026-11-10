import {
  calculateFinancialReport,
  FinancialAnalysis,
  type FinancialQuery,
  type StateStore,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxFinancialReads,
  financialReadOperations,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";
import { syntheticSie } from "./analytics.js";

async function setup(state: StateStore) {
  const f = await accountingFixture(state);
  const requests: Array<{
    path: string;
    query: string;
    accept: string;
    method: string;
  }> = [];
  const flags = {
    active: true,
    changed: false,
    denied: false,
    noMeta: false,
    disconnect: false,
    wrongYear: false,
  };
  let exports = 0;
  const provider = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const req = input as Request,
        url = new URL(req.url);
      requests.push({
        path: url.pathname,
        query: url.search,
        accept: req.headers.get("accept") ?? "",
        method: req.method,
      });
      if (flags.denied)
        return Response.json(
          {
            ErrorInformation: { Message: "SYNTHETIC_PRIVATE_PROVIDER_MESSAGE" },
          },
          { status: 403 },
        );
      if (flags.disconnect)
        await f.connections.disconnect(f.actor.ownerId, f.a.id);
      if (url.pathname === "/3/financialyears/7")
        return Response.json({
          FinancialYear: {
            Id: flags.wrongYear ? 8 : 7,
            FromDate: "2025-07-01",
            ToDate: "2026-06-30",
          },
        });
      if (url.pathname === "/3/sie/4") {
        exports++;
        const text =
          flags.changed && exports > 1
            ? syntheticSie.replace("#UB 0 1930 1150", "#UB 0 1930 1151")
            : syntheticSie;
        return new Response(new TextEncoder().encode(text), {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      if (url.pathname === "/3/accounts/1930")
        return Response.json({
          Account: {
            Number: 1930,
            Description: "Synthetic bank",
            Active: true,
            Year: 7,
            BalanceBroughtForward: "1000.00",
            BalanceCarriedForward: "1150.00",
          },
        });
      if (url.pathname === "/3/accounts")
        return Response.json({
          Accounts: [
            {
              Number: 1930,
              Description: "Synthetic booked bank",
              Active: true,
              Year: 7,
              BalanceBroughtForward: "1000",
              BalanceCarriedForward: "1150",
            },
            {
              Number: 4000,
              Description: "Synthetic expense",
              Active: true,
              Year: 7,
              BalanceBroughtForward: "0",
              BalanceCarriedForward: "-150",
            },
            {
              Number: 9901,
              Description: "Synthetic custom inactive",
              Active: false,
              Year: 7,
              BalanceBroughtForward: "0",
              BalanceCarriedForward: "0",
            },
          ],
          ...(flags.noMeta
            ? {}
            : { MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 } }),
        });
      if (url.pathname === "/3/vouchers/A/1")
        return new Response(
          '{"Voucher":{"Year":7,"VoucherSeries":"A","VoucherNumber":1,"TransactionDate":"2025-08-01","VoucherRows":[{"Account":1930,"Debit":9007199254740993.01,"Credit":0,"Removed":false}]}}',
          { headers: { "content-type": "application/json" } },
        );
      return Response.json({}, { status: 404 });
    },
  });
  const adapter = new FortnoxFinancialReads(
    f.connections,
    provider,
    financialReadOperations,
    () => flags.active,
  );
  const query: FinancialQuery = {
    company_id: f.a.id,
    financial_year: 7,
    from: "2025-07-01",
    to: "2026-06-30",
  };
  return { ...f, provider, adapter, query, requests, flags };
}
export function financialReadContract(fixture: () => Promise<StateStore>) {
  describe("S08 finite account and SIE transport", () => {
    it("discovers chart pages with company/year/anchor binding and never calls the last continuation a complete collection", async () => {
      const f = await setup(await fixture());
      let changed = false,
        requests = 0,
        totalPages = 2,
        totalRecords = 2;
      f.provider.config.fetch = async (input) => {
        const url = new URL((input as Request).url),
          page = Number(url.searchParams.get("page"));
        requests++;
        return Response.json({
          Accounts: [
            {
              Number: page === 1 ? 1930 : 9901,
              Description:
                changed && page === 1 ? "Changed anchor" : "Synthetic chart",
              Active: page === 1,
              Year: 7,
              ...(page === 2
                ? { BalanceBroughtForward: "0", BalanceCarriedForward: "0" }
                : {}),
            },
          ],
          MetaInformation: {
            "@CurrentPage": page,
            "@TotalPages": totalPages,
            "@TotalResources": totalRecords,
          },
        });
      };
      const first = await f.adapter.accounts(f.actor, {
        company_id: f.a.id,
        financial_year: 7,
      });
      expect(first).toMatchObject({
        complete: false,
        coverage: "chart_records_only",
        records: [{ number: 1930, opening: null }],
        page: {
          number: 1,
          metadata_verified: true,
          exhausted: false,
          next: { next_page: 2 },
        },
      });
      const last = await f.adapter.accounts(f.actor, {
        company_id: f.a.id,
        financial_year: 7,
        continuation: first.page.next,
      });
      expect(last).toMatchObject({
        complete: false,
        records: [{ number: 9901, active: false, opening: "0.00" }],
        page: { number: 2, exhausted: true, next: null },
        consistency: "not_atomic",
        balance_units_verified: false,
      });
      expect(requests).toBe(4);
      const before = requests;
      await expect(
        f.adapter.accounts(f.actor, {
          company_id: f.a.id,
          financial_year: 8,
          continuation: first.page.next,
        }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
      expect(requests).toBe(before);
      changed = true;
      await expect(
        f.adapter.accounts(f.actor, {
          company_id: f.a.id,
          financial_year: 7,
          continuation: first.page.next,
        }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
      await expect(
        f.adapter.accounts(f.actor, {
          company_id: crypto.randomUUID(),
          financial_year: 7,
        }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      totalPages = 1;
      totalRecords = 99;
      expect(
        await f.adapter.accounts(f.actor, {
          company_id: f.a.id,
          financial_year: 7,
        }),
      ).toMatchObject({
        complete: false,
        page: { exhausted: true, total_records: 99 },
      });
    });
    it("exposes strict financial MCP reads with explicit partial results and exact voucher amounts", async () => {
      const f = await setup(await fixture());
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider: f.provider,
        testMode: true,
        financial: {
          service: new FinancialAnalysis(f.connections, f.adapter, true),
          provider: f.adapter,
        },
      });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({
        name: "synthetic-financial-client",
        version: "1",
      });
      await server.connect(st);
      await client.connect(ct);
      try {
        const catalog = (await client.listTools()).tools.filter((t) =>
          /^(get|list|compare)_financial_/.test(t.name),
        );
        expect(catalog.map((t) => t.name).sort()).toEqual([
          "compare_financial_periods",
          "get_financial_account",
          "get_financial_analysis",
          "get_financial_voucher",
          "list_financial_accounts",
          "list_financial_movements",
        ]);
        expect(
          catalog.every(
            (t) =>
              t.annotations?.readOnlyHint && !t.annotations.destructiveHint,
          ),
        ).toBe(true);
        expect(
          (
            await client.callTool({
              name: "compare_financial_periods",
              arguments: {
                company_id: f.a.id,
                left: { financial_year: 7, from: f.query.from, to: f.query.to },
                right: {
                  company_id: f.a.id,
                  financial_year: 7,
                  from: f.query.from,
                  to: f.query.to,
                },
                account_numbers: [1930, 4000],
              },
            })
          ).structuredContent,
        ).toMatchObject({
          status: "ok",
          data: {
            complete: false,
            consolidated: false,
            converted_currency: false,
            left: { company_id: f.a.id, complete: false },
            right: { company_id: f.a.id, complete: false },
          },
        });
        expect(
          (
            await client.callTool({
              name: "list_financial_accounts",
              arguments: { company_id: f.a.id, financial_year: 7 },
            })
          ).structuredContent,
        ).toMatchObject({
          status: "ok",
          data: {
            complete: true,
            coverage: "chart_records_only",
            records: [{ number: 1930 }, { number: 4000 }, { number: 9901 }],
            balance_units_verified: false,
            page: { number: 1, exhausted: true, next: null },
          },
        });
        const report = await client.callTool({
          name: "get_financial_analysis",
          arguments: f.query,
        });
        expect(report.structuredContent).toMatchObject({
          status: "ok",
          data: {
            complete: false,
            data_complete: false,
            accounts_page: { count: 3, exhausted: true },
            totals_scope: "entire_account_selection",
          },
        });
        const voucher = await client.callTool({
          name: "get_financial_voucher",
          arguments: {
            company_id: f.a.id,
            financial_year: 7,
            series: "A",
            number: 1,
          },
        });
        expect(voucher.structuredContent).toMatchObject({
          status: "ok",
          data: {
            rows: [{ debit: "9007199254740993.01" }],
            row_semantics_verified: false,
          },
        });
        const account = await client.callTool({
          name: "get_financial_account",
          arguments: {
            company_id: f.a.id,
            financial_year: 7,
            account_number: 1930,
          },
        });
        expect(account.structuredContent).toMatchObject({
          status: "ok",
          data: {
            complete: false,
            record: {
              number: 1930,
              opening: "1000.00",
              provider_closing: "1150.00",
            },
            balance_units_verified: false,
          },
        });
        const movements = await client.callTool({
          name: "list_financial_movements",
          arguments: { ...f.query, account_number: 1930, page_size: 1 },
        });
        expect(movements.structuredContent).toMatchObject({
          status: "ok",
          data: {
            complete: false,
            rows: [
              {
                account: 1930,
                amount: "250.00",
                voucher_ref: { financial_year: 7, series: "A", number: 1 },
              },
            ],
            page: { count: 1, exhausted: false },
          },
        });
        const count = f.requests.length;
        const denied = await client.callTool({
          name: "get_financial_analysis",
          arguments: { ...f.query, company_id: crypto.randomUUID() },
        });
        expect(denied.isError).toBe(true);
        const invalid = await client.callTool({
          name: "get_financial_analysis",
          arguments: { ...f.query, complete: true },
        });
        expect(invalid.isError).toBe(true);
        expect(f.requests).toHaveLength(count);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it("preserves chart balances, dimensions, inactive/custom accounts and separate source hashes", async () => {
      const f = await setup(await fixture());
      const basis = await f.adapter.basis(f.actor, f.query);
      expect(f.requests.every((r) => r.accept === "application/json")).toBe(
        true,
      );
      expect(basis.accounts.find((a) => a.number === 1930)).toMatchObject({
        opening: "1000.00",
        provider_closing: "1150.00",
        category: "unmapped",
      });
      expect(basis.accounts.find((a) => a.number === 9901)?.active).toBe(false);
      expect(basis.movements).toHaveLength(4);
      expect(basis.movements[2]?.dimensions).toEqual({ "1": "SYNTHETIC" });
      expect(basis.sources.map((s) => s.operation)).toEqual([
        "financial.year",
        "financial.sie4",
        "financial.accounts",
        "financial.sie4",
      ]);
      expect(basis.consistency).toBe("bounded_recheck");
      expect(basis.semantics_verified).toBe(false);
      const result = calculateFinancialReport(f.query, basis);
      expect(result.complete).toBe(false);
      expect(
        result.accounts.find((a) => a.number === 1930)?.period_movement,
      ).toBe("150.00");
      expect(
        f.requests
          .filter((r) => r.path === "/3/sie/4")
          .every((r) => r.query === "?financialyear=7"),
      ).toBe(true);
      expect(f.requests.every((r) => r.method === "GET")).toBe(true);
    });
    it("records concurrent changes and missing account pagination without claiming completeness", async () => {
      const f = await setup(await fixture());
      f.flags.changed = true;
      f.flags.noMeta = true;
      const result = await f.adapter.basis(f.actor, f.query);
      expect(result.consistency).toBe("changed");
      expect(result.coverage.accounts).toBe(false);
      expect(calculateFinancialReport(f.query, result).complete).toBe(false);
    });
    it("reads exact voucher money without using the stricter manual-write row profile", async () => {
      const f = await setup(await fixture());
      const result = await f.adapter.voucher(f.actor, f.a.id, 7, "A", 1);
      expect(result.rows[0]).toMatchObject({
        debit: "9007199254740993.01",
        credit: "0.00",
        removed: false,
      });
      expect(result.row_semantics_verified).toBe(false);
    });
    it("requires current company/program/test access and rejects a mismatching year", async () => {
      const f = await setup(await fixture());
      await expect(
        f.adapter.basis(f.actor, {
          ...f.query,
          company_id: crypto.randomUUID(),
        }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      f.flags.active = false;
      await expect(f.adapter.basis(f.actor, f.query)).rejects.toThrow();
      expect(f.requests).toHaveLength(0);
      f.flags.active = true;
      f.flags.wrongYear = true;
      await expect(f.adapter.basis(f.actor, f.query)).rejects.toThrow(
        "UPSTREAM_UNAVAILABLE",
      );
      expect(f.requests).toHaveLength(1);
    });
    it("denies provider rights and drops late disconnected source data", async () => {
      const f = await setup(await fixture());
      f.flags.denied = true;
      await expect(f.adapter.basis(f.actor, f.query)).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      f.flags.denied = false;
      f.flags.disconnect = true;
      await expect(f.adapter.basis(f.actor, f.query)).rejects.toThrow();
      expect(f.requests).toHaveLength(2);
    });
  });
}
