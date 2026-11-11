import {
  accountingHash,
  type BusinessReference,
  PayrollInputs,
  type PayrollProvider,
  type PayrollRecord,
  type PayrollReferences,
  payrollOperationIds,
  type SalaryTransactionFields,
  type StateStore,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { accountingFixture } from "./accounting.js";

const fields = (): SalaryTransactionFields => ({
  EmployeeId: "SYNTHETIC",
  Date: "2026-01-01",
  SalaryCode: "SYNTHETIC",
  Number: "1",
  Amount: "123.45",
  Total: "123.45",
  TextRow: "SYNTHETIC_PRIVATE_PAYROLL_TEXT",
});
const reference = (p: BusinessReference): BusinessReference => ({
  company_id: p.company_id,
  proposal_id: p.proposal_id,
  proposal_hash: p.proposal_hash,
});
async function setup(state: StateStore) {
  const f = await accountingFixture(state);
  for (const c of [f.a, f.b])
    await f.connections.mutate(f.actor.ownerId, c.id, (c) => {
      c.scopes.push("salary");
    });
  const records = new Map<string, PayrollRecord>();
  const refs: PayrollReferences = {
    company_id: f.a.id,
    retrieved_at: Date.now(),
    complete: true,
    license_verified: true,
    verified_actions: ["create", "update", "delete"],
    employees: [
      { id: "SYNTHETIC", active: true, from: "2025-01-01", to: null },
    ],
    codes: [
      {
        employee_id: "SYNTHETIC",
        code: "SYNTHETIC",
        from: "2025-01-01",
        to: "2026-12-31",
        profile: "quantity_times_unit_amount",
        quantity_scale: 2,
        evidence_sha256: "a".repeat(64),
      },
    ],
  };
  let calls = 0;
  const flags = { lost: false, knownReference: false, disconnect: false };
  const provider: PayrollProvider = {
    employee: async (_actor, _company, id) => ({
      id,
      active: true,
      employment_from: "2025-01-01",
      personel_type: "ARB",
      version: "a".repeat(64),
    }),
    employees: async () => ({
      records: [
        {
          id: "SYNTHETIC",
          active: true,
          employment_from: "2025-01-01",
          personel_type: "ARB",
          version: "a".repeat(64),
        },
      ],
      complete: true,
      next_page: null,
    }),
    references: async () => ({ ...refs, retrieved_at: Date.now() }),
    get: async (_actor, company, id) => {
      const r = records.get(`${company}:${id}`);
      if (!r) throw new Error("synthetic_not_found");
      return structuredClone(r);
    },
    page: async (_actor, company, filter) => ({
      records: [...records]
        .filter(
          ([key, v]) =>
            key.startsWith(`${company}:`) &&
            v.fields.EmployeeId === filter.employee_id &&
            v.fields.Date === filter.date,
        )
        .map(([, v]) => structuredClone(v)),
      complete: true,
      next_page: null,
    }),
    write: async (_actor, company, action, id, input, _baseline, before) => {
      await before();
      calls++;
      const number = id ?? String(calls);
      if (action === "delete") records.delete(`${company}:${number}`);
      else
        records.set(`${company}:${number}`, {
          id: number,
          fields: input,
          version: await accountingHash({ input, calls }),
          editable: true,
        });
      if (flags.disconnect)
        await f.connections.disconnect(f.actor.ownerId, company);
      if (flags.lost) {
        if (flags.knownReference)
          return { state: "outcome_unknown", reference: number };
        throw new Error("synthetic lost write response");
      }
      return { state: "succeeded", reference: number };
    },
  };
  const service = new PayrollInputs(
    f.connections,
    provider,
    payrollOperationIds,
  );
  return {
    ...f,
    service,
    provider,
    records,
    refs,
    flags,
    calls: () => calls,
    input: () => ({ company_id: f.a.id, fields: fields() }),
  };
}
export function payrollContract(fixture: () => Promise<StateStore>) {
  describe("S09 bounded salary transaction input", () => {
    it("creates, reads, updates with a complete diff and deletes a synthetic payroll input", async () => {
      const f = await setup(await fixture());
      const p = await f.service.prepare(f.actor, "create", f.input());
      expect(p.preview).toMatchObject({
        effect: "payroll_input_only",
        after: { Amount: "123.45", Number: "1.00", Total: "123.45" },
      });
      const created = await f.service.writes.execute(
        f.actor,
        "salary_transaction.create",
        reference(p),
      );
      expect(created).toMatchObject({ state: "succeeded", reference: "1" });
      const current = (await f.service.get(f.actor, f.a.id, "1")).record;
      const update = await f.service.prepare(f.actor, "update", {
        ...f.input(),
        id: "1",
        expected_version: current.version,
        fields: { ...fields(), Amount: "124.45", Total: "124.45" },
      });
      expect(update.preview).toMatchObject({
        diff: expect.arrayContaining([
          { field: "Amount", before: "123.45", after: "124.45" },
        ]),
      });
      await f.service.writes.execute(
        f.actor,
        "salary_transaction.update",
        reference(update),
      );
      const list = await f.service.list(f.actor, f.a.id, {
        employee_id: "SYNTHETIC",
        date: "2026-01-01",
      });
      expect(list.records[0]?.fields.Total).toBe("124.45");
      const latest = (await f.service.get(f.actor, f.a.id, "1")).record;
      const remove = await f.service.prepare(f.actor, "delete", {
        company_id: f.a.id,
        id: "1",
        expected_version: latest.version,
      });
      await f.service.writes.execute(
        f.actor,
        "salary_transaction.delete",
        reference(remove),
      );
      expect(
        (
          await f.service.list(f.actor, f.a.id, {
            employee_id: "SYNTHETIC",
            date: "2026-01-01",
          })
        ).records,
      ).toEqual([]);
      expect(f.calls()).toBe(3);
      expect(
        JSON.stringify(await f.state.get("connections", f.actor.ownerId)),
      ).not.toContain("SYNTHETIC_PRIVATE_PAYROLL_TEXT");
    });
    it("requires independent company employee/code/rights/license evidence before preparation", async () => {
      const f = await setup(await fixture());
      for (const failure of [
        "permission",
        "employee",
        "code",
        "company",
        "profile",
      ]) {
        const original = structuredClone(f.refs);
        if (failure === "permission") f.refs.verified_actions = [];
        if (failure === "employee") f.refs.employees = [];
        if (failure === "code") f.refs.codes = [];
        if (failure === "company") f.refs.company_id = f.b.id;
        if (failure === "profile")
          f.refs.codes = f.refs.codes.map((c) => ({
            ...c,
            evidence_sha256: "",
          }));
        await expect(
          f.service.prepare(f.actor, "create", f.input()),
        ).rejects.toThrow();
        Object.assign(f.refs, original);
      }
      for (const invalid of [
        { ...fields(), Amount: "NaN" },
        { ...fields(), Total: "123.451" },
        { ...fields(), Number: "2" },
        { ...fields(), Date: "2026-02-30" },
        { ...fields(), EmployeeId: "FOREIGN" },
        { ...fields(), payout: true },
      ])
        await expect(
          f.service.prepare(f.actor, "create", {
            ...f.input(),
            fields: invalid,
          }),
        ).rejects.toThrow();
      expect(f.calls()).toBe(0);
    });
    it("requires new preparation on changed source and revalidates references at execution", async () => {
      const f = await setup(await fixture());
      const create = await f.service.prepare(f.actor, "create", f.input());
      await f.service.writes.execute(
        f.actor,
        "salary_transaction.create",
        reference(create),
      );
      const source = (await f.service.get(f.actor, f.a.id, "1")).record;
      const p = await f.service.prepare(f.actor, "update", {
        ...f.input(),
        id: "1",
        expected_version: source.version,
      });
      f.records.set(`${f.a.id}:1`, { ...source, version: "b".repeat(64) });
      await expect(
        f.service.writes.execute(
          f.actor,
          "salary_transaction.update",
          reference(p),
        ),
      ).rejects.toThrow("PROPOSAL_STALE");
      const fresh = await f.service.prepare(f.actor, "create", f.input());
      f.refs.verified_actions = [];
      await expect(
        f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          reference(fresh),
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.calls()).toBe(1);
    });
    it("requires preparation again after the verified code profile changes without changing the proposed values", async () => {
      const f = await setup(await fixture());
      const prepared = await f.service.prepare(f.actor, "create", f.input());
      f.refs.codes = f.refs.codes.map((c) => ({
        ...c,
        evidence_sha256: "b".repeat(64),
      }));
      await expect(
        f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          reference(prepared),
        ),
      ).rejects.toThrow("PROPOSAL_STALE");
      expect(f.calls()).toBe(0);
      const fresh = await f.service.prepare(f.actor, "create", f.input());
      expect(
        (
          await f.service.writes.execute(
            f.actor,
            "salary_transaction.create",
            reference(fresh),
          )
        ).state,
      ).toBe("succeeded");
      expect(f.calls()).toBe(1);
    });
    it("uses one durable intent for concurrent/replayed calls and never resends a lost create", async () => {
      const f = await setup(await fixture());
      f.flags.lost = true;
      const p = await f.service.prepare(f.actor, "create", f.input());
      const results = await Promise.allSettled([
        f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          reference(p),
        ),
        f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          reference(p),
        ),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      expect(f.calls()).toBe(1);
      expect(
        (
          await f.service.writes.execute(
            f.actor,
            "salary_transaction.create",
            reference(p),
          )
        ).state,
      ).toBe("outcome_unknown");
      expect(
        (
          await f.service.writes.reconcile(
            f.actor,
            "salary_transaction.create",
            reference(p),
          )
        ).state,
      ).toBe("outcome_unknown");
      await expect(
        f.service.prepare(f.actor, "create", f.input()),
      ).rejects.toThrow("OUTCOME_UNKNOWN");
      expect(f.calls()).toBe(1);
    });
    it("reconciles only an exact retained provider identity after process restart", async () => {
      const f = await setup(await fixture());
      f.flags.lost = true;
      f.flags.knownReference = true;
      const p = await f.service.prepare(f.actor, "create", f.input());
      expect(
        (
          await f.service.writes.execute(
            f.actor,
            "salary_transaction.create",
            reference(p),
          )
        ).state,
      ).toBe("outcome_unknown");
      const restarted = new PayrollInputs(
        f.connections,
        f.provider,
        payrollOperationIds,
      );
      expect(
        (
          await restarted.writes.reconcile(
            f.actor,
            "salary_transaction.create",
            reference(p),
          )
        ).state,
      ).toBe("succeeded");
      expect(f.calls()).toBe(1);
    });
    it("blocks read-only, revoked grants, restore intervals and unclassified full payroll actions", async () => {
      const f = await setup(await fixture());
      const disabled = new PayrollInputs(f.connections, f.provider);
      await expect(
        disabled.prepare(f.actor, "create", f.input()),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        f.service.get({ ...f.actor, scopes: [] }, f.a.id, "1"),
      ).rejects.toThrow("AUTH_REQUIRED");
      await expect(
        f.service.prepare(f.actor, "create", {
          ...f.input(),
          company_id: crypto.randomUUID(),
        }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await f.state.put("installation", "restore", { reconciled: false }, null);
      await expect(
        f.service.prepare(f.actor, "create", f.input()),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(
        payrollOperationIds.every(
          (v) =>
            v.startsWith("salary_transaction.") ||
            v.startsWith("payroll_employee."),
        ),
      ).toBe(true);
      expect(payrollOperationIds).not.toContain("payroll.run");
      expect(payrollOperationIds).not.toContain("payout.create");
      expect(f.calls()).toBe(0);
    });
  });
}
