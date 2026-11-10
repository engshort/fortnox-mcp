import {
  type AccountingActor,
  accountingDate,
  accountingHash,
  type BusinessWriteResult,
  BusinessWrites,
  type Connections,
  DomainError,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";

const testEmployee = z
  .object({
    EmployeeId: z.string().regex(/^SYNM7[A-Z0-9]{6,10}$/),
    EmploymentDate: accountingDate,
  })
  .strict();
// Operator-only synthetic test provisioning. This is never a model-callable
// employee-management tool and cannot be enabled by ordinary product ENV.
export class FortnoxPayrollTestEmployee {
  readonly writes: BusinessWrites;
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
  ) {
    this.http = new DocumentHttp(
      connections,
      provider,
      ["payroll_employee.create", "payroll_employee.get"],
      active,
      now,
    );
    const fields = (input: unknown) => {
      const v = testEmployee.parse(input);
      return {
        ...v,
        FirstName: "Synthetic",
        LastName: "M7Test",
        Email: "synthetic-m7@example.invalid",
        EmploymentForm: "TV",
        PersonelType: "TJM",
        SalaryForm: "TIM",
        Inactive: false,
      };
    };
    const absent = async (
      actor: AccountingActor,
      company: string,
      id: string,
    ) => {
      try {
        await this.read(actor, company, id);
      } catch (error) {
        if (
          error instanceof ProviderError &&
          error.reason === "record_not_found"
        )
          return;
        throw error;
      }
      throw new DomainError("PROPOSAL_STALE");
    };
    const verify = async (
      actor: AccountingActor,
      company: string,
      input: unknown,
    ): Promise<BusinessWriteResult> => {
      const intended = fields(input);
      try {
        const row = await this.read(actor, company, intended.EmployeeId);
        const selected = Object.fromEntries(
          Object.keys(intended).map((key) => [key, row[key]]),
        );
        if (
          (await accountingHash(selected)) === (await accountingHash(intended))
        )
          return { state: "succeeded", reference: intended.EmployeeId };
      } catch {}
      return { state: "outcome_unknown", reference: intended.EmployeeId };
    };
    this.writes = new BusinessWrites(
      connections,
      {
        "payroll_employee.create": {
          scope: "salary",
          enabled: true,
          evidence: async (p) => {
            const v = fields(p.input);
            return {
              target: v.EmployeeId,
              fields: Object.keys(v).sort(),
              digest: await accountingHash(v),
            };
          },
          prepare: async (actor, company, input) => {
            const v = testEmployee.parse(input);
            await absent(actor, company, v.EmployeeId);
            return {
              input: v,
              baseline: null,
              preview: {
                effect: "create_synthetic_test_employee",
                after: fields(v),
                salary_calculation: false,
                payout: false,
              },
            };
          },
          validate: async (actor, company, p) => {
            const v = testEmployee.parse(p.input);
            await absent(actor, company, v.EmployeeId);
          },
          dispatch: async (actor, company, p, before) => {
            const v = fields(p.input);
            const context = await this.http.context(
              actor,
              company,
              "payroll_employee.create",
              "salary",
              true,
            );
            await this.http.submit(
              context,
              new URL("https://api.fortnox.se/3/employees"),
              "POST",
              JSON.stringify({ Employee: v }),
              before,
            );
            return verify(actor, company, p.input);
          },
          reconcile: async (actor, company, e) => {
            if (!e.evidence?.target) return { state: "outcome_unknown" };
            try {
              const row = await this.read(actor, company, e.evidence.target);
              const selected = Object.fromEntries(
                e.evidence.fields.map((key) => [key, row[key]]),
              );
              return {
                state:
                  (await accountingHash(selected)) === e.evidence.digest
                    ? "succeeded"
                    : "outcome_unknown",
                reference: e.evidence.target,
              };
            } catch {
              return { state: "outcome_unknown", reference: e.evidence.target };
            }
          },
        },
      },
      now,
    );
  }
  private async read(actor: AccountingActor, company: string, id: string) {
    testEmployee.shape.EmployeeId.parse(id);
    const context = await this.http.context(
      actor,
      company,
      "payroll_employee.get",
      "salary",
    );
    const raw = await this.http.read(
      context,
      new URL(`https://api.fortnox.se/3/employees/${id}`),
    );
    const row = z.record(z.string(), z.unknown()).parse(raw.Employee);
    if (row.EmployeeId !== id)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "employee_identity_mismatch",
      );
    return row;
  }
}
