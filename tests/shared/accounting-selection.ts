import {
  Bookkeeping,
  type StateStore,
  validateVoucher,
} from "@fortnox-mcp/core";
import { FortnoxAccounting, FortnoxConnections } from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";

async function selectionFixture(state: StateStore) {
  const f = await accountingFixture(state);
  let now = Date.now();
  let fault = "";
  const requests: Array<{
    path: string;
    year: string | null;
    token: string | null;
  }> = [];
  const provider = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const request = input as Request;
      const url = new URL(request.url);
      requests.push({
        path: url.pathname,
        year: url.searchParams.get("financialyear"),
        token: request.headers.get("authorization"),
      });
      now += 210;
      const match = /^\/3\/accounts\/(\d+)$/.exec(url.pathname);
      if (match) {
        if (fault === "budget") now += 16000;
        if (fault === "disconnect")
          await f.connections.disconnect(f.actor.ownerId, f.a.id);
        return Response.json({
          Account: {
            Number: Number(match[1]) + (fault === "wrong_account" ? 1 : 0),
            Active: true,
            Year: fault === "wrong_year" ? 8 : 7,
            CostCenterSettings: "ALLOWED",
            ProjectSettings: "NOTALLOWED",
            TransactionInformationSettings:
              fault === "unknown" ? 0 : "MANDATORY",
          },
          ...(fault === "oversize" ? { padding: "x".repeat(60000) } : {}),
        });
      }
      const payload: Record<string, unknown> = {
        "/3/financialyears": {
          FinancialYears: [
            { Id: 7, FromDate: "2025-07-01", ToDate: "2026-06-30" },
          ],
        },
        "/3/accounts": {
          Accounts: [
            {
              Number: 1930,
              Active: true,
              Year: 7,
              CostCenterSettings: "ALLOWED",
              ProjectSettings: "NOTALLOWED",
            },
          ],
        },
        "/3/voucherseries": {
          VoucherSeriesCollection: [{ Code: "A", Manual: true, Year: 7 }],
        },
        "/3/costcenters": { CostCenters: [] },
        "/3/projects": { Projects: [] },
        "/3/settings/lockedperiod": { LockedPeriod: { EndDate: "2025-12-31" } },
      };
      if (!payload[url.pathname])
        throw new Error("Unexpected synthetic operation");
      return Response.json({
        ...(payload[url.pathname] as object),
        MetaInformation: {
          "@CurrentPage": Number(url.searchParams.get("page") ?? 1),
          "@TotalPages": url.pathname === "/3/accounts" ? 6 : 1,
        },
      });
    },
  });
  const adapter = new FortnoxAccounting(
    f.connections,
    provider,
    f.gates,
    () => now,
  );
  return {
    ...f,
    provider,
    adapter,
    requests,
    service: new Bookkeeping(f.connections, adapter, f.gates, () => now),
    fault: (value: string) => {
      fault = value;
    },
    now: () => now,
  };
}

export function accountingSelectionContract(
  fixture: () => Promise<StateStore>,
) {
  it("selected account details are complete for their explicit scope, isolated by company and serialized through MCP", async () => {
    const f = await selectionFixture(await fixture());
    const catalog = await f.service.references(f.actor, f.a.id, 7);
    expect(catalog.complete).toBe(false);
    expect(catalog.accounts[0]?.information).toBe("UNKNOWN");
    const server = companyServer({
      identity: f.actor,
      connections: f.connections,
      provider: f.provider,
      testMode: true,
      bookkeeping: f.service,
    });
    const client = new Client({
      name: "synthetic-selected-accounts",
      version: "0",
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const tools = await client.listTools();
      expect(
        tools.tools.some(
          (tool) =>
            tool.name === "get_accounting_references" && tool.outputSchema,
        ),
      ).toBe(true);
      for (const company of [f.a, f.b]) {
        const before = f.requests.length;
        const result = await client.callTool({
          name: "get_accounting_references",
          arguments: {
            company_id: company.id,
            financial_year: 7,
            account_numbers: [4000, 1930],
          },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          company_id: company.id,
          data: {
            company_id: company.id,
            complete: true,
            validation_verified: false,
            account_numbers: [1930, 4000],
            accounts: [
              { number: 1930, information: "REQUIRED" },
              { number: 4000, information: "REQUIRED" },
            ],
          },
        });
        const calls = f.requests.slice(before);
        expect(
          calls
            .filter((r) => r.path.startsWith("/3/accounts"))
            .map((r) => r.path),
        ).toEqual(["/3/accounts/1930", "/3/accounts/4000"]);
        expect(
          calls.every(
            (r) =>
              r.token ===
              (company.id === f.a.id
                ? "Bearer synthetic-access-token"
                : "Bearer synthetic-token-B"),
          ),
        ).toBe(true);
        expect(
          calls
            .filter((r) => r.path.startsWith("/3/accounts/"))
            .every((r) => r.year === "7"),
        ).toBe(true);
      }
      const before = f.requests.length;
      for (const account_numbers of [
        [],
        [1930, 1930],
        ["1930"],
        Array.from({ length: 21 }, (_, i) => 1000 + i),
      ]) {
        const result = await client.callTool({
          name: "get_accounting_references",
          arguments: { company_id: f.a.id, financial_year: 7, account_numbers },
        });
        expect(result.isError).toBe(true);
      }
      expect(f.requests.length).toBe(before);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("account detail identity, year, current grant and disconnect are enforced before disclosure", async () => {
    const f = await selectionFixture(await fixture());
    for (const fault of ["wrong_account", "wrong_year"]) {
      f.fault(fault);
      await expect(
        f.service.references(f.actor, f.a.id, 7, [1930]),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
    }
    const before = f.requests.length;
    await expect(
      f.service.references(
        f.actor,
        "00000000-0000-4000-8000-000000000000",
        7,
        [1930],
      ),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    await expect(
      f.service.references({ ...f.actor, scopes: [] }, f.a.id, 7, [1930]),
    ).rejects.toThrow("AUTH_REQUIRED");
    expect(f.requests.length).toBe(before);
    f.fault("disconnect");
    await expect(
      f.service.references(f.actor, f.a.id, 7, [1930]),
    ).rejects.toThrow("CONNECTION_DISCONNECTED");
    expect(f.requests.at(-1)?.path).toBe("/3/accounts/1930");
  });
  it("selected detail time and aggregate size budgets return partial results without guessing missing rules", async () => {
    const f = await selectionFixture(await fixture());
    f.fault("budget");
    const timed = await f.service.references(f.actor, f.a.id, 7, [1930, 4000]);
    expect(timed.complete).toBe(false);
    expect(timed.accounts).toEqual([]);
    expect(timed.account_numbers).toEqual([1930, 4000]);
    f.fault("oversize");
    const sized = await f.service.references(
      f.actor,
      f.a.id,
      7,
      [1000, 1001, 1002, 1003, 1004],
    );
    expect(sized.complete).toBe(false);
    expect(sized.accounts).toHaveLength(4);
    f.fault("unknown");
    const unknown = await f.service.references(
      f.actor,
      f.a.id,
      7,
      [1930, 4000],
    );
    expect(unknown.complete).toBe(true);
    expect(unknown.accounts.every((a) => a.information === "UNKNOWN")).toBe(
      true,
    );
    expect(() =>
      validateVoucher(
        f.voucher,
        { ...unknown, validation_verified: true },
        f.now(),
      ),
    ).toThrow("VALIDATION_FAILED");
  });
  it("every validation, preparation and commit derives its account selection from the immutable voucher", async () => {
    const f = await accountingFixture(await fixture());
    const original = f.provider.references;
    const selections: Array<readonly number[] | undefined> = [];
    f.provider.references = async (actor, company, year, numbers) => {
      selections.push(numbers);
      return {
        ...(await original(actor, company, year)),
        account_numbers: numbers ? [...numbers] : undefined,
      };
    };
    await f.service.validate(f.actor, f.voucher);
    const proposal = await f.service.prepare(f.actor, f.voucher);
    await f.service.commit(
      f.actor,
      {
        company_id: f.a.id,
        proposal_id: proposal.proposal_id,
        proposal_hash: proposal.proposal_hash,
        capability: proposal.capability,
      },
      "review",
    );
    expect(selections).toEqual([
      [1930, 4000],
      [1930, 4000],
      [1930, 4000],
    ]);
    f.provider.references = async (actor, company, year) => ({
      ...(await original(actor, company, year)),
      account_numbers: [1930],
    });
    await expect(f.service.validate(f.actor, f.voucher)).rejects.toThrow(
      "COMPANY_FORBIDDEN",
    );
  });
}
