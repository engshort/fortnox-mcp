import {
  accountingHash,
  type BusinessReference,
  PayrollInputs,
  type PayrollOperation,
  payrollOperationIds,
  type StateStore,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxPayrollWrites,
  payrollReadOperationIds,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { FortnoxPayrollMaintenanceProbe } from "../../packages/fortnox/src/payroll-maintenance-probe.js";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";

const fields = {
  EmployeeId: "SYNM7ABC123",
  Date: "2026-11-10",
  SalaryCode: "11",
  Number: "1",
  Amount: "0.01",
  Total: "0.01",
  TextRow: "SYNTHETIC M7 MCP INPUT",
};
const ref = (p: BusinessReference) => ({
  company_id: p.company_id,
  proposal_id: p.proposal_id,
  proposal_hash: p.proposal_hash,
});
async function setup(
  state: StateStore,
  enabled: readonly PayrollOperation[] = payrollOperationIds,
  deleteStatus: 200 | 204 = 200,
) {
  const f = await accountingFixture(state);
  await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
    c.scopes.push("salary");
  });
  const rows = new Map<string, Record<string, unknown>>();
  const flags = {
    wage: "0.01",
    inactive: false,
    deny: false,
    lost: "",
    wrongId: false,
    extra: false,
    numericDifference: false,
    deleteStatus: deleteStatus as number,
    blockDeleteReadback: false,
    deleteBody: "",
  };
  const calls: string[] = [];
  let seq = 0;
  const provider = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const req = input as Request,
        url = new URL(req.url);
      calls.push(req.method);
      if (flags.deny) return Response.json({}, { status: 403 });
      if (url.pathname.startsWith("/3/employees/"))
        return Response.json({
          Employee: {
            EmployeeId: fields.EmployeeId,
            Inactive: flags.inactive,
            EmploymentDate: "2025-01-01",
            EmployedTo: null,
            PersonelType: "TJM",
            SalaryForm: "TIM",
            HourlyPay: flags.wage,
            DatedWages: [{ FirstDay: "1970-01-01", HourlyPay: flags.wage }],
          },
        });
      const id = url.pathname.split("/")[3];
      if (req.method === "POST" || req.method === "PUT") {
        const selected = (
          (await req.json()) as { SalaryTransaction: Record<string, unknown> }
        ).SalaryTransaction;
        const key = id ?? String(++seq);
        const row = {
          ...selected,
          SalaryRow: key,
          ...(flags.numericDifference ? { Amount: "0", Total: "0" } : {}),
        };
        rows.set(key, row);
        if (flags.lost === req.method) throw Error("synthetic lost response");
        return Response.json({
          SalaryTransaction: { ...row, SalaryRow: flags.wrongId ? "99" : key },
        });
      }
      if (req.method === "DELETE") {
        rows.delete(id ?? "");
        if (flags.blockDeleteReadback) flags.deny = true;
        if (flags.lost === "DELETE") throw Error("synthetic lost response");
        return new Response(flags.deleteBody || null, {
          status: flags.deleteStatus,
        });
      }
      if (id)
        return rows.has(id)
          ? Response.json({
              SalaryTransaction: {
                ...rows.get(id),
                ...(flags.extra ? { Project: "EXTRA" } : {}),
              },
            })
          : Response.json({}, { status: 404 });
      return Response.json({
        SalaryTransactions: [...rows.values()],
        MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 },
      });
    },
  });
  const profile = {
    company_id: f.a.id,
    employee_id: fields.EmployeeId,
    code: "11" as const,
    from: fields.Date,
    to: fields.Date,
    hourly_pay: "0.01",
    quantity_scale: 0,
    delete_status: deleteStatus,
    evidence: {
      create: "a".repeat(64),
      update: "b".repeat(64),
      delete: "c".repeat(64),
    },
  };
  const adapter = new FortnoxPayrollWrites(
    f.connections,
    provider,
    [profile],
    enabled,
    () => true,
  );
  const service = new PayrollInputs(f.connections, adapter, enabled);
  return { ...f, provider, adapter, service, flags, calls, rows, profile };
}
export function payrollWriteContract(fixture: () => Promise<StateStore>) {
  describe("S09 verified-profile payroll writes", () => {
    it("uses current provider wages without private acceptance profiles and preserves exact amount validation", async () => {
      const f = await setup(await fixture());
      const adapter = new FortnoxPayrollWrites(
        f.connections,
        f.provider,
        [],
        payrollOperationIds,
        () => true,
        Date.now,
        true,
      );
      const service = new PayrollInputs(
        f.connections,
        adapter,
        payrollOperationIds,
      );
      const references = await adapter.references(
        f.actor,
        f.a.id,
        fields.EmployeeId,
        fields.Date,
      );
      expect(references.license_verified).toBe(false);
      expect(references.verified_actions).toEqual([]);
      const p = await service.prepare(f.actor, "create", {
        company_id: f.a.id,
        fields,
      });
      expect(
        (
          await service.writes.execute(
            f.actor,
            "salary_transaction.create",
            ref(p),
          )
        ).state,
      ).toBe("succeeded");
      await expect(
        service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields: { ...fields, Amount: "0.02", Total: "0.02" },
        }),
      ).rejects.toThrow("VALIDATION_FAILED");
      const current = await service.get(f.actor, f.a.id, "1");
      const deletion = await service.prepare(f.actor, "delete", {
        company_id: f.a.id,
        id: "1",
        expected_version: current.record.version,
      });
      expect(
        (
          await service.writes.execute(
            f.actor,
            "salary_transaction.delete",
            ref(deletion),
          )
        ).state,
      ).toBe("succeeded");
    });
    for (const bodyKind of ["null", "string", "error"] as const)
      it(`uses the documented DELETE status without inventing an empty-body requirement (error envelope: ${bodyKind})`, async () => {
        const f = await setup(await fixture());
        const errorEnvelope = bodyKind === "error";
        const p = await f.service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields,
        });
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          ref(p),
        );
        const current = await f.service.get(f.actor, f.a.id, "1");
        const d = await f.service.prepare(f.actor, "delete", {
          company_id: f.a.id,
          id: "1",
          expected_version: current.record.version,
        });
        f.flags.deleteBody = errorEnvelope
          ? JSON.stringify({ ErrorInformation: { Code: "SYNTHETIC" } })
          : bodyKind === "string"
            ? JSON.stringify("Synthetic delete acknowledgement")
            : "null";
        expect(
          (
            await f.service.writes.execute(
              f.actor,
              "salary_transaction.delete",
              ref(d),
            )
          ).state,
        ).toBe(errorEnvelope ? "outcome_unknown" : "succeeded");
        expect(f.calls.filter((c) => c === "DELETE")).toHaveLength(1);
      });
    it("reconciles a retained final response and exact absence, never absence alone or a different intent", async () => {
      const f = await setup(await fixture(), [
        ...payrollReadOperationIds,
        "salary_transaction.create",
      ]);
      const created = await f.service.prepare(f.actor, "create", {
        company_id: f.a.id,
        fields,
      });
      await f.service.writes.execute(
        f.actor,
        "salary_transaction.create",
        ref(created),
      );
      const update = new FortnoxPayrollMaintenanceProbe(
        f.connections,
        f.provider,
        f.adapter,
        ref(created),
        "update",
        () => true,
      );
      const u = await update.writes.prepare(
        f.actor,
        f.a.id,
        "salary_transaction.update",
        {},
      );
      await update.writes.execute(f.actor, "salary_transaction.update", ref(u));
      const cleanup = (
        proof?: ConstructorParameters<typeof FortnoxPayrollMaintenanceProbe>[7],
      ) =>
        new FortnoxPayrollMaintenanceProbe(
          f.connections,
          f.provider,
          f.adapter,
          ref(u),
          "delete",
          () => true,
          Date.now,
          proof,
        );
      const d = await cleanup().writes.prepare(
        f.actor,
        f.a.id,
        "salary_transaction.delete",
        {},
      );
      f.flags.blockDeleteReadback = true;
      expect(
        (
          await cleanup().writes.execute(
            f.actor,
            "salary_transaction.delete",
            ref(d),
          )
        ).state,
      ).toBe("outcome_unknown");
      f.flags.deny = false;
      expect(
        (
          await cleanup().writes.reconcile(
            f.actor,
            "salary_transaction.delete",
            ref(d),
          )
        ).state,
      ).toBe("outcome_unknown");
      const proof = {
        intent_id: d.proposal_id,
        proposal_hash: d.proposal_hash,
        status: 200 as const,
        receipt_sha256: await accountingHash({
          status: 200,
          method: "DELETE",
          intent: ref(d),
        }),
      };
      expect(
        (
          await cleanup({
            ...proof,
            proposal_hash: "0".repeat(64),
          }).writes.reconcile(f.actor, "salary_transaction.delete", ref(d))
        ).state,
      ).toBe("outcome_unknown");
      expect(
        (
          await cleanup(proof).writes.reconcile(
            f.actor,
            "salary_transaction.delete",
            ref(d),
          )
        ).state,
      ).toBe("succeeded");
      expect(f.calls.filter((c) => c === "DELETE")).toHaveLength(1);
    });
    for (const status of [200, 204, 202] as const)
      it(`requires a verified final deletion acknowledgement (${status}) before accepting absence`, async () => {
        const f = await setup(
          await fixture(),
          payrollOperationIds,
          status === 204 ? 204 : 200,
        );
        const p = await f.service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields,
        });
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          ref(p),
        );
        const current = await f.service.get(f.actor, f.a.id, "1");
        const d = await f.service.prepare(f.actor, "delete", {
          company_id: f.a.id,
          id: "1",
          expected_version: current.record.version,
        });
        f.flags.deleteStatus = status;
        expect(
          (
            await f.service.writes.execute(
              f.actor,
              "salary_transaction.delete",
              ref(d),
            )
          ).state,
        ).toBe(status === 202 ? "outcome_unknown" : "succeeded");
        expect(
          (
            await f.service.writes.execute(
              f.actor,
              "salary_transaction.delete",
              ref(d),
            )
          ).state,
        ).toBe(status === 202 ? "outcome_unknown" : "succeeded");
        expect(f.calls.filter((c) => c === "DELETE")).toHaveLength(1);
      });
    for (const lostAck of [false, true])
      it(`probes update/delete only from retained synthetic intents (lost acknowledgement: ${lostAck})`, async () => {
        const f = await setup(await fixture(), [
          ...payrollReadOperationIds,
          "salary_transaction.create",
        ]);
        const p = await f.service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields,
        });
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          ref(p),
        );
        const invalid = new FortnoxPayrollMaintenanceProbe(
          f.connections,
          f.provider,
          f.adapter,
          { ...ref(p), proposal_hash: "0".repeat(64) },
          "update",
          () => true,
        );
        await expect(
          invalid.writes.prepare(
            f.actor,
            f.a.id,
            "salary_transaction.update",
            {},
          ),
        ).rejects.toThrow("PROPOSAL_STALE");
        expect(
          (await f.service.get(f.actor, f.a.id, "1")).record.editable,
        ).toBe(false);
        const probe = new FortnoxPayrollMaintenanceProbe(
          f.connections,
          f.provider,
          f.adapter,
          ref(p),
          "update",
          () => true,
        );
        const u = await probe.writes.prepare(
          f.actor,
          f.a.id,
          "salary_transaction.update",
          {},
        );
        expect(u.preview).toMatchObject({
          after: { Number: "3", Amount: "0.01", Total: "0.03" },
        });
        expect(
          (
            await probe.writes.execute(
              f.actor,
              "salary_transaction.update",
              ref(u),
            )
          ).state,
        ).toBe("succeeded");
        expect(
          (
            await probe.writes.execute(
              f.actor,
              "salary_transaction.update",
              ref(u),
            )
          ).state,
        ).toBe("succeeded");
        const cleanup = new FortnoxPayrollMaintenanceProbe(
          f.connections,
          f.provider,
          f.adapter,
          ref(u),
          "delete",
          () => true,
        );
        const d = await cleanup.writes.prepare(
          f.actor,
          f.a.id,
          "salary_transaction.delete",
          {},
        );
        f.flags.lost = lostAck ? "DELETE" : "";
        expect(
          (
            await cleanup.writes.execute(
              f.actor,
              "salary_transaction.delete",
              ref(d),
            )
          ).state,
        ).toBe(lostAck ? "outcome_unknown" : "succeeded");
        expect(
          (
            await cleanup.writes.execute(
              f.actor,
              "salary_transaction.delete",
              ref(d),
            )
          ).state,
        ).toBe(lostAck ? "outcome_unknown" : "succeeded");
        if (lostAck)
          expect(
            (
              await cleanup.writes.reconcile(
                f.actor,
                "salary_transaction.delete",
                ref(d),
              )
            ).state,
          ).toBe("outcome_unknown");
        expect(f.calls.filter((c) => c !== "GET")).toEqual([
          "POST",
          "PUT",
          "DELETE",
        ]);
        expect(f.service.enabled).not.toContain("salary_transaction.update");
        expect(f.service.enabled).not.toContain("salary_transaction.delete");
      });
    it("retains acknowledged numeric differences without claiming intended success", async () => {
      const f = await setup(await fixture());
      const p = await f.service.prepare(f.actor, "create", {
        company_id: f.a.id,
        fields,
      });
      f.flags.numericDifference = true;
      expect(
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          ref(p),
        ),
      ).toMatchObject({
        state: "applied_different",
        reference: "1",
        difference: { fields: ["Amount", "Total"] },
      });
      expect(
        (
          await f.service.writes.execute(
            f.actor,
            "salary_transaction.create",
            ref(p),
          )
        ).state,
      ).toBe("applied_different");
      expect(f.calls.filter((c) => c === "POST")).toHaveLength(1);
    });
    it("requires separate action evidence, a matching company profile and current write rights", async () => {
      const f = await setup(await fixture());
      expect(
        () =>
          new FortnoxPayrollWrites(
            f.connections,
            f.provider,
            [{ ...f.profile, evidence: { create: "a".repeat(64) } }],
            payrollOperationIds,
            () => true,
          ),
      ).toThrow("CAPABILITY_UNAVAILABLE");
      const wrong = new FortnoxPayrollWrites(
        f.connections,
        f.provider,
        [{ ...f.profile, company_id: crypto.randomUUID() }],
        payrollOperationIds,
        () => true,
      );
      await expect(
        wrong.references(f.actor, f.a.id, fields.EmployeeId, fields.Date),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        f.service.prepare({ ...f.actor, scopes: ["mcp:read"] }, "create", {
          company_id: f.a.id,
          fields,
        }),
      ).rejects.toThrow("AUTH_REQUIRED");
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.readOnly = true;
      });
      await expect(
        f.service.prepare(f.actor, "create", { company_id: f.a.id, fields }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.calls).toEqual([]);
    });
    it("retains the original update target when the response claims a different identity", async () => {
      const f = await setup(await fixture());
      const p = await f.service.prepare(f.actor, "create", {
        company_id: f.a.id,
        fields,
      });
      await f.service.writes.execute(
        f.actor,
        "salary_transaction.create",
        ref(p),
      );
      const current = await f.service.get(f.actor, f.a.id, "1");
      const u = await f.service.prepare(f.actor, "update", {
        company_id: f.a.id,
        id: "1",
        expected_version: current.record.version,
        fields: { ...fields, Number: "2", Total: "0.02" },
      });
      f.flags.wrongId = true;
      expect(
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.update",
          ref(u),
        ),
      ).toEqual({ state: "outcome_unknown", reference: "1" });
      expect(
        await f.service.writes.reconcile(
          f.actor,
          "salary_transaction.update",
          ref(u),
        ),
      ).toEqual({ state: "succeeded", reference: "1" });
      expect(f.calls.filter((c) => c === "PUT")).toHaveLength(1);
    });
    it("creates, fully previews an update and deletes one exact row without replay", async () => {
      const f = await setup(await fixture());
      const p = await f.service.prepare(f.actor, "create", {
        company_id: f.a.id,
        fields,
      });
      expect(
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          ref(p),
        ),
      ).toEqual({ state: "succeeded", reference: "1" });
      expect(
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.create",
          ref(p),
        ),
      ).toMatchObject({ state: "succeeded" });
      const current = await f.service.get(f.actor, f.a.id, "1");
      const u = await f.service.prepare(f.actor, "update", {
        company_id: f.a.id,
        id: "1",
        expected_version: current.record.version,
        fields: { ...fields, Number: "2", Total: "0.02" },
      });
      expect(u.preview).toMatchObject({
        before: fields,
        after: { Number: "2", Total: "0.02" },
        diff: expect.arrayContaining([
          { field: "Number", before: "1", after: "2" },
        ]),
      });
      expect(
        (
          await f.service.writes.execute(
            f.actor,
            "salary_transaction.update",
            ref(u),
          )
        ).state,
      ).toBe("succeeded");
      const updated = await f.service.get(f.actor, f.a.id, "1");
      const d = await f.service.prepare(f.actor, "delete", {
        company_id: f.a.id,
        id: "1",
        expected_version: updated.record.version,
      });
      expect(d.preview).toMatchObject({ before: { Number: "2" }, after: null });
      expect(
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.delete",
          ref(d),
        ),
      ).toEqual({ state: "succeeded", reference: "1" });
      expect(
        await f.service.writes.execute(
          f.actor,
          "salary_transaction.delete",
          ref(d),
        ),
      ).toMatchObject({ state: "succeeded" });
      expect(f.calls.filter((c) => c !== "GET")).toEqual([
        "POST",
        "PUT",
        "DELETE",
      ]);
    });
    it("rechecks wage, profile, employment, source version and ancillary fields before dispatch", async () => {
      const f = await setup(await fixture());
      await expect(
        f.service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields: { ...fields, Amount: "0.02", Total: "0.02" },
        }),
      ).rejects.toThrow("VALIDATION_FAILED");
      await expect(
        f.service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields: { ...fields, SalaryCode: "12" },
        }),
      ).rejects.toThrow("VALIDATION_FAILED");
      await expect(
        f.service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields: { ...fields, Number: "1.5", Total: "0.015" },
        }),
      ).rejects.toThrow("VALIDATION_FAILED");
      const p = await f.service.prepare(f.actor, "create", {
        company_id: f.a.id,
        fields,
      });
      f.flags.wage = "0.02";
      await expect(
        f.service.writes.execute(f.actor, "salary_transaction.create", ref(p)),
      ).rejects.toThrow("PROPOSAL_STALE");
      f.flags.wage = "0.01";
      f.flags.inactive = true;
      await expect(
        f.service.writes.execute(f.actor, "salary_transaction.create", ref(p)),
      ).rejects.toThrow("VALIDATION_FAILED");
      f.flags.inactive = false;
      await f.service.writes.execute(
        f.actor,
        "salary_transaction.create",
        ref(p),
      );
      const current = await f.service.get(f.actor, f.a.id, "1");
      const u = await f.service.prepare(f.actor, "update", {
        company_id: f.a.id,
        id: "1",
        expected_version: current.record.version,
        fields,
      });
      const changed = f.rows.get("1");
      if (!changed) throw new Error("Synthetic row missing");
      changed.TextRow = "Externally changed";
      await expect(
        f.service.writes.execute(f.actor, "salary_transaction.update", ref(u)),
      ).rejects.toThrow("PROPOSAL_STALE");
      f.flags.extra = true;
      await expect(f.service.get(f.actor, f.a.id, "1")).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      expect(f.calls.filter((c) => c !== "GET")).toEqual(["POST"]);
    });
    for (const action of ["POST", "DELETE"])
      it(`retains a lost ${action} acknowledgement and never infers delivery from absence`, async () => {
        const f = await setup(await fixture());
        const p = await f.service.prepare(f.actor, "create", {
          company_id: f.a.id,
          fields,
        });
        if (action === "POST") f.flags.lost = action;
        let reference = ref(p),
          op = "salary_transaction.create";
        await f.service.writes.execute(f.actor, op, reference);
        if (action === "DELETE") {
          const current = await f.service.get(f.actor, f.a.id, "1");
          reference = ref(
            await f.service.prepare(f.actor, "delete", {
              company_id: f.a.id,
              id: "1",
              expected_version: current.record.version,
            }),
          );
          op = "salary_transaction.delete";
          f.flags.lost = action;
          await f.service.writes.execute(f.actor, op, reference);
        }
        expect(
          (await f.service.writes.execute(f.actor, op, reference)).state,
        ).toBe("outcome_unknown");
        expect(
          (await f.service.writes.reconcile(f.actor, op, reference)).state,
        ).toBe("outcome_unknown");
        expect(f.calls.filter((c) => c === action)).toHaveLength(1);
      });
    it("advertises only explicitly enabled effects and validates a real strict MCP write round trip", async () => {
      const f = await setup(await fixture(), [
        ...payrollReadOperationIds,
        "salary_transaction.create",
      ]);
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider: f.provider,
        testMode: true,
        payroll: f.service,
      });
      const client = new Client({ name: "synthetic-payroll", version: "1" });
      try {
        await server.connect(st);
        await client.connect(ct);
        const tools = (await client.listTools()).tools;
        expect(tools.some((t) => t.name === "update_salary_transaction")).toBe(
          false,
        );
        expect(
          tools.find((t) => t.name === "prepare_salary_transaction_create")
            ?.annotations,
        ).toMatchObject({ readOnlyHint: false, idempotentHint: false });
        expect(
          tools.find((t) => t.name === "create_salary_transaction")
            ?.annotations,
        ).toMatchObject({ readOnlyHint: false, idempotentHint: true });
        const prepared = await client.callTool({
          name: "prepare_salary_transaction_create",
          arguments: { company_id: f.a.id, fields },
        });
        const value = prepared.structuredContent as {
          status: string;
          data: BusinessReference;
        };
        expect(value.status).toBe("ok");
        expect(
          (
            await client.callTool({
              name: "create_salary_transaction",
              arguments: ref(value.data),
            })
          ).structuredContent,
        ).toMatchObject({ status: "ok", data: { state: "succeeded" } });
        expect(
          (
            await client.callTool({
              name: "prepare_salary_transaction_create",
              arguments: { company_id: crypto.randomUUID(), fields },
            })
          ).structuredContent,
        ).toMatchObject({
          status: "error",
          error: { code: "COMPANY_FORBIDDEN" },
        });
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
}
