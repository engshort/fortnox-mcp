import { Bookkeeping, type StateStore } from "@fortnox-mcp/core";
import {
  FortnoxAccounting,
  FortnoxConnections,
  parseExactProviderJson,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";

export function accountingTransportContract(
  fixture: () => Promise<StateStore>,
) {
  it("numeric provider amounts retain exact JSON lexemes beyond IEEE-754 cents without altering strings", () => {
    const quote = 'amount 123.45 "unchanged"';
    const text =
      '{"amount":123456789012.34,"negative":-0.10,"nested":[0.20,true,null],"quote":' +
      JSON.stringify(quote) +
      "}";
    expect(parseExactProviderJson(text)).toEqual({
      amount: "123456789012.34",
      negative: "-0.10",
      nested: ["0.20", true, null],
      quote,
    });
    expect(() => parseExactProviderJson('{"amount":01}')).toThrow();
    expect(() => parseExactProviderJson('{"amount":NaN}')).toThrow();
  });
  it("MCP strictly isolates UI capability, marks proposal persistence as a mutation and prevents model self-approval", async () => {
    const f = await accountingFixture(await fixture());
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async () => {
        throw new Error("No live I/O");
      },
    });
    const server = companyServer({
      identity: f.actor,
      connections: f.connections,
      provider,
      testMode: false,
      bookkeeping: f.service,
    });
    const client = new Client({ name: "synthetic-review-host", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const catalog = (await client.listTools()).tools;
      expect(
        catalog.find((t) => t.name === "prepare_manual_vouchers")?.annotations
          ?.readOnlyHint,
      ).toBe(false);
      const commitTool = catalog.find(
        (t) => t.name === "commit_reviewed_vouchers",
      );
      expect(commitTool?._meta?.ui).toEqual({ visibility: ["app"] });
      const prepared = await client.callTool({
        name: "prepare_manual_vouchers",
        arguments: f.voucher,
      });
      const secret = prepared._meta?.voucherReview as { capability: string };
      expect(secret.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(JSON.stringify(prepared.content)).not.toContain(secret.capability);
      expect(JSON.stringify(prepared.structuredContent)).not.toContain(
        secret.capability,
      );
      const data = (
        prepared.structuredContent as {
          data: {
            company_id: string;
            proposal_id: string;
            proposal_hash: string;
          };
        }
      ).data;
      const ref = {
        company_id: data.company_id,
        proposal_id: data.proposal_id,
        proposal_hash: data.proposal_hash,
      };
      const reread = await client.callTool({
        name: "get_voucher_proposal",
        arguments: ref,
      });
      expect(JSON.stringify(reread)).not.toContain(secret.capability);
      const forged = await client.callTool({
        name: "commit_reviewed_vouchers",
        arguments: { ...ref, confirmed: true },
      });
      expect(forged.isError).toBe(true);
      expect(f.calls()).toBe(0);
      const resource = await client.readResource({
        uri: "ui://fortnox/voucher-review-v1.html",
      });
      expect(JSON.stringify(resource)).not.toContain(secret.capability);
      expect(JSON.stringify(resource)).toContain("Content-Security-Policy");
      const committed = await client.callTool({
        name: "commit_reviewed_vouchers",
        arguments: { ...ref, capability: secret.capability },
      });
      expect(committed.isError).not.toBe(true);
      expect(f.calls()).toBe(1);
      const repeat = await client.callTool({
        name: "commit_reviewed_vouchers",
        arguments: { ...ref, capability: secret.capability },
      });
      expect(repeat.isError).toBe(true);
      expect(f.calls()).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("default activation omits all accounting tools and an unverified write gate omits both execution paths", async () => {
    const f = await accountingFixture(await fixture());
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: [],
      fetch: async () => {
        throw new Error("No live I/O");
      },
    });
    for (const references of [false, true]) {
      const service = new Bookkeeping(f.connections, f.provider, {
        references,
        writes: false,
        reviewHost: false,
      });
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider,
        testMode: false,
        bookkeeping: service,
      });
      const client = new Client({ name: "synthetic-client", version: "0" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      await client.connect(b);
      try {
        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names.includes("get_accounting_references")).toBe(references);
        expect(names).not.toContain("commit_reviewed_vouchers");
        expect(names).not.toContain("create_manual_voucher");
      } finally {
        await client.close();
        await server.close();
      }
    }
  });
  it("reference transport bounds pages, preserves explicit company/year and blocks incomplete data from validation", async () => {
    const f = await accountingFixture(await fixture());
    let totalPages = 1;
    let wrongYear = false;
    const urls: string[] = [];
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async (input) => {
        const request = input as Request;
        const u = new URL(request.url);
        urls.push(u.href);
        expect(u.origin).toBe("https://api.fortnox.se");
        expect(u.searchParams.get("financialyear")).toBe("7");
        expect(request.redirect).toBe("manual");
        const meta = {
          CurrentPage: Number(u.searchParams.get("page")),
          TotalPages: u.pathname === "/3/accounts" ? totalPages : 1,
        };
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
                Year: wrongYear ? 8 : 7,
                CostCenterSettings: "ALLOWED",
                ProjectSettings: "ALLOWED",
                TransactionInformationSettings: "ALLOWED",
              },
            ],
          },
          "/3/voucherseries": {
            VoucherSeries: [{ Code: "A", Manual: true, Year: 7 }],
          },
          "/3/costcenters": { CostCenters: [] },
          "/3/projects": {
            Projects: [{ ProjectNumber: "PROJECT_A", Status: "ONGOING" }],
          },
          "/3/settings/lockedperiod": {
            LockedPeriod: { EndDate: "2025-12-31" },
          },
        };
        return Response.json({
          ...(payload[u.pathname] as object),
          MetaInformation: meta,
        });
      },
    });
    const adapter = new FortnoxAccounting(f.connections, provider, f.gates);
    const refs = await adapter.references(f.actor, f.a.id, 7);
    expect(refs.company_id).toBe(f.a.id);
    expect(refs.complete).toBe(true);
    expect(refs.validation_verified).toBe(false);
    expect(refs.projects).toEqual([{ code: "PROJECT_A", active: true }]);
    expect(urls).toHaveLength(6);
    totalPages = 6;
    expect((await adapter.references(f.actor, f.a.id, 7)).complete).toBe(false);
    totalPages = 1;
    wrongYear = true;
    await expect(adapter.references(f.actor, f.a.id, 7)).rejects.toThrow(
      "COMPANY_FORBIDDEN",
    );
    const count = urls.length;
    await expect(
      adapter.references(f.actor, crypto.randomUUID(), 7),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    expect(urls).toHaveLength(count);
  }, 15000);
  it("the fixed voucher POST is sent once for 401/403/429/5xx, redirects and lost responses; no unsafe retry", async () => {
    const f = await accountingFixture(await fixture());
    let status = 201;
    let requests = 0;
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async (input) => {
        requests++;
        const request = input as Request;
        expect(request.url).toBe(
          "https://api.fortnox.se/3/vouchers?financialyear=7",
        );
        expect(request.method).toBe("POST");
        expect(request.redirect).toBe("manual");
        expect(await request.json()).toMatchObject({
          Voucher: { VoucherSeries: "A", TransactionDate: "2026-01-01" },
        });
        if (status === 0) throw new Error("synthetic secret provider body");
        return Response.json(
          { Voucher: { Year: 7, VoucherNumber: 1, VoucherSeries: "A" } },
          {
            status,
            headers: {
              location: "http://127.0.0.1/private",
              "retry-after": "1",
            },
          },
        );
      },
    });
    const adapter = new FortnoxAccounting(f.connections, provider, f.gates);
    let dispatches = 0;
    for (const code of [201, 401, 403, 429, 500, 302, 0]) {
      status = code;
      const before = requests;
      const r = await adapter.submit(f.actor, f.voucher, async () => {
        dispatches++;
      });
      expect(requests - before).toBe(1);
      expect(r.state).toBe(
        code === 201
          ? "succeeded"
          : code >= 400 && code < 500
            ? "failed"
            : "outcome_unknown",
      );
      expect(JSON.stringify(r)).not.toContain("synthetic secret");
    }
    expect(dispatches).toBe(7);
    await expect(
      adapter.submit(
        { ...f.actor, scopes: ["mcp:read"] },
        f.voucher,
        async () => {},
      ),
    ).rejects.toThrow();
    expect(requests).toBe(7);
  });
}
