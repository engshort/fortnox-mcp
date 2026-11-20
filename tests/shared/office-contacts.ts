import type {
  Connection,
  ConnectionSet,
  InstallationGrant,
  OfficeContactSource,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import {
  createProductApplication,
  type ProductSettings,
} from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { runOfficeContactsContract } from "../../scripts/office-contacts-contract.mjs";
import { syntheticCompany, syntheticCredentials } from "./connections.js";
import { installationAccessFixture } from "./installation-access.js";

const meta = (page = 1, total = 1) => ({
  "@CurrentPage": String(page),
  "@TotalPages": String(total),
});
const org = "0000000000";
const customer = {
  CustomerNumber: "7",
  OrganisationNumber: "000000-0000",
  Active: true,
  YourReference: "Synthetic Contact",
  Email: "contact@example.invalid",
};
const employees = {
  Employees: [
    {
      EmployeeId: "E1",
      Inactive: false,
      FirstName: "Synthetic",
      LastName: "Person",
      Email: null,
      PersonalIdentityNumber: "synthetic-sensitive-identifier",
      MonthlySalary: "synthetic-sensitive-pay",
      BankAccount: "synthetic-sensitive-bank",
    },
    {
      EmployeeId: "E2",
      Inactive: true,
      FullName: "Inactive Person",
      Email: "inactive@example.invalid",
    },
  ],
  MetaInformation: meta(),
};

async function setup(
  config: AuthConfig,
  overrides: Partial<ProductSettings> = {},
) {
  const f = await installationAccessFixture(config, true, {
    officeContacts: true,
    ...overrides,
  });
  await f.app.connections.updateSet(f.owner, (set) => {
    const c = set.connections.find((c) => c.id === f.a.id) as Connection;
    c.scopes.push("customer", "salary");
    c.programs?.features.push("customer-registers", "payroll-input");
    c.programs?.enabled.push("payroll");
  });
  const client = await f.create();
  const consent = async (sources: OfficeContactSource[], company = f.a.id) => {
    const g = (await f.app.connections.installationAccess.list(f.owner)).find(
      (g) => g.id === client.integration.id,
    ) as InstallationGrant;
    const response = await f.browser({
      action: "change",
      id: g.id,
      expected_revision: g.revision,
      office_contacts: sources.length ? [{ company_id: company, sources }] : [],
    });
    expect(response.status, await response.clone().text()).toBe(200);
  };
  const bearer = async () => {
    const response = await f.token(client);
    expect(response.status, await response.clone().text()).toBe(200);
    return {
      authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}`,
    };
  };
  const get = (
    source: string,
    headers: Record<string, string>,
    suffix = "",
    company = f.a.id,
    target = f.app,
  ) =>
    f.request(
      `/api/v1/companies/${company}/office-contacts/${source}${suffix}`,
      undefined,
      headers,
      target,
    );
  return { ...f, client, consent, bearer, get };
}
export function officeContactsContract(fixture: () => Promise<AuthConfig>) {
  describe("Office contacts", () => {
    it("starts disabled and never widens old finance clients, scopes or company consent", async () => {
      const f = await setup(await fixture(), { officeContacts: false });
      const before = await f.bearer();
      expect((await f.get("payroll", before)).status).toBe(404);
      expect(
        (
          await f.token(f.client, {
            scope: "api:read api:office:contacts:read",
          })
        ).status,
      ).toBe(400);
      const enabled = createProductApplication(
        { ...f.settings, officeContacts: true },
        f.config,
        f.fetcher,
      );
      expect((await f.get("payroll", before, "", f.a.id, enabled)).status).toBe(
        403,
      );
      expect(
        (await f.app.connections.installationAccess.list(f.owner))[0]
          ?.officeContacts,
      ).toBeUndefined();
    });
    it("projects only active named employees; missing email is null and sensitive fields never escape", async () => {
      const f = await setup(await fixture());
      await f.consent(["payroll"]);
      const headers = await f.bearer();
      f.setHook(async (r) =>
        new URL(r.url).pathname === "/3/employees"
          ? Response.json(employees)
          : undefined,
      );
      const response = await f.get("payroll", headers);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        status: "ok",
        company_id: f.a.id,
        data: {
          records: [{ id: "E1", name: "Synthetic Person", email: null }],
        },
        evidence: { complete: true },
        continuation: null,
      });
      expect(
        (
          await f.get(
            "customer-register",
            headers,
            `?organisation_number=${org}`,
          )
        ).status,
      ).toBe(403);
      expect((await f.get("payroll", headers, "?tenantId=123")).status).toBe(
        400,
      );
      expect(
        (await f.get("payroll", headers, "?continuation=x&continuation=y"))
          .status,
      ).toBe(400);
    });
    it("binds paging to client/company/source, survives app recreation, expires and fences access changes", async () => {
      const f = await setup(await fixture());
      await f.consent(["payroll", "integration-users"]);
      const headers = await f.bearer();
      f.setHook(async (r) => {
        const url = new URL(r.url);
        if (url.pathname !== "/3/employees") return undefined;
        return Response.json({
          ...employees,
          MetaInformation: meta(Number(url.searchParams.get("page")), 2),
        });
      });
      const first = (await (await f.get("payroll", headers)).json()) as {
        evidence: { complete: boolean };
        continuation: string;
      };
      expect(first.evidence.complete).toBe(false);
      expect(first.continuation).toMatch(/^[a-f0-9-]{36}$/);
      const suffix = `?continuation=${first.continuation}`;
      const recreated = createProductApplication(
        f.settings,
        f.config,
        f.fetcher,
      );
      const last = await f.get("payroll", headers, suffix, f.a.id, recreated);
      expect(last.status, await last.clone().text()).toBe(200);
      expect((await last.json()) as unknown).toMatchObject({
        evidence: { complete: true },
        continuation: null,
      });
      expect((await f.get("integration-users", headers, suffix)).status).toBe(
        400,
      );
      const other = await f.create();
      const otherGrant = other.integration;
      const saved = (
        await f.app.connections.installationAccess.list(f.owner)
      )[0] as InstallationGrant;
      await f.app.connections.installationAccess.save(
        f.owner,
        { ...otherGrant, officeContacts: saved.officeContacts, revision: 2 },
        1,
      );
      // Scope update must be owner-issued through the HTTP management surface.
      const otherChange = await f.browser({
        action: "change",
        id: otherGrant.id,
        expected_revision: 2,
        office_contacts: [{ company_id: f.a.id, sources: ["payroll"] }],
      });
      expect(otherChange.status).toBe(200);
      const otherToken = await f.token(other);
      const otherHeaders = {
        authorization: `Bearer ${((await otherToken.json()) as { access_token: string }).access_token}`,
      };
      expect((await f.get("payroll", otherHeaders, suffix)).status).toBe(400);
      const b = await f.app.connections.add(
        f.owner,
        { ...syntheticCompany, tenant: "100002" },
        syntheticCredentials,
      );
      expect((await f.get("payroll", headers, suffix, b.id)).status).toBe(403);
      const cursors = await f.config.state.get<
        Record<string, { expiresAt: number }>
      >("office-contact-continuations-v1", f.owner);
      if (!cursors) throw new Error("missing test cursor");
      for (const c of Object.values(cursors.value)) c.expiresAt = 0;
      await f.config.state.put(
        "office-contact-continuations-v1",
        f.owner,
        cursors.value,
        cursors.version,
      );
      expect((await f.get("payroll", headers, suffix)).status).toBe(400);
      await f.app.connections.updateSet(f.owner, (set) => {
        const c = set.connections[0];
        if (c) c.accessRevision = 1;
      });
      expect((await f.get("payroll", headers)).status).toBe(403);
    });
    it("requires the entire exact customer search and correct detail, with no invoice fallbacks", async () => {
      const f = await setup(await fixture());
      await f.consent(["customer-register"]);
      const headers = await f.bearer();
      let detail = { ...customer };
      let rows: unknown[] = [
        customer,
        { ...customer, CustomerNumber: "99", OrganisationNumber: "0000000001" },
      ];
      let paging: unknown = meta();
      f.setHook(async (r) => {
        const u = new URL(r.url);
        if (u.pathname === "/3/customers") {
          expect(u.searchParams.get("organisationnumber")).toBe(org);
          return Response.json({ Customers: rows, MetaInformation: paging });
        }
        if (u.pathname === "/3/customers/7")
          return Response.json({
            Customer: {
              ...detail,
              InvoiceEmail: "forbidden@example.invalid",
              Name: "Forbidden fallback",
            },
          });
        return undefined;
      });
      const get = () =>
        f.get("customer-register", headers, `?organisation_number=${org}`);
      expect(await (await get()).json()).toMatchObject({
        data: {
          records: [
            { id: "7", name: customer.YourReference, email: customer.Email },
          ],
        },
      });
      detail = { ...customer, YourReference: "", Email: "" };
      expect(await (await get()).json()).toMatchObject({
        data: { records: [] },
        evidence: { complete: true },
      });
      detail = { ...customer, Active: false };
      expect(await (await get()).json()).toMatchObject({
        data: { records: [] },
      });
      detail = { ...customer, CustomerNumber: "wrong" };
      expect((await get()).status).toBe(502);
      rows = [customer, { ...customer, CustomerNumber: "8" }];
      expect(await (await get()).json()).toMatchObject({
        error: { code: "OFFICE_CONTACTS_AMBIGUOUS_CUSTOMER" },
      });
      rows = [];
      expect(await (await get()).json()).toMatchObject({
        data: { records: [] },
        evidence: { complete: true },
      });
      paging = undefined;
      expect(await (await get()).json()).toMatchObject({
        error: { code: "OFFICE_CONTACTS_INCOMPLETE" },
      });
      expect(
        (
          await f.get(
            "customer-register",
            headers,
            "?organisation_number=000000-0000",
          )
        ).status,
      ).toBe(400);
    });
    it("does not report incomplete, malformed, denied or unavailable sources as empty", async () => {
      const f = await setup(await fixture());
      await f.consent(["payroll", "integration-users"]);
      const headers = await f.bearer();
      let response = Response.json({
        Employees: [],
        MetaInformation: undefined,
      });
      f.setHook(async (r) =>
        new URL(r.url).pathname === "/3/employees"
          ? new Response(await response.clone().text(), {
              status: response.status,
              headers: response.headers,
            })
          : undefined,
      );
      expect(await (await f.get("payroll", headers)).json()).toMatchObject({
        error: { code: "OFFICE_CONTACTS_INCOMPLETE" },
      });
      response = Response.json({
        Employees: [{ EmployeeId: "E1", Inactive: false }],
        MetaInformation: meta(),
      });
      expect((await f.get("payroll", headers)).status).toBe(502);
      response = Response.json(
        { private: "synthetic-sensitive-error" },
        { status: 403 },
      );
      const denied = await f.get("payroll", headers);
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain("synthetic-sensitive-error");
      expect(
        await (await f.get("integration-users", headers)).json(),
      ).toMatchObject({
        error: { code: "OFFICE_CONTACTS_SOURCE_UNAVAILABLE" },
      });
    }, 30000);
    it("rejects contradictory empty metadata and detects a duplicate on a later customer page", async () => {
      const f = await setup(await fixture());
      await f.consent(["payroll", "customer-register"]);
      const headers = await f.bearer();
      f.setHook(async (r) => {
        const url = new URL(r.url);
        if (url.pathname === "/3/employees")
          return Response.json({
            Employees: [],
            MetaInformation: { "@CurrentPage": -1, "@TotalPages": 0 },
          });
        if (url.pathname === "/3/customers") {
          const page = Number(url.searchParams.get("page"));
          return Response.json({
            Customers: [{ ...customer, CustomerNumber: String(page) }],
            MetaInformation: meta(page, 2),
          });
        }
        return undefined;
      });
      expect(await (await f.get("payroll", headers)).json()).toMatchObject({
        error: { code: "OFFICE_CONTACTS_INVALID_RESPONSE" },
      });
      expect(
        await (
          await f.get(
            "customer-register",
            headers,
            `?organisation_number=${org}`,
          )
        ).json(),
      ).toMatchObject({
        error: { code: "OFFICE_CONTACTS_AMBIGUOUS_CUSTOMER" },
      });
      expect(
        f
          .calls()
          .some((r) => /customers\/[^/]+$/.test(new URL(r.url).pathname)),
      ).toBe(false);
    });
    for (const missing of ["scope", "program"] as const)
      it(`checks current payroll ${missing} before provider I/O`, async () => {
        const f = await setup(await fixture());
        await f.consent(["payroll"]);
        const headers = await f.bearer();
        await f.app.connections.updateSet(f.owner, (set) => {
          const c = set.connections[0];
          if (!c) throw new Error("missing synthetic company");
          if (missing === "scope")
            c.scopes = c.scopes.filter((v) => v !== "salary");
          else if (c.programs)
            c.programs.enabled = c.programs.enabled.filter(
              (v) => v !== "payroll",
            );
        });
        f.resetCalls();
        expect(await (await f.get("payroll", headers)).json()).toMatchObject({
          error: { code: "OFFICE_CONTACTS_SOURCE_UNAVAILABLE" },
        });
        expect(f.calls()).toHaveLength(0);
      });
    it("renews a rejected provider token through the existing service OAuth flow", async () => {
      const f = await setup(await fixture());
      await f.consent(["payroll"]);
      const headers = await f.bearer();
      let calls = 0;
      f.setHook(async (r) => {
        if (new URL(r.url).pathname !== "/3/employees") return undefined;
        calls++;
        return calls === 1
          ? new Response(null, { status: 401 })
          : Response.json(employees);
      });
      const response = await f.get("payroll", headers);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(calls).toBe(2);
      expect(
        f.calls().some((r) => new URL(r.url).pathname === "/oauth-v1/token"),
      ).toBe(true);
      const cursorState = await f.config.state.get(
        "office-contact-continuations-v1",
        f.owner,
      );
      const connectionState = await f.config.state.get("connections", f.owner);
      expect(JSON.stringify([cursorState, connectionState])).not.toContain(
        "synthetic-sensitive-",
      );
    });
    it("passes the shared consumer contract through actual product OAuth and HTTP routes", async () => {
      const f = await setup(await fixture());
      await f.consent(["customer-register", "payroll", "integration-users"]);
      const headers = await f.bearer();
      f.setHook(async (r) => {
        const path = new URL(r.url).pathname;
        if (path === "/3/customers")
          return Response.json({
            Customers: [customer],
            MetaInformation: meta(),
          });
        if (path === "/3/customers/7")
          return Response.json({ Customer: customer });
        if (path === "/3/employees") return Response.json(employees);
        return undefined;
      });
      const result = await runOfficeContactsContract(
        {
          origin: f.config.origin,
          access_token: headers.authorization.slice(7),
          bureau_company_id: f.a.id,
          customer_company_id: f.a.id,
          organisation_number: org,
        },
        (input, init) => f.app.fetch(new Request(input, init)),
      );
      expect(result).toEqual({
        version: "office-contacts-v1",
        checks: [
          {
            source: "customer-register",
            outcome: "complete",
            pages: 1,
            records: 1,
          },
          { source: "payroll", outcome: "complete", pages: 1, records: 1 },
          {
            source: "integration-users",
            outcome: "source_unavailable",
            pages: 0,
            records: 0,
          },
        ],
      });
    });
    it("rechecks revocation during provider I/O and never returns retained contacts", async () => {
      const f = await setup(await fixture());
      await f.consent(["payroll"]);
      const headers = await f.bearer();
      f.setHook(async (r) => {
        if (new URL(r.url).pathname !== "/3/employees") return undefined;
        await f.consent([]);
        return Response.json(employees);
      });
      const response = await f.get("payroll", headers);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("Synthetic Person");
    });
    it("uses the verified developer binding and server-derived target tenant for users-v1", async () => {
      const f = await setup(await fixture());
      const dev = await f.app.connections.add(
        f.owner,
        {
          ...syntheticCompany,
          tenant: "100003",
          scopes: ["companyinformation", "profile", "developerapi"],
        },
        syntheticCredentials,
      );
      await f.consent(["integration-users"]);
      const headers = await f.bearer();
      let seen = false;
      f.setHook(async (r) => {
        const path = new URL(r.url).pathname;
        if (!path.includes("users-v1")) return undefined;
        expect(path).toBe(
          `/api/integration-developer/users/users-v1/123/${f.a.tenant}`,
        );
        seen = true;
        return Response.json([
          {
            externalSourceId: "U1",
            name: "Synthetic User",
            email: "user@example.invalid",
            isAdministrator: true,
          },
        ]);
      });
      const app = createProductApplication(
        {
          ...f.settings,
          officeContactsDeveloper: {
            company_id: dev.id,
            generation: dev.generation,
            provider_client_id: syntheticCredentials.clientId,
            integration_id: "123",
          },
        },
        f.config,
        f.fetcher,
      );
      const response = await f.get(
        "integration-users",
        headers,
        "",
        f.a.id,
        app,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(seen).toBe(true);
      expect(await response.json()).toEqual({
        status: "ok",
        company_id: f.a.id,
        data: {
          records: [
            { id: "U1", name: "Synthetic User", email: "user@example.invalid" },
          ],
        },
        evidence: { complete: true },
        continuation: null,
      });
      await f.app.connections.updateSet(f.owner, (set: ConnectionSet) => {
        const c = set.connections.find((c) => c.id === dev.id);
        if (c) c.scopes = [];
      });
      expect(
        (await f.get("integration-users", headers, "", f.a.id, app)).status,
      ).toBe(403);
    });
  });
}
