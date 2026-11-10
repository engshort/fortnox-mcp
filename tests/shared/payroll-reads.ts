import {
  PayrollInputs,
  type PayrollOperation,
  type StateStore,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxPayrollReads,
  payrollReadOperationIds,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { FortnoxPayrollTestEmployee } from "../../packages/fortnox/src/payroll-test-employee.js";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";
import { keyA } from "./connections.js";

async function setup(state: StateStore) {
  const f = await accountingFixture(state);
  for (const c of [f.a, f.b])
    await f.connections.mutate(f.actor.ownerId, c.id, (c) => {
      c.scopes.push("salary");
    });
  const requests: Array<{
    method: string;
    path: string;
    query: string;
    token: string;
  }> = [];
  const flags = {
    denied: false,
    active: true,
    noMeta: false,
    disconnect: false,
  };
  const provider = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const req = input as Request,
        url = new URL(req.url);
      requests.push({
        method: req.method,
        path: url.pathname,
        query: url.search,
        token: req.headers.get("authorization") ?? "",
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
      const employee = {
        EmployeeId: "SYNTHETIC",
        Inactive: false,
        EmploymentDate: "2025-01-01",
        PersonelType: "ARB",
        PersonalIdentityNumber: "SYNTHETIC_PRIVATE_ID",
        MonthlySalary: "99999.99",
        FullName: "SYNTHETIC_PRIVATE_NAME",
      };
      const row = {
        SalaryRow: 1,
        EmployeeId: "SYNTHETIC",
        Date: "2026-01-01",
        SalaryCode: "UNVERIFIED",
        Number: null,
        Amount: "",
        Total: "0.30",
        TextRow: null,
        CostCenter: "",
        Project: "",
        VAT: "0",
      };
      const meta = flags.noMeta
        ? {}
        : { MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 } };
      if (url.pathname === "/3/employees")
        return Response.json({ Employees: [employee], ...meta });
      if (url.pathname === "/3/employees/SYNTHETIC")
        return Response.json({ Employee: employee });
      if (url.pathname === "/3/salarytransactions")
        return Response.json({ SalaryTransactions: [row], ...meta });
      if (url.pathname === "/3/salarytransactions/1")
        return Response.json({ SalaryTransaction: row });
      return Response.json({}, { status: 404 });
    },
  });
  const adapter = new FortnoxPayrollReads(
    f.connections,
    provider,
    payrollReadOperationIds,
    () => flags.active,
  );
  const service = new PayrollInputs(
    f.connections,
    adapter,
    payrollReadOperationIds,
  );
  return { ...f, provider, adapter, service, requests, flags };
}
export function payrollReadContract(fixture: () => Promise<StateStore>) {
  describe("S09 finite payroll read transport", () => {
    it("provisions only a synthetic test employee through a single durable intent and exact readback", async () => {
      const f = await setup(await fixture());
      let row: Record<string, unknown> | null = null,
        posts = 0;
      f.provider.config.fetch = async (input) => {
        const req = input as Request;
        if (req.method === "POST") {
          posts++;
          row = ((await req.json()) as { Employee: Record<string, unknown> })
            .Employee;
          return Response.json({ Employee: row });
        }
        return row
          ? Response.json({ Employee: row })
          : Response.json({}, { status: 404 });
      };
      const service = new FortnoxPayrollTestEmployee(
        f.connections,
        f.provider,
        () => true,
      );
      const p = await service.writes.prepare(
        f.actor,
        f.a.id,
        "payroll_employee.create",
        {
          EmployeeId: "SYNM7ABC123",
          EmploymentDate: "2026-01-01",
          SalaryForm: "MAN",
        },
      );
      const results = await Promise.allSettled([
        service.writes.execute(f.actor, "payroll_employee.create", {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        }),
        service.writes.execute(f.actor, "payroll_employee.create", {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        }),
      ]);
      expect(posts).toBe(1);
      expect(
        results.some(
          (r) => r.status === "fulfilled" && r.value.state === "succeeded",
        ),
      ).toBe(true);
      expect(row).toMatchObject({
        FirstName: "Synthetic",
        LastName: "M7Test",
        Email: "synthetic-m7@example.invalid",
        Inactive: false,
        SalaryForm: "MAN",
      });
      expect(JSON.stringify(row)).not.toMatch(
        /PersonalIdentityNumber|BankAccountNo|MonthlySalary|HourlyPay/,
      );
      await expect(
        service.writes.prepare(f.actor, f.a.id, "payroll_employee.create", {
          EmployeeId: "REAL_PERSON",
          EmploymentDate: "2026-01-01",
        }),
      ).rejects.toThrow();
      await expect(
        service.writes.prepare(f.actor, f.a.id, "payroll_employee.create", {
          EmployeeId: "SYNM7ABC123",
          EmploymentDate: "2026-01-01",
        }),
      ).rejects.toThrow("PROPOSAL_STALE");
      expect(posts).toBe(1);
    });
    it("retains an uncertain test employee creation and never retries after a lost answer", async () => {
      const f = await setup(await fixture());
      let posts = 0;
      f.provider.config.fetch = async (input) => {
        if ((input as Request).method === "POST") {
          posts++;
          throw Error("synthetic response lost");
        }
        return Response.json({}, { status: 404 });
      };
      const service = new FortnoxPayrollTestEmployee(
        f.connections,
        f.provider,
        () => true,
      );
      const p = await service.writes.prepare(
        f.actor,
        f.a.id,
        "payroll_employee.create",
        { EmployeeId: "SYNM7ABC456", EmploymentDate: "2026-01-01" },
      );
      expect(
        await service.writes.execute(f.actor, "payroll_employee.create", {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        }),
      ).toMatchObject({
        state: "outcome_unknown",
        reference: "SYNM7ABC456",
      });
      expect(
        await service.writes.execute(f.actor, "payroll_employee.create", {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        }),
      ).toMatchObject({
        state: "outcome_unknown",
      });
      expect(
        await service.writes.reconcile(f.actor, "payroll_employee.create", {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        }),
      ).toMatchObject({
        state: "outcome_unknown",
      });
      expect(posts).toBe(1);
      await expect(
        service.writes.prepare(f.actor, f.a.id, "payroll_employee.create", {
          EmployeeId: "SYNM7ABC789",
          EmploymentDate: "2026-01-01",
        }),
      ).rejects.toThrow("OUTCOME_UNKNOWN");
    });

    it("reads only minimal employee references and independent nullable salary fields", async () => {
      const f = await setup(await fixture());
      const employees = await f.service.employees(f.actor, f.a.id);
      expect(employees).toMatchObject({
        complete: true,
        records: [
          {
            id: "SYNTHETIC",
            active: true,
            personel_type: "ARB",
            employment_from: "2025-01-01",
          },
        ],
      });
      expect(JSON.stringify(employees)).not.toContain("SYNTHETIC_PRIVATE");
      const detail = await f.service.employee(f.actor, f.a.id, "SYNTHETIC");
      expect(detail.record.version).toMatch(/^[a-f0-9]{64}$/);
      const rows = await f.service.list(f.actor, f.a.id, {
        employee_id: "SYNTHETIC",
        date: "2026-01-01",
      });
      expect(rows.records[0]).toMatchObject({
        id: "1",
        fields: { Number: null, Amount: "", Total: "0.30", TextRow: null },
        editable: false,
      });
      expect(f.requests.at(-1)?.query).toBe(
        "?employeeid=SYNTHETIC&date=2026-01-01&page=1&limit=100",
      );
      expect((await f.service.get(f.actor, f.a.id, "1")).record.id).toBe("1");
      expect(f.requests.every((r) => r.method === "GET")).toBe(true);
      expect(
        (await f.adapter.references(f.actor, f.a.id, "SYNTHETIC", "2026-01-01"))
          .verified_actions,
      ).toEqual([]);
    });
    it("keeps missing pagination partial and rejects unclassified write activation", async () => {
      const f = await setup(await fixture());
      f.flags.noMeta = true;
      expect((await f.service.employees(f.actor, f.a.id)).complete).toBe(false);
      expect(
        () =>
          new FortnoxPayrollReads(
            f.connections,
            f.provider,
            ["salary_transaction.create"],
            () => true,
          ),
      ).toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        f.adapter.write(
          f.actor,
          f.a.id,
          "create",
          null,
          {
            EmployeeId: "SYNTHETIC",
            Date: "2026-01-01",
            SalaryCode: "UNVERIFIED",
            Number: "1",
            Amount: "0.30",
            Total: "0.30",
          },
          null,
          async () => {
            throw new Error("must not dispatch");
          },
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.requests).toHaveLength(1);
    });
    it("checks company/grant/scope/program and the active test lease before any provider read", async () => {
      const f = await setup(await fixture());
      await expect(
        f.service.employees({ ...f.actor, scopes: [] }, f.a.id),
      ).rejects.toThrow("AUTH_REQUIRED");
      await expect(
        f.service.employees(f.actor, crypto.randomUUID()),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      f.flags.active = false;
      await expect(f.service.employees(f.actor, f.a.id)).rejects.toThrow();
      f.flags.active = true;
      await f.connections.disableProgram(f.actor.ownerId, f.a.id, "payroll", 0);
      await expect(f.service.employees(f.actor, f.a.id)).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      expect(f.requests).toHaveLength(0);
    });
    it("sanitizes provider rights failures and discards a response after disconnect", async () => {
      const f = await setup(await fixture());
      f.flags.denied = true;
      await expect(f.service.employees(f.actor, f.a.id)).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      f.flags.denied = false;
      f.flags.disconnect = true;
      await expect(f.service.employees(f.actor, f.a.id)).rejects.toThrow();
      expect(f.requests).toHaveLength(2);
    });
    it("exposes exactly four strict SDK read tools and no payroll writes or payout", async () => {
      const f = await setup(await fixture());
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider: f.provider,
        testMode: true,
        payroll: f.service,
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client({
        name: "synthetic-payroll-client",
        version: "1",
      });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const list = await client.listTools();
        const tools = list.tools.filter((t) => /payroll|salary/.test(t.name));
        expect(tools.map((t) => t.name).sort()).toEqual([
          "get_payroll_employee",
          "get_salary_transaction",
          "list_payroll_employees",
          "list_salary_transactions",
        ]);
        expect(
          tools.every(
            (t) =>
              t.annotations?.readOnlyHint === true &&
              t.annotations?.destructiveHint === false,
          ),
        ).toBe(true);
        const result = await client.callTool({
          name: "list_payroll_employees",
          arguments: { company_id: f.a.id },
        });
        expect(result.structuredContent).toMatchObject({
          status: "ok",
          data: { complete: true, records: [{ id: "SYNTHETIC" }] },
        });
        const denied = await client.callTool({
          name: "get_salary_transaction",
          arguments: { company_id: crypto.randomUUID(), salary_row: "1" },
        });
        expect(denied.isError).toBe(true);
        expect(JSON.stringify(denied)).toContain("COMPANY_FORBIDDEN");
        const invalid = await client.callTool({
          name: "list_salary_transactions",
          arguments: {
            company_id: f.a.id,
            employee_id: "SYNTHETIC",
            date: "2026-01-01",
            url: "https://forbidden.invalid",
          },
        });
        expect(invalid.isError).toBe(true);
        expect(f.requests).toHaveLength(1);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
}
export function payrollReadProfileContract(fixture: () => Promise<AuthConfig>) {
  it("rejects duplicate or write operation IDs in the isolated payroll read profile", async () => {
    const config = await fixture();
    const settings = {
      origin: config.origin,
      secret: config.secret,
      keys: { a: keyA },
      activeKey: "a",
      redirects: ["https://client.example.invalid/callback"],
      testMode: true,
      testTenants: ["100001", "100002"],
      clientId: "",
      clientSecret: "",
    };
    for (const payrollReads of [
      ["salary_transaction.create"],
      ["payroll_employee.list", "payroll_employee.list"],
    ] as PayrollOperation[][])
      expect(() =>
        createProductApplication(
          settings,
          config,
          async () => {
            throw new Error("must not call provider");
          },
          undefined,
          {
            sourceCommit: "a".repeat(40),
            until: Date.now() + 60000,
            operations: ["customer.list"],
            payrollReads,
          },
        ),
      ).toThrow("CAPABILITY_UNAVAILABLE");
  });
}
