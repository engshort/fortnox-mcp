import {
  FinancialReads,
  type ReadModule,
  type RequestActor,
  readDefinitions,
  readOutput,
  requestActor,
} from "@fortnox-mcp/core";
import { FortnoxRawFinancialReads } from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig, Owner } from "../../apps/shared/product-auth.js";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { openApiDocument, restApi } from "../../packages/rest/src/index.js";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";

const modules: ReadModule[] = [
  "customer_invoices",
  "supplier_invoices",
  "vouchers",
  "accounts",
];
const row = {
  Account: 1930,
  Debit: "1.25",
  Credit: "0",
  Removed: true,
  Description: "Synthetic removed row",
};
const voucher = {
  Year: 7,
  VoucherNumber: 4,
  VoucherSeries: "A",
  TransactionDate: "2026-02-01",
  Description: "Synthetic voucher",
  VoucherRows: [row],
};
const invoice = {
  DocumentNumber: "12",
  CustomerNumber: "C1",
  CustomerName: "Synthetic customer",
  InvoiceDate: "2026-02-01",
  DueDate: "2026-03-01",
  Currency: "EUR",
  Total: "-20.10",
  Balance: "-20.10",
  Credit: "true",
  Booked: true,
  InvoiceRows: [
    {
      AccountNumber: 3001,
      DeliveredQuantity: "2",
      Price: "-10.05",
      Total: "-20.10",
    },
  ],
};
async function setup(config: AuthConfig, bridge = false) {
  let providerCalls = 0;
  let hook: ((request: Request) => Promise<Response | undefined>) | undefined;
  const app = createProductApplication(
    {
      origin: config.origin,
      secret: config.secret,
      keys: { a: keyA },
      activeKey: "a",
      redirects: ["https://client.example.invalid/callback"],
      testMode: true,
      clientId: "synthetic-client",
      clientSecret: "synthetic-client-secret",
      testTenants: ["100001", "100002"],
      restApi: true,
      restBridge: bridge,
      accountingReferences: true,
      financialReadModules: modules,
    },
    config,
    async (input) => {
      providerCalls++;
      const request = input as Request;
      expect(request.method).toBe("GET");
      const overridden = await hook?.(request);
      if (overridden) return overridden;
      const url = new URL(request.url);
      const meta = {
        MetaInformation: {
          "@CurrentPage": Number(url.searchParams.get("page") ?? 1),
          "@TotalPages": 1,
        },
      };
      if (url.pathname === "/3/companyinformation")
        return Response.json({
          CompanyInformation: {
            DatabaseNumber: "100001",
            CompanyName: "Synthetic A",
            OrganizationNumber: "000000-0000",
          },
        });
      if (url.pathname === "/3/financialyears")
        return Response.json({
          FinancialYears: [
            { Id: 7, FromDate: "2025-07-01", ToDate: "2026-06-30" },
          ],
          ...meta,
        });
      if (url.pathname === "/3/invoices")
        return Response.json({ Invoices: [invoice], ...meta });
      if (url.pathname === "/3/invoices/12")
        return Response.json({ Invoice: invoice });
      const supplier = {
        ...invoice,
        DocumentNumber: undefined,
        GivenNumber: "12",
        SupplierNumber: "S1",
        SupplierName: "Synthetic supplier",
        SupplierInvoiceRows: [
          {
            Account: 4000,
            Debit: "20.10",
            Credit: "0",
            Quantity: "2",
            Price: "10.05",
          },
        ],
      };
      if (url.pathname === "/3/supplierinvoices")
        return Response.json({ SupplierInvoices: [supplier], ...meta });
      if (url.pathname === "/3/supplierinvoices/12")
        return Response.json({ SupplierInvoice: supplier });
      if (url.pathname === "/3/vouchers")
        return Response.json({ Vouchers: [voucher], ...meta });
      if (url.pathname === "/3/vouchers/A/4")
        return Response.json({ Voucher: voucher });
      if (url.pathname === "/3/accounts")
        return new Response(
          '{"Accounts":[{"Number":1930,"Year":7,"Description":"Synthetic inactive account","Active":false,"BalanceBroughtForward":9007199254740993.01,"BalanceCarriedForward":0},{"Number":9999,"Year":7,"Description":"Synthetic custom account","Active":true}],"MetaInformation":{"@CurrentPage":1,"@TotalPages":1}}',
        );
      if (url.pathname === "/3/accounts/1930")
        return Response.json({
          Account: {
            Number: 1930,
            Year: 7,
            Active: false,
            Description: "Synthetic account",
            BalanceBroughtForward: "1.01",
            BalanceCarriedForward: "0",
          },
        });
      if (url.pathname === "/3/voucherseries")
        return Response.json({
          VoucherSeriesCollection: [{ Code: "A", Manual: true, Year: 7 }],
          ...meta,
        });
      if (url.pathname === "/3/costcenters")
        return Response.json({ CostCenters: [], ...meta });
      if (url.pathname === "/3/projects")
        return Response.json({ Projects: [], ...meta });
      if (url.pathname === "/3/settings/lockedperiod")
        return Response.json({ LockedPeriod: { EndDate: "2025-06-30" } });
      return Response.json(
        { ErrorInformation: { code: 200 } },
        { status: 404 },
      );
    },
  );
  const owner = "read-owner";
  const a = await app.connections.add(
    owner,
    {
      ...syntheticCompany,
      scopes: [
        "companyinformation",
        "profile",
        "bookkeeping",
        "invoice",
        "supplierinvoice",
        "settings",
        "costcenter",
        "project",
      ],
    },
    syntheticCredentials,
  );
  const b = await app.connections.add(
    owner,
    { ...syntheticCompany, tenant: "100002", name: "Synthetic B" },
    { ...syntheticCredentials, accessToken: "synthetic-B" },
  );
  const actor: RequestActor = {
    ownerId: owner,
    clientId: "read-client",
    resource: "api",
    permissions: ["read", "finance_read"],
  };
  await app.connections.grant(owner, actor.clientId, [a.id], "api");
  const api = restApi({
    origin: config.origin,
    enabled: true,
    services: app.reads,
    authenticate: async () => actor,
  });
  return {
    app,
    actor,
    a,
    b,
    api,
    config,
    calls: () => providerCalls,
    setHook: (value: typeof hook) => {
      hook = value;
    },
  };
}

export function readApiContract(fixture: () => Promise<AuthConfig>) {
  describe("shared REST/MCP read services", () => {
    it("keeps grants resource-specific, rejects unsupported permissions and fails closed outside test modules", async () => {
      const f = await setup(await fixture());
      await expect(
        f.app.connections.authorize(f.actor.ownerId, f.actor.clientId, f.a.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        f.app.reads.execute(f.actor, "get_company_profile", {
          company_id: f.b.id,
        }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        f.app.reads.execute(
          { ...f.actor, permissions: ["read"] },
          "list_accounts",
          { company_id: f.a.id, financial_year: 7 },
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      const metadataOnly = restApi({
        origin: f.config.origin,
        enabled: true,
        services: f.app.reads,
        authenticate: async () => ({ ...f.actor, permissions: ["read"] }),
      });
      expect(
        (
          await metadataOnly.fetch(
            new Request(
              `${f.config.origin}/api/v1/companies/${f.a.id}/financial-years/7/accounts`,
            ),
          )
        ).status,
      ).toBe(403);
      await expect(
        f.app.bookkeeping.prepare(f.actor, {
          company_id: f.a.id,
          financial_year: 7,
          date: "2026-02-01",
          series: "A",
          description: "Synthetic voucher",
          currency: "SEK",
          attachments: [],
          rows: [
            { account: 1930, debit: "1.00", credit: "0.00" },
            { account: 3001, debit: "0.00", credit: "1.00" },
          ],
        }),
      ).rejects.toThrow("AUTH_REQUIRED");
      const disabled = new FinancialReads(
        f.app.connections,
        new FortnoxRawFinancialReads(f.app.connections, f.app.provider, []),
        [],
      );
      await expect(
        disabled.read(f.actor, "list_accounts", {
          company_id: f.a.id,
          financial_year: 7,
        }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.calls()).toBe(0);
    });
    it("binds current immutable OAuth approvals to their resource and current company features", async () => {
      const f = await setup(await fixture());
      const grant = await f.app.connections.renewGrant(
        f.actor.ownerId,
        "dedicated-api-client",
        [
          {
            id: f.a.id,
            generation: f.a.generation,
            access_revision: f.a.accessRevision ?? 0,
          },
        ],
        undefined,
        undefined,
        "api",
      );
      const actor = { ...f.actor, clientId: grant.grantId as string };
      await expect(
        f.app.connections.authorizeActor(actor, f.a.id),
      ).resolves.toMatchObject({ id: f.a.id });
      await expect(
        f.app.connections.authorizeActor({ ...actor, resource: "mcp" }, f.a.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        f.app.connections.renewGrant(
          f.actor.ownerId,
          "dedicated-api-client",
          [],
          undefined,
          "owner_connections",
          "api",
        ),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await f.app.connections.disableProgram(
        f.actor.ownerId,
        f.a.id,
        "invoicing",
        0,
      );
      // Fresh owner consent cannot restore a feature removed from the company.
      const current = (await f.app.connections.list(f.actor.ownerId)).find(
        (c) => c.id === f.a.id,
      );
      if (!current) throw new Error("Synthetic company missing");
      const renewed = await f.app.connections.renewGrant(
        f.actor.ownerId,
        "dedicated-api-client",
        [
          {
            id: current.id,
            generation: current.generation,
            access_revision: current.accessRevision ?? 0,
          },
        ],
        undefined,
        undefined,
        "api",
      );
      await expect(
        f.app.reads.execute(
          { ...actor, clientId: renewed.grantId as string },
          "get_invoice",
          { company_id: f.a.id, number: "12" },
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(
        await f.app.reads.available({
          ...actor,
          clientId: renewed.grantId as string,
        }),
      ).not.toContain("get_invoice");
      expect(f.calls()).toBe(0);
    });
    it("returns exact provider money, explicit missing balances and inactive/custom accounts for a non-calendar year", async () => {
      const f = await setup(await fixture());
      const result = await f.app.reads.execute(f.actor, "list_accounts", {
        company_id: f.a.id,
        financial_year: 7,
      });
      expect(result.data).toMatchObject({
        count: 2,
        items: [
          {
            number: 1930,
            active: false,
            balance_brought_forward: "9007199254740993.01",
            balance_carried_forward: "0",
          },
          {
            number: 9999,
            balance_brought_forward: null,
            balance_carried_forward: null,
          },
        ],
      });
      expect(result.evidence.warnings.join(" ")).toContain("annual balances");
      expect(result.continuation).toBeNull();
      const years = await f.app.reads.execute(f.actor, "list_financial_years", {
        company_id: f.a.id,
      });
      expect(years.data).toMatchObject({
        years: [{ id: 7, from: "2025-07-01", to: "2026-06-30" }],
      });
    });
    it("reads both invoice families and existing removed voucher rows without applying creation constraints", async () => {
      const f = await setup(await fixture());
      const result = await f.app.reads.execute(f.actor, "get_invoice", {
        company_id: f.a.id,
        number: "12",
      });
      expect(result.data).toMatchObject({
        kind: "customer",
        credit: true,
        currency: "EUR",
        total: "-20.10",
        booked: true,
        rows: [{ price: "-10.05", account: 3001 }],
      });
      const supplier = await f.app.reads.execute(
        f.actor,
        "get_supplier_invoice",
        { company_id: f.a.id, number: "12" },
      );
      expect(supplier.data).toMatchObject({
        kind: "supplier",
        counterparty_number: "S1",
        rows: [{ debit: "20.10" }],
      });
      const v = await f.app.reads.execute(f.actor, "get_voucher", {
        company_id: f.a.id,
        financial_year: 7,
        series: "A",
        number: 4,
      });
      expect(v.data).toMatchObject({
        rows: [{ removed: true, debit: "1.25" }],
      });
    });
    it("binds continuations to client, resource, company, generation and query, preserves them across service recreation and expires them", async () => {
      const f = await setup(await fixture());
      f.setHook(async (request) => {
        const url = new URL(request.url);
        if (url.pathname !== "/3/invoices") return;
        return Response.json({
          Invoices: [invoice],
          MetaInformation: {
            "@CurrentPage": Number(url.searchParams.get("page")),
            "@TotalPages": 2,
          },
        });
      });
      const first = await f.app.reads.execute(f.actor, "list_invoices", {
        company_id: f.a.id,
        limit: 1,
      });
      expect(first.evidence.complete).toBe(false);
      expect(first.continuation).toBeTypeOf("string");
      const query = {
        company_id: f.a.id,
        limit: 1,
        continuation: first.continuation,
      };
      const calls = f.calls();
      for (const [actor, input] of [
        [{ ...f.actor, clientId: "other-client" }, query],
        [f.actor, { ...query, company_id: f.b.id }],
        [f.actor, { ...query, limit: 2 }],
      ] as const)
        await expect(
          f.app.reads.execute(actor, "list_invoices", input),
        ).rejects.toThrow("COMPANY_FORBIDDEN");
      await f.app.connections.grant(f.actor.ownerId, f.actor.clientId, [
        f.a.id,
      ]);
      const mcpActor = requestActor(
        {
          ownerId: f.actor.ownerId,
          clientId: f.actor.clientId,
          scopes: ["mcp:read", "mcp:finance:read"],
        },
        "mcp",
      );
      await expect(
        f.app.reads.execute(mcpActor, "list_invoices", query),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      expect(f.calls()).toBe(calls);
      const recreated = new FinancialReads(
        f.app.connections,
        new FortnoxRawFinancialReads(
          f.app.connections,
          f.app.provider,
          modules,
          ["100001", "100002"],
        ),
        modules,
      );
      const second = await recreated.read(f.actor, "list_invoices", query);
      expect(second.evidence.complete).toBe(true);
      expect(second.continuation).toBeNull();
      const expired = new FinancialReads(
        f.app.connections,
        recreated.provider,
        modules,
        () => Date.now() + 600001,
      );
      await expect(
        expired.read(f.actor, "list_invoices", query),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await f.app.connections.disconnect(f.actor.ownerId, f.a.id);
      await expect(
        recreated.read(f.actor, "list_invoices", query),
      ).rejects.toThrow("CONNECTION_DISCONNECTED");
    });
    it("rejects wrong-year/identifier responses, missing pagination and disconnects during I/O without leaking provider payloads", async () => {
      const f = await setup(await fixture());
      f.setHook(async () =>
        Response.json({ Voucher: { ...voucher, Year: 8 } }),
      );
      await expect(
        f.app.reads.execute(f.actor, "get_voucher", {
          company_id: f.a.id,
          financial_year: 7,
          series: "A",
          number: 4,
        }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      f.setHook(async () =>
        Response.json({ Invoice: { ...invoice, DocumentNumber: "13" } }),
      );
      await expect(
        f.app.reads.execute(f.actor, "get_invoice", {
          company_id: f.a.id,
          number: "12",
        }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      f.setHook(async () => Response.json({ Invoices: [invoice] }));
      await expect(
        f.app.reads.execute(f.actor, "list_invoices", { company_id: f.a.id }),
      ).rejects.toThrow("UPSTREAM_UNAVAILABLE");
      f.setHook(async () => {
        await f.app.connections.disconnect(f.actor.ownerId, f.a.id);
        return Response.json({ Invoice: invoice });
      });
      await expect(
        f.app.reads.execute(f.actor, "get_invoice", {
          company_id: f.a.id,
          number: "12",
        }),
      ).rejects.toThrow("CONNECTION_DISCONNECTED");
    });
    it("enforces strict REST inputs/methods, maps not-found/denials, and serves the same read data through MCP", async () => {
      const f = await setup(await fixture());
      const base = `${f.config.origin}/api/v1/companies/${f.a.id}`;
      for (const suffix of [
        "/customer-invoices?url=https://attacker.invalid",
        "/customer-invoices?limit=1&limit=2",
        "/customer-invoices?limit=NaN",
        "/financial-years/0/accounts",
        "/financial-years/7/accounts?financial_year=8",
      ]) {
        expect((await f.api.fetch(new Request(base + suffix))).status).toBe(
          400,
        );
      }
      expect(f.calls()).toBe(0);
      expect(
        (await f.api.fetch(new Request(`${base}/customer-invoices/99`))).status,
      ).toBe(404);
      expect(
        (
          await f.api.fetch(
            new Request(`${base}/customer-invoices`, { method: "POST" }),
          )
        ).status,
      ).toBe(405);
      const denied = await f.api.fetch(
        new Request(`${f.config.origin}/api/v1/companies/${f.b.id}/profile`),
      );
      expect(denied.status).toBe(403);
      const response = await f.api.fetch(
        new Request(`${base}/customer-invoices/12`),
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      const rest = (await response.json()) as { data: unknown };
      await f.app.connections.grant(f.actor.ownerId, f.actor.clientId, [
        f.a.id,
      ]);
      const identity = {
        ownerId: f.actor.ownerId,
        clientId: f.actor.clientId,
        scopes: ["mcp:read", "mcp:finance:read"],
      };
      const server = companyServer({
        identity,
        connections: f.app.connections,
        provider: f.app.provider,
        testMode: true,
        bookkeeping: f.app.bookkeeping,
        reads: f.app.reads,
      });
      const client = new Client({
        name: "synthetic-read-client",
        version: "0",
      });
      const [left, right] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(right);
        await client.connect(left);
        const result = await client.callTool({
          name: "get_invoice",
          arguments: { company_id: f.a.id, number: "12" },
        });
        expect(result.structuredContent).toMatchObject({ data: rest.data });
        expect(
          (await client.listTools()).tools.find(
            (tool) => tool.name === "get_invoice",
          )?.annotations,
        ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      } finally {
        await client.close();
        await server.close();
      }
    });
    it("reports only permitted capabilities and keeps the generated OpenAPI aligned with routes and schemas", async () => {
      const f = await setup(await fixture());
      const names = await f.app.reads.available(f.actor);
      expect(names).toContain("list_accounts");
      expect(
        await f.app.reads.available({ ...f.actor, permissions: ["read"] }),
      ).not.toContain("list_accounts");
      const document = openApiDocument();
      for (const [name, definition] of Object.entries(readDefinitions)) {
        const path = definition.path.replace(/:([a-z_]+)/g, "{$1}");
        expect(document.paths[path]).toMatchObject({
          get: { operationId: name },
        });
      }
      const output = await f.app.reads.execute(f.actor, "get_account", {
        company_id: f.a.id,
        financial_year: 7,
        number: 1930,
      });
      expect(
        readOutput(readDefinitions.get_account.data).safeParse(output).success,
      ).toBe(true);
      const disabled = restApi({
        origin: f.config.origin,
        enabled: false,
        services: f.app.reads,
        authenticate: async () => {
          throw new Error("must not authenticate");
        },
      });
      expect(
        (
          await disabled.fetch(
            new Request(`${f.config.origin}/api/v1/companies`),
          )
        ).status,
      ).toBe(404);
    });
  });
}

export function readOAuthContract(fixture: () => Promise<AuthConfig>) {
  it("uses real PKCE/consent/refresh/revocation for REST, isolates MCP/admin tokens and preserves an explicit company selection", async () => {
    const config = await fixture();
    const f = await setup(config, true);
    const seeded = await f.app.auth.api.signUpEmail({
      body: {
        email: "rest-owner@example.invalid",
        name: "Synthetic owner",
        password: "Synthetic-read-password-123456",
      },
      returnHeaders: true,
    });
    const ownerId = seeded.response.user.id;
    await config.state.put<Owner>(
      "installation",
      "owner",
      { phase: "active", ownerId, expiresAt: 0, tokenHash: "" },
      null,
    );
    const cookie = seeded.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const a = await f.app.connections.add(
      ownerId,
      {
        ...syntheticCompany,
        scopes: ["companyinformation", "profile", "invoice"],
      },
      syntheticCredentials,
    );
    const b = await f.app.connections.add(
      ownerId,
      { ...syntheticCompany, tenant: "100002", name: "Synthetic B" },
      syntheticCredentials,
    );
    const req = (
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      f.app.fetch(
        new Request(`${config.origin}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type":
              body instanceof URLSearchParams
                ? "application/x-www-form-urlencoded"
                : "application/json",
            ...headers,
          },
          ...(body === undefined
            ? {}
            : {
                body:
                  body instanceof URLSearchParams ? body : JSON.stringify(body),
              }),
        }),
      );
    const callback = "https://client.example.invalid/callback";
    const scope =
      "api:read api:finance:read api:write api:files offline_access";
    const registration = await req("/auth/oauth2/register", {
      client_name: "Synthetic REST client",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
      resources: [`${config.origin}/api/v1`],
    });
    expect(registration.status).toBe(201);
    const registered = (await registration.json()) as { client_id: string };
    const verifier =
      "synthetic-rest-code-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const authorization = await req(
      `/auth/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id: registered.client_id, redirect_uri: callback, scope, resource: `${config.origin}/api/v1`, state: "synthetic-state", code_challenge: challenge, code_challenge_method: "S256" })}`,
      undefined,
      { cookie },
    );
    const consent = new URL(
      authorization.headers.get("location") ??
        ((await authorization.json()) as { url: string }).url,
      config.origin,
    );
    const page = await req(consent.pathname + consent.search, undefined, {
      cookie,
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Välj företag");
    const accept = await req(
      "/auth/oauth2/consent",
      {
        accept: true,
        oauth_query: consent.search.slice(1),
        companies: [
          {
            id: a.id,
            generation: a.generation,
            access_revision: a.accessRevision ?? 0,
          },
        ],
      },
      { cookie, origin: config.origin },
    );
    expect(accept.status).toBe(200);
    const redirect = new URL(((await accept.json()) as { url: string }).url);
    const tokenResponse = await req(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registered.client_id,
        redirect_uri: callback,
        resource: `${config.origin}/api/v1`,
        code: redirect.searchParams.get("code") ?? "",
        code_verifier: verifier,
      }),
    );
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const auth = { authorization: `Bearer ${tokens.access_token}` };
    const identity = await f.app.auth.api.verifyProductToken({
      body: { token: tokens.access_token, resource: "api" },
    });
    expect(requestActor(identity, "api").permissions).toEqual([
      "read",
      "finance_read",
      "write",
      "files",
    ]);
    expect((await req("/api/v1/companies")).status).toBe(401);
    expect((await req("/api/v1/companies", undefined, { cookie })).status).toBe(
      401,
    );
    const companies = await req("/api/v1/companies", undefined, auth);
    expect(companies.status).toBe(200);
    expect(await companies.json()).toMatchObject({
      data: { count: 1, companies: [{ company_id: a.id }] },
    });
    expect(
      (await req(`/api/v1/companies/${b.id}/profile`, undefined, auth)).status,
    ).toBe(403);
    expect((await req("/admin", undefined, auth)).status).toBe(401);
    const mcp = await req(
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      auth,
    );
    expect(mcp.status).toBe(401);
    await expect(
      f.app.auth.api.verifyProductToken({
        body: { token: tokens.access_token },
      }),
    ).rejects.toThrow();
    expect(
      (await req("/.well-known/oauth-protected-resource/api/v1")).status,
    ).toBe(200);
    const refreshed = await req(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: registered.client_id,
        resource: `${config.origin}/api/v1`,
      }),
    );
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(
      (
        await req("/api/v1/companies", undefined, {
          authorization: `Bearer ${next.access_token}`,
        })
      ).status,
    ).toBe(200);
    f.setHook(async (request) => {
      if (new URL(request.url).pathname !== "/3/invoices/12") return;
      const revoked = await req(
        "/auth/oauth2/revoke",
        new URLSearchParams({
          token: next.access_token,
          token_type_hint: "access_token",
          client_id: registered.client_id,
        }),
      );
      expect(revoked.status).toBe(200);
      return Response.json({ Invoice: invoice });
    });
    expect(
      (
        await req(`/api/v1/companies/${a.id}/customer-invoices/12`, undefined, {
          authorization: `Bearer ${next.access_token}`,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await req("/api/v1/companies", undefined, {
          authorization: `Bearer ${next.access_token}`,
        })
      ).status,
    ).toBe(401);
    expect(f.calls()).toBe(1);
  }, 20000);
}
