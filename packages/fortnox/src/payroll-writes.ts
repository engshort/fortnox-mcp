import {
  type AccountingActor,
  accountingDate,
  accountingHash,
  type BusinessWriteResult,
  type Connections,
  DomainError,
  type PayrollAction,
  type PayrollOperation,
  type PayrollProvider,
  type PayrollReferences,
  parseAmount,
  payrollEmployeeId,
  payrollFieldsHash,
  payrollObservedFields,
  payrollRowId,
  type SalaryTransactionFields,
  salaryTransactionFields,
  validatePayrollInput,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";
import { FortnoxPayrollReads, payrollReadOperationIds } from "./payroll.js";

// Trusted operation evidence, never accepted from MCP inputs or ordinary ENV.
// Each action needs its own private acceptance hash. Profiles are bounded to a
// company, employee, code and date interval; no universal code table is inferred.
export const payrollWriteProfile = z
  .object({
    company_id: z.string().uuid(),
    employee_id: payrollEmployeeId,
    code: z.literal("11"),
    from: accountingDate,
    to: accountingDate,
    hourly_pay: z.string().transform((v) => parseAmount(v, 2)),
    quantity_scale: z.number().int().min(0).max(6),
    delete_status: z.union([z.literal(200), z.literal(204)]).default(200),
    evidence: z
      .object({
        create: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        update: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        delete: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  })
  .strict()
  .refine((v) => v.from <= v.to && Object.keys(v.evidence).length > 0);
export type PayrollWriteProfile = z.input<typeof payrollWriteProfile>;
export class FortnoxPayrollWrites implements PayrollProvider {
  readonly reads: FortnoxPayrollReads;
  readonly http: DocumentHttp;
  readonly profiles: z.output<typeof payrollWriteProfile>[];
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    profiles: readonly PayrollWriteProfile[] = [],
    readonly enabled: readonly PayrollOperation[] = [],
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
    readonly liveReferences = false,
  ) {
    this.profiles = z.array(payrollWriteProfile).max(20).parse(profiles);
    if (
      new Set(
        this.profiles.map((p) => `${p.company_id}/${p.employee_id}/${p.code}`),
      ).size !== this.profiles.length ||
      new Set(enabled).size !== enabled.length ||
      enabled.some(
        (op) =>
          ![
            ...payrollReadOperationIds,
            "salary_transaction.create",
            "salary_transaction.update",
            "salary_transaction.delete",
          ].includes(op),
      )
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    this.reads = new FortnoxPayrollReads(
      connections,
      provider,
      enabled.filter((op) =>
        (payrollReadOperationIds as readonly string[]).includes(op),
      ),
      active,
      now,
    );
    for (const action of ["create", "update", "delete"] as const)
      if (
        enabled.includes(`salary_transaction.${action}`) &&
        !this.liveReferences &&
        !this.profiles.some((p) => p.evidence[action])
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    this.http = new DocumentHttp(connections, provider, enabled, active, now);
  }
  employee(...args: Parameters<PayrollProvider["employee"]>) {
    return this.reads.employee(...args);
  }
  employees(...args: Parameters<PayrollProvider["employees"]>) {
    return this.reads.employees(...args);
  }
  page(...args: Parameters<PayrollProvider["page"]>) {
    return this.reads.page(...args);
  }
  async references(
    actor: AccountingActor,
    company: string,
    employee: string,
    date: string,
  ): Promise<PayrollReferences> {
    payrollEmployeeId.parse(employee);
    accountingDate.parse(date);
    const profile = this.profiles.find(
      (p) =>
        p.company_id === company &&
        p.employee_id === employee &&
        p.from <= date &&
        p.to >= date,
    );
    if (!profile && !this.liveReferences)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const context = await this.http.context(
      actor,
      company,
      "payroll_employee.get",
      "salary",
    );
    const raw = await this.http.read(
      context,
      new URL(
        `https://api.fortnox.se/3/employees/${encodeURIComponent(employee)}`,
      ),
    );
    const source = z
      .object({
        EmployeeId: payrollEmployeeId,
        Inactive: z.boolean(),
        EmploymentDate: accountingDate,
        EmployedTo: accountingDate.nullish(),
        PersonelType: z.literal("TJM"),
        SalaryForm: z.literal("TIM"),
        HourlyPay: z.string(),
        DatedWages: z
          .array(z.object({ FirstDay: accountingDate, HourlyPay: z.string() }))
          .max(100)
          .optional(),
      })
      .parse(raw.Employee);
    if (source.EmployeeId !== employee)
      throw new DomainError("COMPANY_FORBIDDEN");
    const wages = source.DatedWages;
    if (wages && new Set(wages.map((w) => w.FirstDay)).size !== wages.length)
      throw new DomainError("VALIDATION_FAILED");
    const dated = wages
      ?.filter((w) => w.FirstDay <= date)
      .sort((a, b) => b.FirstDay.localeCompare(a.FirstDay))[0];
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(this.now()));
    const rate =
      dated?.HourlyPay ?? (date === today ? source.HourlyPay : undefined);
    if (
      rate === undefined ||
      (profile && parseAmount(rate, 2) !== profile.hourly_pay)
    )
      throw new DomainError("PROPOSAL_STALE");
    const unitAmount = parseAmount(rate, 2);
    // This is the implemented hourly code-11 calculation, bound to current
    // employment and provider wages. It is not a universal salary-code table.
    const currentProfile = profile ?? {
      company_id: company,
      employee_id: employee,
      code: "11",
      from: date,
      to: date,
      hourly_pay: unitAmount,
      quantity_scale: 6,
    };
    return {
      company_id: company,
      retrieved_at: this.now(),
      complete: true,
      license_verified: !!profile,
      verified_actions: (["create", "update", "delete"] as const).filter(
        (action) =>
          !!profile?.evidence[action] &&
          this.enabled.includes(`salary_transaction.${action}`),
      ),
      ...(this.liveReferences
        ? {
            available_actions: (["create", "update", "delete"] as const).filter(
              (action) => this.enabled.includes(`salary_transaction.${action}`),
            ),
          }
        : {}),
      employees: [
        {
          id: employee,
          active: !source.Inactive,
          from: source.EmploymentDate,
          to: source.EmployedTo ?? null,
        },
      ],
      codes: [
        {
          employee_id: employee,
          code: currentProfile.code,
          from: currentProfile.from,
          to: currentProfile.to,
          profile: "quantity_times_unit_amount",
          quantity_scale: currentProfile.quantity_scale,
          unit_amount: currentProfile.hourly_pay,
          evidence_sha256: await accountingHash(currentProfile),
        },
      ],
    };
  }
  async get(actor: AccountingActor, company: string, id: string) {
    payrollRowId.parse(id);
    const context = await this.http.context(
      actor,
      company,
      "salary_transaction.get",
      "salary",
    );
    const raw = await this.http.read(
      context,
      new URL(`https://api.fortnox.se/3/salarytransactions/${id}`),
    );
    const source = z
      .record(z.string(), z.unknown())
      .parse(raw.SalaryTransaction);
    if (source.SalaryRow !== id)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "salary_row_identity_mismatch",
      );
    const fields = payrollObservedFields.parse(
      Object.fromEntries(
        Object.keys(payrollObservedFields.shape)
          .filter((k) => k in source)
          .map((k) => [k, source[k]]),
      ),
    );
    const profile = this.profiles.find(
      (p) =>
        p.company_id === company &&
        p.employee_id === fields.EmployeeId &&
        p.code === fields.SalaryCode &&
        p.from <= fields.Date &&
        p.to >= fields.Date,
    );
    const extra = Object.keys(source).some(
      (k) =>
        ![
          ...Object.keys(payrollObservedFields.shape),
          "SalaryRow",
          "@url",
          "CostCenter",
          "Project",
          "Expense",
          "VAT",
        ].includes(k),
    );
    const ancillary = ["CostCenter", "Project", "Expense"].every(
      (k) => source[k] == null || source[k] === "",
    );
    let zeroVat = source.VAT == null || source.VAT === "";
    try {
      zeroVat ||= parseAmount(source.VAT, 2) === "0.00";
    } catch {}
    // Do not let a modeled-field digest establish successful reconciliation
    // while dropping unsupported source content. The read-only adapter remains
    // available independently; this write profile fails closed for such rows.
    if (extra || !ancillary || !zeroVat)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return {
      id,
      fields,
      version: await accountingHash(source),
      editable:
        (this.liveReferences
          ? fields.SalaryCode === "11"
          : !!profile &&
            !!(
              (profile.evidence.update &&
                this.enabled.includes("salary_transaction.update")) ||
              (profile.evidence.delete &&
                this.enabled.includes("salary_transaction.delete"))
            )) && salaryTransactionFields.safeParse(fields).success,
    };
  }
  async write(
    actor: AccountingActor,
    company: string,
    action: PayrollAction,
    id: string | null,
    fields: SalaryTransactionFields,
    baseline: string | null,
    before: () => Promise<void>,
  ): Promise<BusinessWriteResult> {
    const intended = validatePayrollInput(
      fields,
      company,
      await this.references(actor, company, fields.EmployeeId, fields.Date),
      action,
      this.now(),
    );
    const profile = this.profiles.find(
      (p) =>
        p.company_id === company &&
        p.employee_id === intended.EmployeeId &&
        p.code === intended.SalaryCode,
    );
    if (
      (!profile && !this.liveReferences) ||
      (profile && intended.Amount !== profile.hourly_pay)
    )
      throw new DomainError("VALIDATION_FAILED");
    if (action !== "create") {
      if (!id || !baseline) throw new DomainError("VALIDATION_FAILED");
      const current = await this.get(actor, company, id);
      if (
        !current.editable ||
        current.version !== baseline ||
        ["EmployeeId", "Date", "SalaryCode"].some(
          (k) =>
            current.fields[k as keyof typeof current.fields] !==
            intended[k as keyof typeof intended],
        )
      )
        throw new DomainError("PROPOSAL_STALE");
    } else if (id !== null || baseline !== null)
      throw new DomainError("VALIDATION_FAILED");
    const context = await this.http.context(
      actor,
      company,
      `salary_transaction.${action}`,
      "salary",
      true,
    );
    const raw = await this.http.submit(
      context,
      new URL(
        `https://api.fortnox.se/3/salarytransactions${id ? `/${id}` : ""}`,
      ),
      action === "create" ? "POST" : action === "update" ? "PUT" : "DELETE",
      action === "delete"
        ? undefined
        : JSON.stringify({ SalaryTransaction: intended }),
      before,
    );
    if (action === "delete") {
      if (
        raw?.deletion_acknowledged &&
        (profile
          ? raw.response_status === profile.delete_status
          : raw.response_status === 200 || raw.response_status === 204) &&
        id
      ) {
        try {
          await this.get(actor, company, id);
        } catch (error) {
          if (
            error instanceof ProviderError &&
            error.reason === "record_not_found"
          )
            return { state: "succeeded", reference: id };
        }
      }
      return { state: "outcome_unknown", ...(id ? { reference: id } : {}) };
    }
    const returned = z
      .object({ SalaryTransaction: z.object({ SalaryRow: payrollRowId }) })
      .safeParse(raw);
    const reference =
      id ??
      (returned.success ? returned.data.SalaryTransaction.SalaryRow : null);
    if (
      returned.success &&
      reference &&
      (!id || returned.data.SalaryTransaction.SalaryRow === id)
    ) {
      try {
        const observed = await this.get(actor, company, reference);
        if (
          (await payrollFieldsHash(observed.fields)) ===
          (await payrollFieldsHash(intended))
        )
          return { state: "succeeded", reference };
        const expectedDigest = await payrollFieldsHash(intended);
        if (
          (await payrollFieldsHash({
            ...observed.fields,
            Number: intended.Number,
            Amount: intended.Amount,
            Total: intended.Total,
          })) === expectedDigest
        ) {
          const changed: string[] = [];
          for (const name of ["Number", "Amount", "Total"] as const)
            if (
              (await payrollFieldsHash({
                ...intended,
                [name]: observed.fields[name],
              })) !== expectedDigest
            )
              changed.push(name);
          return {
            state: "applied_different",
            reference,
            difference: {
              expected_digest: expectedDigest,
              observed_digest: await payrollFieldsHash(observed.fields),
              fields: changed,
              proof: "retained_provider_response_and_exact_readback",
            },
          };
        }
      } catch {}
    }
    return { state: "outcome_unknown", ...(reference ? { reference } : {}) };
  }
}
