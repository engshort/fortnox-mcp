import {
  AccountingValidationError,
  Bookkeeping,
  type StateStore,
  validateVoucher,
} from "@fortnox-mcp/core";
import {
  FortnoxAccounting,
  FortnoxConnections,
  parseExactProviderJson,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture, syntheticReferences } from "./accounting.js";

export function accountingTransportContract(
  fixture: () => Promise<StateStore>,
) {
  it("numeric account information rules stay unknown and provider response failures are classified and redacted through MCP", async () => {
    const f = await accountingFixture(await fixture());
    let information: unknown = 0;
    let lock = "2025-12-31";
    let requests = 0;
    const marker = "synthetic-private-provider-value";
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async (input) => {
        requests++;
        const url = new URL((input as Request).url);
        const refs = syntheticReferences(f.a.id);
        const payload: Record<string, unknown> = {
          "/3/financialyears": {
            FinancialYears: [
              { Id: 7, FromDate: refs.year.from, ToDate: refs.year.to },
            ],
          },
          "/3/accounts": {
            Accounts: refs.accounts.map((a) => ({
              Number: a.number,
              Active: a.active,
              Year: 7,
              CostCenterSettings: a.cost_center,
              ProjectSettings: a.project,
              TransactionInformationSettings: information,
            })),
          },
          "/3/voucherseries": {
            VoucherSeriesCollection: [{ Code: "A", Manual: true, Year: 7 }],
          },
          "/3/costcenters": { CostCenters: [] },
          "/3/projects": { Projects: [] },
          "/3/settings/lockedperiod": { LockedPeriod: { EndDate: lock } },
        };
        return Response.json({
          ...(payload[url.pathname] as object),
          MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 },
        });
      },
    });
    const adapter = new FortnoxAccounting(f.connections, provider, f.gates);
    const service = new Bookkeeping(f.connections, adapter, f.gates);
    const refs = await service.references(f.actor, f.a.id, 7);
    expect(refs.complete).toBe(true);
    expect(refs.validation_verified).toBe(false);
    expect(refs.accounts.map((a) => a.information)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
    ]);
    try {
      validateVoucher(
        f.voucher,
        { ...refs, validation_verified: true },
        Date.now(),
      );
      throw new Error("Unknown rules must block validation");
    } catch (cause) {
      expect(cause).toBeInstanceOf(AccountingValidationError);
      expect((cause as AccountingValidationError).fields).toContainEqual({
        path: "rows.0.information",
        rule: "unknown_dimension_rule",
      });
    }
    const server = companyServer({
      identity: f.actor,
      connections: f.connections,
      provider,
      testMode: true,
      bookkeeping: service,
    });
    const client = new Client({
      name: "synthetic-reference-client",
      version: "0",
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const read = () =>
        client.callTool({
          name: "get_accounting_references",
          arguments: { company_id: f.a.id, financial_year: 7 },
        });
      const ok = await read();
      expect(ok.isError).not.toBe(true);
      expect(JSON.stringify(ok.structuredContent)).toContain(
        '"information":"UNKNOWN"',
      );
      information = marker;
      const bad = await read();
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent).toMatchObject({
        status: "error",
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          reason: "invalid_accounts_response",
          provider_code: null,
          fields: [
            {
              path: "accounts.*.TransactionInformationSettings",
              rule: "provider_contract",
            },
          ],
        },
      });
      expect(JSON.stringify(bad)).not.toContain(marker);
      information = 0;
      lock = marker;
      const badLock = await read();
      expect(badLock.structuredContent).toMatchObject({
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          reason: "invalid_locked_period_response",
          fields: [
            {
              path: "locked_period.LockedPeriod.EndDate",
              rule: "provider_contract",
            },
          ],
        },
      });
      expect(JSON.stringify(badLock)).not.toContain(marker);
      const before = requests;
      const invalidInput = await client.callTool({
        name: "get_accounting_references",
        arguments: { company_id: f.a.id, financial_year: "7" },
      });
      expect(invalidInput.isError).toBe(true);
      expect(requests).toBe(before);
    } finally {
      await client.close();
      await server.close();
    }
  }, 15000);
  it("a malformed internal result is never reported as invalid caller input", async () => {
    const f = await accountingFixture(await fixture());
    f.provider.references = async (_actor, company) => ({
      ...syntheticReferences(company),
      complete: "true" as unknown as boolean,
    });
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async () => {
        throw new Error("No provider I/O");
      },
    });
    const server = companyServer({
      identity: f.actor,
      connections: f.connections,
      provider,
      testMode: true,
      bookkeeping: f.service,
    });
    const client = new Client({
      name: "synthetic-result-client",
      version: "0",
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const result = await client.callTool({
        name: "get_accounting_references",
        arguments: { company_id: f.a.id, financial_year: 7 },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          reason: "invalid_tool_result",
          fields: [],
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("MCP discovers company-specific year IDs under read-only policy without guessing a year or sending unauthorized requests", async () => {
    const f = await accountingFixture(await fixture());
    const requests: Request[] = [];
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async (input) => {
        const request = input as Request;
        requests.push(request);
        const url = new URL(request.url);
        expect(url.pathname).toBe("/3/financialyears");
        expect(url.searchParams.has("financialyear")).toBe(false);
        expect(url.searchParams.get("page")).toBe("1");
        const b =
          request.headers.get("authorization") === "Bearer synthetic-token-B";
        return Response.json({
          FinancialYears: [
            { Id: b ? 9 : 7, FromDate: "2025-07-01", ToDate: "2026-06-30" },
          ],
          MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 },
        });
      },
    });
    const gates = { references: true, writes: false, reviewHost: false };
    const service = new Bookkeeping(
      f.connections,
      new FortnoxAccounting(f.connections, provider, gates),
      gates,
    );
    const server = companyServer({
      identity: f.actor,
      connections: f.connections,
      provider,
      testMode: true,
      bookkeeping: service,
    });
    const client = new Client({ name: "synthetic-years-client", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === "list_financial_years",
      );
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      for (const [company, id] of [
        [f.a.id, 7],
        [f.b.id, 9],
      ] as const) {
        const result = await client.callTool({
          name: "list_financial_years",
          arguments: { company_id: company },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          status: "ok",
          company_id: company,
          data: { company_id: company, complete: true, years: [{ id }] },
        });
      }
      const before = requests.length;
      const denied = await client.callTool({
        name: "list_financial_years",
        arguments: { company_id: crypto.randomUUID() },
      });
      expect(denied.structuredContent).toMatchObject({
        status: "error",
        error: { code: "COMPANY_FORBIDDEN" },
      });
      await expect(
        service.years({ ...f.actor, scopes: [] }, f.a.id),
      ).rejects.toThrow("AUTH_REQUIRED");
      expect(requests).toHaveLength(before);
      const extra = await client.callTool({
        name: "list_financial_years",
        arguments: { company_id: f.a.id, financial_year: 2026 },
      });
      expect(extra.isError).toBe(true);
      expect(requests).toHaveLength(before);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("year discovery bounds pagination and rejects duplicate identities and invalid dates", async () => {
    const f = await accountingFixture(await fixture());
    let mode = "bounded";
    let requests = 0;
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async (input) => {
        requests++;
        const page = Number(
          new URL((input as Request).url).searchParams.get("page"),
        );
        return Response.json({
          FinancialYears:
            mode === "bounded"
              ? Array.from({ length: 100 }, (_, i) => ({
                  Id: page * 100 + i,
                  FromDate: "2025-07-01",
                  ToDate: "2026-06-30",
                }))
              : mode === "duplicate"
                ? [7, 7].map((Id) => ({
                    Id,
                    FromDate: "2025-07-01",
                    ToDate: "2026-06-30",
                  }))
                : [{ Id: 7, FromDate: "2026-02-30", ToDate: "2025-01-01" }],
          MetaInformation: {
            "@CurrentPage": page,
            "@TotalPages": mode === "bounded" ? 6 : 1,
          },
        });
      },
    });
    const adapter = new FortnoxAccounting(f.connections, provider, f.gates);
    const result = await adapter.years(f.actor, f.a.id);
    expect(result.complete).toBe(false);
    expect(result.years).toHaveLength(500);
    expect(requests).toBe(5);
    mode = "duplicate";
    await expect(adapter.years(f.actor, f.a.id)).rejects.toThrow(
      "UPSTREAM_UNAVAILABLE",
    );
    mode = "invalid";
    await expect(adapter.years(f.actor, f.a.id)).rejects.toThrow();
  }, 15000);
  it("year discovery accepts explicitly empty metadata and rejects missing or unprefixed pagination", async () => {
    const f = await accountingFixture(await fixture());
    let pagination: unknown = {
      "@CurrentPage": 0,
      "@TotalPages": 0,
      "@TotalResources": 0,
    };
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections: f.connections,
      testTenants: ["100001", "100002"],
      fetch: async () =>
        Response.json({
          FinancialYears: [],
          ...(pagination ? { MetaInformation: pagination } : {}),
        }),
    });
    const adapter = new FortnoxAccounting(f.connections, provider, f.gates);
    expect(await adapter.years(f.actor, f.a.id)).toMatchObject({
      company_id: f.a.id,
      complete: true,
      years: [],
    });
    pagination = undefined;
    await expect(adapter.years(f.actor, f.a.id)).rejects.toThrow(
      "UPSTREAM_UNAVAILABLE",
    );
    pagination = { CurrentPage: 1, TotalPages: 1 };
    await expect(adapter.years(f.actor, f.a.id)).rejects.toThrow();
    pagination = { "@CurrentPage": 1, "@TotalPages": 0, "@TotalResources": 1 };
    await expect(adapter.years(f.actor, f.a.id)).rejects.toThrow(
      "UPSTREAM_UNAVAILABLE",
    );
  });
  it("year discovery rechecks connection state after provider I/O and rejects foreign-company results", async () => {
    const f = await accountingFixture(await fixture());
    const original = f.provider.years;
    f.provider.years = async (actor, company) => ({
      ...(await original(actor, company)),
      company_id: f.b.id,
    });
    await expect(f.service.years(f.actor, f.a.id)).rejects.toThrow(
      "COMPANY_FORBIDDEN",
    );
    f.provider.years = async (actor, company) => {
      const result = await original(actor, company);
      await f.connections.disconnect(actor.ownerId, company);
      return result;
    };
    await expect(f.service.years(f.actor, f.a.id)).rejects.toThrow(
      "CONNECTION_DISCONNECTED",
    );
  });
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
        expect(names.includes("list_financial_years")).toBe(references);
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
        expect(u.searchParams.get("financialyear")).toBe(
          u.pathname === "/3/financialyears" ? null : "7",
        );
        expect(request.redirect).toBe("manual");
        const meta = {
          "@CurrentPage": Number(u.searchParams.get("page")),
          "@TotalPages": u.pathname === "/3/accounts" ? totalPages : 1,
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
            VoucherSeriesCollection: [{ Code: "A", Manual: true, Year: 7 }],
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
