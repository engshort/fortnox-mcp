import { Decimal } from "decimal.js";
import { z } from "zod";
import { accountingDate, accountingHash } from "./accounting.js";
import type { AccountingActor } from "./bookkeeping.js";
import {
  type BusinessOperation,
  type BusinessWriteResult,
  BusinessWrites,
  type PreparedBusinessWrite,
} from "./business-writes.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { parseAmount } from "./money.js";
import { assertScopeProgram } from "./programs.js";

const Exact = Decimal.clone({ precision: 96 });
export const payrollEmployeeId = z.string().regex(/^[A-Za-z0-9_-]{1,15}$/);
export const payrollRowId = z.string().regex(/^[1-9]\d{0,9}$/);
const code = z.string().regex(/^[A-Za-z0-9_-]{1,20}$/);
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/);
// An explicit, narrow server-verified code profile is required. The API schema
// alone does not establish how Amount/Number/Total interact for every salary code.
export const salaryTransactionFields = z
  .object({
    EmployeeId: payrollEmployeeId,
    Date: accountingDate,
    SalaryCode: code,
    Number: decimal,
    Amount: decimal,
    Total: decimal,
    TextRow: z.string().min(1).max(40).optional(),
  })
  .strict();
export type SalaryTransactionFields = z.infer<typeof salaryTransactionFields>;
export type PayrollAction = "create" | "update" | "delete";
export const payrollOperationIds = [
  "salary_transaction.list",
  "salary_transaction.get",
  "salary_transaction.create",
  "salary_transaction.update",
  "salary_transaction.delete",
] as const;
export type PayrollOperation = (typeof payrollOperationIds)[number];
export interface PayrollReferences {
  company_id: string;
  retrieved_at: number;
  complete: boolean;
  license_verified: boolean;
  verified_actions: readonly PayrollAction[];
  employees: Array<{
    id: string;
    active: boolean;
    from: string;
    to: string | null;
  }>;
  codes: Array<{
    employee_id: string;
    code: string;
    from: string;
    to: string;
    profile: "quantity_times_unit_amount";
    quantity_scale: number;
    evidence_sha256: string;
  }>;
}
export interface PayrollRecord {
  id: string;
  fields: SalaryTransactionFields;
  version: string;
  editable: boolean;
}
export interface PayrollProvider {
  references(
    actor: AccountingActor,
    company: string,
    employee: string,
    date: string,
  ): Promise<PayrollReferences>;
  get(
    actor: AccountingActor,
    company: string,
    id: string,
  ): Promise<PayrollRecord>;
  page(
    actor: AccountingActor,
    company: string,
    filter: { employee_id: string; date: string },
    page: number,
  ): Promise<{
    records: PayrollRecord[];
    complete: boolean;
    next_page: number | null;
  }>;
  write(
    actor: AccountingActor,
    company: string,
    action: PayrollAction,
    id: string | null,
    fields: SalaryTransactionFields,
    baseline: string | null,
    beforeDispatch: () => Promise<void>,
  ): Promise<BusinessWriteResult>;
}
export function validatePayrollInput(
  input: unknown,
  company: string,
  refs: PayrollReferences,
  action: PayrollAction,
  now: number,
) {
  const value = salaryTransactionFields.parse(input);
  if (refs.company_id !== company) throw new DomainError("COMPANY_FORBIDDEN");
  if (
    !refs.complete ||
    !refs.license_verified ||
    !refs.verified_actions.includes(action) ||
    refs.retrieved_at > now ||
    now - refs.retrieved_at > 60000
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  const employees = refs.employees.filter((e) => e.id === value.EmployeeId);
  const codes = refs.codes.filter(
    (c) =>
      c.employee_id === value.EmployeeId &&
      c.code === value.SalaryCode &&
      c.from <= value.Date &&
      c.to >= value.Date,
  );
  const employee = employees[0],
    profile = codes[0];
  if (
    employees.length !== 1 ||
    !employee?.active ||
    !accountingDate.safeParse(employee.from).success ||
    (employee.to !== null && !accountingDate.safeParse(employee.to).success) ||
    employee.from > value.Date ||
    (employee.to !== null && employee.to < value.Date) ||
    codes.length !== 1 ||
    !profile ||
    !accountingDate.safeParse(profile.from).success ||
    !accountingDate.safeParse(profile.to).success ||
    profile.profile !== "quantity_times_unit_amount" ||
    !Number.isInteger(profile.quantity_scale) ||
    profile.quantity_scale < 0 ||
    profile.quantity_scale > 6 ||
    !/^[a-f0-9]{64}$/.test(profile.evidence_sha256)
  )
    throw new DomainError("VALIDATION_FAILED");
  const NumberValue = parseAmount(value.Number, profile.quantity_scale),
    Amount = parseAmount(value.Amount, 2),
    Total = parseAmount(value.Total, 2);
  if (
    new Exact(NumberValue).lte(0) ||
    new Exact(Amount).lte(0) ||
    !new Exact(NumberValue).times(Amount).eq(Total)
  )
    throw new DomainError("VALIDATION_FAILED");
  return { ...value, Number: NumberValue, Amount, Total };
}
export const payrollCreate = z
  .object({ company_id: z.string().uuid(), fields: salaryTransactionFields })
  .strict();
export const payrollUpdate = payrollCreate
  .extend({
    id: payrollRowId,
    expected_version: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const payrollDelete = payrollUpdate.omit({ fields: true }).strict();
const pending = z
  .object({ id: payrollRowId.nullable(), fields: salaryTransactionFields })
  .strict();
export class PayrollInputs {
  readonly writes: BusinessWrites;
  constructor(
    readonly connections: Connections,
    readonly provider: PayrollProvider,
    readonly enabled: readonly PayrollOperation[] = [],
    readonly now = Date.now,
  ) {
    if (
      new Set(enabled).size !== enabled.length ||
      enabled.some((id) => !payrollOperationIds.includes(id)) ||
      (enabled.some((id) => !id.endsWith(".list") && !id.endsWith(".get")) &&
        !enabled.includes("salary_transaction.get"))
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const operations: Record<string, BusinessOperation> = {};
    for (const action of ["create", "update", "delete"] as const)
      operations[`salary_transaction.${action}`] = {
        scope: "salary",
        enabled: enabled.includes(`salary_transaction.${action}`),
        evidence: async (p) => {
          const v = pending.parse(p.input);
          return {
            target: v.id,
            fields: Object.keys(v.fields).sort(),
            digest: await payrollFieldsHash(v.fields),
          };
        },
        prepare: async (actor, company, input) => {
          const schema =
            action === "create"
              ? payrollCreate
              : action === "update"
                ? payrollUpdate
                : payrollDelete;
          const value = schema.parse(input);
          if (value.company_id !== company)
            throw new DomainError("COMPANY_FORBIDDEN");
          const id = "id" in value ? value.id : null;
          const current = id ? await this.current(actor, company, id) : null;
          if (
            current &&
            (!current.editable ||
              !("expected_version" in value) ||
              current.version !== value.expected_version)
          )
            throw new DomainError("PROPOSAL_STALE");
          const fields = await this.validateFields(
            actor,
            company,
            action,
            "fields" in value ? value.fields : current?.fields,
          );
          return {
            input: { id, fields },
            baseline: current?.version ?? null,
            preview: {
              action,
              employee_id: fields.EmployeeId,
              date: fields.Date,
              before: current?.fields ?? null,
              after: action === "delete" ? null : fields,
              diff: payrollDiff(
                current?.fields ?? null,
                action === "delete" ? null : fields,
              ),
              effect: "payroll_input_only",
            },
          };
        },
        validate: async (actor, company, p) => {
          const v = pending.parse(p.input);
          await this.validateFields(actor, company, action, v.fields);
          if (v.id) {
            const current = await this.current(actor, company, v.id);
            if (!current.editable || current.version !== p.baseline)
              throw new DomainError("PROPOSAL_STALE");
          }
        },
        dispatch: async (actor, company, p, before) => {
          const v = pending.parse(p.input);
          return this.provider.write(
            actor,
            company,
            action,
            v.id,
            v.fields,
            p.baseline,
            before,
          );
        },
        reconcile: async (actor, company, e) => {
          // A missing row after deletion does not prove this intent deleted it.
          // A create without its exact returned provider identity cannot be matched
          // safely by employee/date/code/amount, which are not unique identities.
          if (action === "delete")
            return { state: "outcome_unknown", reference: e.reference };
          const id = e.reference ?? e.evidence?.target;
          if (!id || !e.evidence) return { state: "outcome_unknown" };
          try {
            const record = await this.current(actor, company, id);
            return {
              state:
                (await payrollFieldsHash(record.fields)) === e.evidence.digest
                  ? "succeeded"
                  : "outcome_unknown",
              reference: id,
            };
          } catch {
            return { state: "outcome_unknown", reference: id };
          }
        },
      };
    this.writes = new BusinessWrites(connections, operations, now);
  }
  private async authorize(
    actor: AccountingActor,
    company: string,
    operation: PayrollOperation,
  ) {
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    assertScopeProgram(c, "salary");
    if (!this.enabled.includes(operation) || !c.scopes.includes("salary"))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  private async validateFields(
    actor: AccountingActor,
    company: string,
    action: PayrollAction,
    fields: unknown,
  ) {
    const input = salaryTransactionFields.parse(fields);
    const refs = await this.provider.references(
      actor,
      company,
      input.EmployeeId,
      input.Date,
    );
    return validatePayrollInput(input, company, refs, action, this.now());
  }
  private async current(actor: AccountingActor, company: string, id: string) {
    const record = await this.provider.get(
      actor,
      company,
      payrollRowId.parse(id),
    );
    if (record.id !== id || !/^[a-f0-9]{64}$/.test(record.version))
      throw new DomainError("UPSTREAM_UNAVAILABLE");
    salaryTransactionFields.parse(record.fields);
    return record;
  }
  async get(actor: AccountingActor, company: string, id: string) {
    const before = await this.authorize(
      actor,
      company,
      "salary_transaction.get",
    );
    const record = await this.current(actor, company, id);
    const after = await this.authorize(
      actor,
      company,
      "salary_transaction.get",
    );
    if (after.generation !== before.generation)
      throw new DomainError("CONNECTION_CONFLICT");
    return { company_id: company, record, complete: true as const };
  }
  async list(
    actor: AccountingActor,
    company: string,
    input: unknown,
    page = 1,
  ) {
    const before = await this.authorize(
      actor,
      company,
      "salary_transaction.list",
    );
    const filter = z
      .object({ employee_id: payrollEmployeeId, date: accountingDate })
      .strict()
      .parse(input);
    z.number().int().min(1).max(10000).parse(page);
    const result = await this.provider.page(actor, company, filter, page);
    if (
      result.records.length > 100 ||
      new Set(result.records.map((r) => r.id)).size !== result.records.length ||
      result.records.some(
        (r) =>
          r.fields.EmployeeId !== filter.employee_id ||
          r.fields.Date !== filter.date,
      ) ||
      (result.complete && result.next_page !== null) ||
      (!result.complete &&
        result.next_page !== null &&
        result.next_page !== page + 1)
    )
      throw new DomainError("UPSTREAM_UNAVAILABLE");
    for (const r of result.records) {
      payrollRowId.parse(r.id);
      salaryTransactionFields.parse(r.fields);
    }
    const after = await this.authorize(
      actor,
      company,
      "salary_transaction.list",
    );
    if (after.generation !== before.generation)
      throw new DomainError("CONNECTION_CONFLICT");
    return { company_id: company, ...result };
  }
  async prepare(actor: AccountingActor, action: PayrollAction, input: unknown) {
    const value = (
      action === "create"
        ? payrollCreate
        : action === "update"
          ? payrollUpdate
          : payrollDelete
    ).parse(input);
    return this.writes.prepare(
      actor,
      value.company_id,
      `salary_transaction.${action}`,
      value,
    );
  }
}
export async function payrollFieldsHash(input: SalaryTransactionFields) {
  const value = salaryTransactionFields.parse(input);
  return accountingHash({
    ...value,
    Number: parseAmount(value.Number, 6),
    Amount: parseAmount(value.Amount, 2),
    Total: parseAmount(value.Total, 2),
  });
}
function payrollDiff(
  before: SalaryTransactionFields | null,
  after: SalaryTransactionFields | null,
) {
  return [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ]
    .sort()
    .filter(
      (key) =>
        before?.[key as keyof SalaryTransactionFields] !==
        after?.[key as keyof SalaryTransactionFields],
    )
    .map((field) => ({
      field,
      before: before?.[field as keyof SalaryTransactionFields] ?? null,
      after: after?.[field as keyof SalaryTransactionFields] ?? null,
    }));
}
export function preparedPayrollInput(prepared: PreparedBusinessWrite) {
  return pending.parse(prepared.input);
}
