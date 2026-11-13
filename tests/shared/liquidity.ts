import {
  FinancialAnalysis,
  LiquidityAnalysis,
  OpenItems,
  openItemProviderPage,
  type StateStore,
} from "@fortnox-mcp/core";
import { FortnoxConnections } from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";
import { syntheticFinancialBasis } from "./analytics.js";

async function setup(state: StateStore) {
  const f = await accountingFixture(state),
    now = () => Date.parse("2026-01-01T12:00:00Z");
  await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
    c.scopes.push("invoice", "supplierinvoice");
  });
  let calls = 0;
  const flags = {
    verified: true,
    foreign: false,
    unknown: false,
    disconnect: false,
  };
  const financial = new FinancialAnalysis(
    f.connections,
    {
      basis: async () => {
        calls++;
        return syntheticFinancialBasis(f.a.id);
      },
    },
    true,
  );
  const openItems = new OpenItems(
    f.connections,
    {
      page: async (_a, company, kind) => {
        calls++;
        if (flags.disconnect && kind === "payable")
          await f.connections.disconnect(f.actor.ownerId, f.a.id);
        const record = {
          id: "1",
          counterparty_id: "SYNTHETIC",
          invoice_date: "2026-01-01",
          due_date: "2026-01-02",
          currency: "SEK",
          balance: kind === "receivable" ? "300.10" : "100.20",
          booked: true,
          cancelled: false,
          credit: false,
        };
        const records = [record];
        if (flags.foreign)
          records.push({
            ...record,
            id: "2",
            currency: "EUR",
            balance: "9.00",
          });
        if (flags.unknown)
          records.push({
            ...record,
            id: "3",
            balance: null,
          } as unknown as typeof record);
        return openItemProviderPage.parse({
          company_id: company,
          kind,
          records,
          metadata_verified: true,
          exhausted: true,
          next_page: null,
          total_records: records.length,
          source: {
            operation: `synthetic_${kind}`,
            record_id: "1",
            sha256: "b".repeat(64),
          },
          signed_balance_verified: flags.verified,
        });
      },
    },
    ["receivable", "payable"],
    now,
  );
  const mapping = () => ({
    account_numbers: [1930],
    version: "synthetic-explicit-cash/1",
    sha256: "c".repeat(64),
  });
  const service = new LiquidityAnalysis(
    f.connections,
    financial,
    openItems,
    true,
    now,
    mapping,
  );
  const query = {
    company_id: f.a.id,
    financial_year: 7,
    as_of: "2026-01-01",
    cash_account_numbers: [1930],
    expected_from: "2026-01-01",
    expected_to: "2026-02-01",
    settlement_assumption: "due_date_only",
  };
  return {
    ...f,
    now,
    financial,
    openItems,
    service,
    query,
    flags,
    calls: () => calls,
  };
}
export function liquidityContract(fixture: () => Promise<StateStore>) {
  it("returns an exact source-backed selected liquidity projection through MCP with explicit settlement assumptions", async () => {
    const f = await setup(await fixture());
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async () => {
        throw Error("no provider transport expected");
      },
    });
    const server = companyServer({
      identity: f.actor,
      connections: f.connections,
      provider,
      testMode: true,
      liquidity: f.service,
    });
    const client = new Client({ name: "synthetic-liquidity", version: "1" }),
      [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === "get_liquidity_basis",
      );
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      const result = (
        await client.callTool({
          name: "get_liquidity_basis",
          arguments: f.query,
        })
      ).structuredContent;
      expect(result).toMatchObject({
        status: "ok",
        data: {
          complete: true,
          currency: "SEK",
          consistency: "not_atomic",
          settlement_assumption: "due_date_only",
          booked_balance: {
            amount: "1150.00",
            kind: "booked_ledger_not_live_bank",
            cash_classification_verified: true,
          },
          expected_flows: {
            receivables: { amount: "300.10", included_ids: ["1"] },
            payables: { amount: "-100.20" },
            net: "199.90",
          },
          projected_selected_balance: "1349.90",
          projection_scope: "selected_accounts_and_returned_invoice_pages",
        },
      });
      expect(f.calls()).toBe(3);
      await expect(
        f.service.basis(f.actor, { ...f.query, as_of: "2025-12-31" }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        f.service.basis(f.actor, { ...f.query, expected_to: "2027-01-01" }),
      ).rejects.toThrow();
      expect(f.calls()).toBe(3);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("preserves partial/currency/classification limits and authorizes all source scopes before any retrieval", async () => {
    const f = await setup(await fixture());
    const noMapping = new LiquidityAnalysis(
      f.connections,
      f.financial,
      f.openItems,
      true,
      f.now,
    );
    expect(await noMapping.basis(f.actor, f.query)).toMatchObject({
      complete: false,
      booked_balance: { cash_classification_verified: false },
      limitations: expect.arrayContaining([
        "cash_account_classification_unverified",
      ]),
    });
    f.flags.foreign = true;
    expect(await f.service.basis(f.actor, f.query)).toMatchObject({
      complete: false,
      currency_conversion: false,
      expected_flows: {
        receivables: { other_currency_count: 1, amount: "300.10" },
      },
      limitations: expect.arrayContaining(["other_currencies_not_converted"]),
    });
    f.flags.unknown = true;
    expect(await f.service.basis(f.actor, f.query)).toMatchObject({
      complete: false,
      expected_flows: { net: null },
      projected_selected_balance: null,
    });
    f.flags.unknown = false;
    f.flags.foreign = false;
    f.flags.verified = false;
    expect(await f.service.basis(f.actor, f.query)).toMatchObject({
      complete: false,
      expected_flows: { net: null },
      projected_selected_balance: null,
    });
    const before = f.calls();
    await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
      c.scopes = c.scopes.filter((s) => s !== "supplierinvoice");
    });
    await expect(f.service.basis(f.actor, f.query)).rejects.toThrow(
      "CAPABILITY_UNAVAILABLE",
    );
    expect(f.calls()).toBe(before);
    await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
      c.scopes.push("supplierinvoice");
    });
    f.flags.disconnect = true;
    await expect(f.service.basis(f.actor, f.query)).rejects.toThrow();
  });
}
