import {
  type AccountingActor,
  accountingDate,
  accountingHash,
  type BusinessWriteResult,
  type Connections,
  DomainError,
  type PayrollEmployee,
  type PayrollOperation,
  type PayrollProvider,
  type PayrollRecord,
  payrollEmployeeId,
  payrollObservedFields,
  payrollRowId,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";

export const payrollReadOperationIds = [
  "payroll_employee.list",
  "payroll_employee.get",
  "salary_transaction.list",
  "salary_transaction.get",
] as const;
const integer = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number);
const metadata = z.object({ "@CurrentPage": integer, "@TotalPages": integer });
const employeeSource = z.object({
  EmployeeId: payrollEmployeeId,
  Inactive: z.boolean().nullish(),
  EmploymentDate: accountingDate.nullish(),
  PersonelType: z.enum(["ARB", "TJM"]).nullish(),
});
const rowSource = z.object({
  ...payrollObservedFields.shape,
  SalaryRow: payrollRowId,
});
function pagination(raw: unknown, page: number, count: number) {
  const m = metadata.safeParse(raw);
  if (!m.success) return { complete: false, next_page: null };
  if (
    m.data["@TotalPages"] === 0 &&
    count === 0 &&
    page === 1 &&
    m.data["@CurrentPage"] <= 1
  )
    return { complete: true, next_page: null };
  if (m.data["@CurrentPage"] !== page || m.data["@TotalPages"] < page)
    throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
  return {
    complete: m.data["@TotalPages"] === page,
    next_page: m.data["@TotalPages"] > page ? page + 1 : null,
  };
}
// This first adapter is intentionally read-only. A successful employee GET does
// not verify salary-write rights, salary-code tables or any payroll computation.
export class FortnoxPayrollReads implements PayrollProvider {
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly enabled: readonly PayrollOperation[] = [],
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
  ) {
    if (
      new Set(enabled).size !== enabled.length ||
      enabled.some(
        (id) => !(payrollReadOperationIds as readonly string[]).includes(id),
      )
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    this.http = new DocumentHttp(connections, provider, enabled, active, now);
  }
  private context(
    actor: AccountingActor,
    company: string,
    operation: PayrollOperation,
  ) {
    z.string().uuid().parse(company);
    return this.http.context(actor, company, operation, "salary");
  }
  private async projectEmployee(raw: unknown): Promise<PayrollEmployee> {
    const value = employeeSource.parse(raw);
    return {
      id: value.EmployeeId,
      active: value.Inactive == null ? null : !value.Inactive,
      employment_from: value.EmploymentDate ?? null,
      personel_type: value.PersonelType ?? null,
      version: await accountingHash(raw),
    };
  }
  private async projectRow(raw: unknown): Promise<PayrollRecord> {
    const value = rowSource.parse(raw),
      { SalaryRow, ...fields } = value;
    return {
      id: SalaryRow,
      fields,
      version: await accountingHash(raw),
      editable: false,
    };
  }
  async employee(actor: AccountingActor, company: string, id: string) {
    payrollEmployeeId.parse(id);
    const context = await this.context(actor, company, "payroll_employee.get");
    const raw = await this.http.read(
      context,
      new URL(`https://api.fortnox.se/3/employees/${encodeURIComponent(id)}`),
    );
    const record = await this.projectEmployee(raw.Employee);
    if (record.id !== id)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "employee_identity_mismatch",
      );
    return record;
  }
  async employees(actor: AccountingActor, company: string, page = 1) {
    z.number().int().min(1).max(10000).parse(page);
    const context = await this.context(actor, company, "payroll_employee.list");
    const url = new URL("https://api.fortnox.se/3/employees");
    url.search = new URLSearchParams({
      page: String(page),
      limit: "100",
    }).toString();
    const raw = await this.http.read(context, url);
    const rows = z
      .array(z.record(z.string(), z.unknown()))
      .max(100)
      .parse(raw.Employees);
    const records: PayrollEmployee[] = [];
    for (const row of rows) records.push(await this.projectEmployee(row));
    return {
      records,
      ...pagination(raw.MetaInformation, page, records.length),
    };
  }
  async get(actor: AccountingActor, company: string, id: string) {
    payrollRowId.parse(id);
    const context = await this.context(
      actor,
      company,
      "salary_transaction.get",
    );
    const raw = await this.http.read(
      context,
      new URL(`https://api.fortnox.se/3/salarytransactions/${id}`),
    );
    const record = await this.projectRow(raw.SalaryTransaction);
    if (record.id !== id)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "salary_row_identity_mismatch",
      );
    return record;
  }
  async page(
    actor: AccountingActor,
    company: string,
    filter: { employee_id: string; date: string },
    page = 1,
  ) {
    const selection = z
      .object({ employee_id: payrollEmployeeId, date: accountingDate })
      .strict()
      .parse(filter);
    z.number().int().min(1).max(10000).parse(page);
    const context = await this.context(
      actor,
      company,
      "salary_transaction.list",
    );
    const url = new URL("https://api.fortnox.se/3/salarytransactions");
    url.search = new URLSearchParams({
      employeeid: selection.employee_id,
      date: selection.date,
      page: String(page),
      limit: "100",
    }).toString();
    const raw = await this.http.read(context, url);
    const rows = z
      .array(z.record(z.string(), z.unknown()))
      .max(100)
      .parse(raw.SalaryTransactions);
    const records: PayrollRecord[] = [];
    for (const row of rows) records.push(await this.projectRow(row));
    if (
      records.some(
        (r) =>
          r.fields.EmployeeId !== selection.employee_id ||
          r.fields.Date !== selection.date,
      )
    )
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "salary_filter_mismatch");
    return {
      records,
      ...pagination(raw.MetaInformation, page, records.length),
    };
  }
  async references(
    actor: AccountingActor,
    company: string,
    employee: string,
    _date: string,
  ) {
    const record = await this.employee(actor, company, employee);
    return {
      company_id: company,
      retrieved_at: this.now(),
      complete: false,
      license_verified: false,
      verified_actions: [],
      employees:
        record.employment_from && record.active !== null
          ? [
              {
                id: record.id,
                active: record.active,
                from: record.employment_from,
                to: null,
              },
            ]
          : [],
      codes: [],
    };
  }
  async write(
    ..._args: Parameters<PayrollProvider["write"]>
  ): Promise<BusinessWriteResult> {
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  }
}
