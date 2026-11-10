import {
  type AccountingActor,
  accountingDate,
  accountingHash,
  type BusinessWriteResult,
  BusinessWrites,
  type Connections,
  DomainError,
  payrollFieldsHash,
  payrollRowId,
  type SalaryTransactionFields,
  salaryTransactionFields,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { FortnoxPayrollReads, payrollReadOperationIds } from "./payroll.js";

const syntheticId = z.string().regex(/^SYNM7[A-Z0-9]{6,10}$/);
const selection = z
  .object({ EmployeeId: syntheticId, Date: accountingDate })
  .strict();
const employeeReference = z.object({
  EmployeeId: syntheticId,
  Inactive: z.literal(false),
  EmploymentDate: accountingDate,
  EmployedTo: accountingDate.nullish(),
  PersonelType: z.literal("TJM"),
  SalaryForm: z.enum(["TIM", "MAN"]),
});
export interface PayrollProbeEmployee {
  id: string;
  form: "TIM" | "MAN";
}
const retainedInput = z
  .object({
    intent_id: z.string().uuid(),
    expected_fields: salaryTransactionFields,
  })
  .strict();
// Explicit operator acceptance experiment, never an advertised payroll tool.
// The code candidates come from Fortnox's standard TJM table, not from a claim
// that this company's table/rights are already verified. Only successful exact
// provider readback may establish evidence for later operation activation.
export class FortnoxPayrollProbe {
  readonly writes: BusinessWrites;
  readonly reads: FortnoxPayrollReads;
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly companyId: string,
    readonly employees: readonly PayrollProbeEmployee[],
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
    retainedInputs: readonly z.infer<typeof retainedInput>[] = [],
  ) {
    z.string().uuid().parse(companyId);
    z.array(
      z.object({ id: syntheticId, form: z.enum(["TIM", "MAN"]) }).strict(),
    )
      .min(1)
      .max(2)
      .parse(employees);
    if (new Set(employees.map((e) => e.id)).size !== employees.length)
      throw new DomainError("VALIDATION_FAILED");
    // Operator-only original private receipts, never caller-supplied row IDs.
    // The immutable execution digest must independently authenticate this input.
    const retained = z.array(retainedInput).max(2).parse(retainedInputs);
    if (new Set(retained.map((e) => e.intent_id)).size !== retained.length)
      throw new DomainError("VALIDATION_FAILED");
    this.http = new DocumentHttp(
      connections,
      provider,
      ["payroll_employee.get", "salary_transaction.create"],
      active,
      now,
    );
    this.reads = new FortnoxPayrollReads(
      connections,
      provider,
      payrollReadOperationIds,
      active,
      now,
    );
    const fields = (input: unknown) => {
      const v = selection.parse(input),
        employee = employees.find((e) => e.id === v.EmployeeId);
      if (!employee) throw new DomainError("CAPABILITY_UNAVAILABLE");
      return salaryTransactionFields.parse({
        ...v,
        SalaryCode: employee.form === "TIM" ? "11" : "12",
        Number: "1",
        Amount: "0.01",
        Total: "0.01",
        TextRow: "SYNTHETIC M7 INPUT",
      });
    };
    const validate = async (
      actor: AccountingActor,
      company: string,
      input: unknown,
    ) => {
      if (company !== companyId) throw new DomainError("COMPANY_FORBIDDEN");
      const v = fields(input),
        binding = employees.find((e) => e.id === v.EmployeeId);
      const context = await this.http.context(
        actor,
        company,
        "payroll_employee.get",
        "salary",
      );
      const raw = await this.http.read(
        context,
        new URL(`https://api.fortnox.se/3/employees/${v.EmployeeId}`),
      );
      const employee = employeeReference.parse(raw.Employee);
      if (
        employee.EmployeeId !== v.EmployeeId ||
        employee.SalaryForm !== binding?.form ||
        employee.EmploymentDate > v.Date ||
        (employee.EmployedTo && employee.EmployedTo < v.Date)
      )
        throw new DomainError("VALIDATION_FAILED");
      let page = 1,
        complete = false;
      for (let count = 0; count < 10; count++) {
        const result = await this.reads.page(
          actor,
          company,
          { employee_id: v.EmployeeId, date: v.Date },
          page,
        );
        if (result.records.some((r) => r.fields.TextRow === v.TextRow))
          throw new DomainError("PROPOSAL_STALE");
        complete = result.complete;
        if (result.next_page === null) break;
        page = result.next_page;
      }
      if (!complete) throw new DomainError("CAPABILITY_UNAVAILABLE");
      return accountingHash(employee);
    };
    const verify = async (
      actor: AccountingActor,
      company: string,
      id: string | undefined,
      digest: string,
      expected?: SalaryTransactionFields,
    ): Promise<BusinessWriteResult> => {
      if (company !== companyId) throw new DomainError("COMPANY_FORBIDDEN");
      if (!id) return { state: "outcome_unknown" };
      try {
        const row = await this.reads.get(actor, company, id);
        const observed = await payrollFieldsHash(row.fields);
        if (observed === digest) return { state: "succeeded", reference: id };
        if (expected && (await payrollFieldsHash(expected)) === digest) {
          // Only the fixed candidate profile can prove stable identity fields.
          // A changed employee/date/code/marker remains unknown. Numeric fields
          // are content, not identity; company code formulas may replace them.
          const fixed = fields({
            EmployeeId: expected.EmployeeId,
            Date: expected.Date,
          });
          if ((await payrollFieldsHash(fixed)) !== digest)
            return { state: "outcome_unknown", reference: id };
          if (
            (await payrollFieldsHash({
              ...row.fields,
              Number: expected.Number,
              Amount: expected.Amount,
              Total: expected.Total,
            })) === digest
          ) {
            const changed: string[] = [];
            for (const name of ["Number", "Amount", "Total"] as const)
              if (
                (await payrollFieldsHash({
                  ...expected,
                  [name]: row.fields[name],
                })) !== digest
              )
                changed.push(name);
            return {
              state: "applied_different",
              reference: id,
              difference: {
                expected_digest: digest,
                observed_digest: observed,
                fields: changed,
                proof: "retained_provider_response_and_exact_readback",
              },
            };
          }
        }
      } catch {}
      return { state: "outcome_unknown", reference: id };
    };
    this.writes = new BusinessWrites(
      connections,
      {
        "salary_transaction.create": {
          scope: "salary",
          enabled: true,
          evidence: async (p) => ({
            target: null,
            fields: Object.keys(fields(p.input)).sort(),
            digest: await payrollFieldsHash(fields(p.input)),
          }),
          prepare: async (actor, company, input) => {
            const v = selection.parse(input);
            return {
              input: v,
              baseline: await validate(actor, company, v),
              preview: {
                effect: "synthetic_payroll_input_acceptance_probe",
                candidate_code_verification: "pending_provider_acceptance",
                after: fields(v),
                payslip_or_payout: false,
              },
            };
          },
          validate: async (actor, company, p) => {
            if ((await validate(actor, company, p.input)) !== p.baseline)
              throw new DomainError("PROPOSAL_STALE");
          },
          dispatch: async (actor, company, p, before) => {
            const v = fields(p.input),
              context = await this.http.context(
                actor,
                company,
                "salary_transaction.create",
                "salary",
                true,
              );
            const raw = await this.http.submit(
              context,
              new URL("https://api.fortnox.se/3/salarytransactions"),
              "POST",
              JSON.stringify({ SalaryTransaction: v }),
              before,
            );
            const returned = z
              .object({
                SalaryTransaction: z.object({ SalaryRow: payrollRowId }),
              })
              .safeParse(raw);
            return verify(
              actor,
              company,
              returned.success
                ? returned.data.SalaryTransaction.SalaryRow
                : undefined,
              await payrollFieldsHash(v),
              v,
            );
          },
          reconcile: async (actor, company, e) =>
            e.evidence
              ? verify(
                  actor,
                  company,
                  e.reference,
                  e.evidence.digest,
                  retained.find((v) => v.intent_id === e.id)?.expected_fields,
                )
              : { state: "outcome_unknown" },
        },
      },
      now,
    );
  }
}
