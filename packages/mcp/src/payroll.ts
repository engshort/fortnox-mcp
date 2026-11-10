import {
  type AccountingActor,
  accountingDate,
  DomainError,
  type PayrollInputs,
  type PayrollOperation,
  payrollEmployee,
  payrollEmployeeId,
  payrollObservedFields,
  payrollRowId,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const company = z.object({ company_id: z.string().uuid() }).strict();
const page = z.number().int().min(1).max(10000).optional();
const record = z
  .object({
    id: payrollRowId,
    fields: payrollObservedFields,
    version: z.string().regex(/^[a-f0-9]{64}$/),
    editable: z.boolean(),
  })
  .strict();
const failure = z
  .object({
    status: z.literal("error"),
    error: z
      .object({
        code: z.string(),
        reason: z.string(),
        correlation_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
const output = (data: z.ZodType) =>
  z.union([
    z
      .object({ status: z.literal("ok"), company_id: z.string().uuid(), data })
      .strict(),
    failure,
  ]);
const pageOutput = (row: z.ZodType) =>
  z
    .object({
      company_id: z.string().uuid(),
      records: z.array(row).max(100),
      complete: z.boolean(),
      next_page: z.number().int().min(1).max(10000).nullable(),
    })
    .strict();
export function registerPayrollReads(
  server: McpServer,
  service: PayrollInputs,
  identity: AccountingActor | null,
) {
  const register = (
    name: string,
    operation: PayrollOperation,
    title: string,
    input: z.ZodObject,
    zdata: z.ZodType,
    run: (
      actor: AccountingActor,
      value: Record<string, unknown>,
    ) => Promise<unknown>,
  ) => {
    if (!service.enabled.includes(operation)) return;
    const schema = output(zdata);
    server.registerTool(
      name,
      {
        title,
        description:
          "Reads a bounded payroll-input resource. Requires explicit company access and salary consent. No payroll calculation, payslip or payout operation.",
        inputSchema: input,
        outputSchema: schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (raw) => {
        let result: unknown;
        try {
          if (!identity) throw new DomainError("AUTH_REQUIRED");
          const value = input.parse(raw);
          result = {
            status: "ok",
            company_id: value.company_id,
            data: await run(identity, value),
          };
        } catch (error) {
          result = {
            status: "error",
            error: {
              code:
                error instanceof DomainError
                  ? error.code
                  : "UPSTREAM_UNAVAILABLE",
              reason:
                error instanceof ProviderError
                  ? error.reason
                  : "request_failed",
              correlation_id: crypto.randomUUID(),
            },
          };
        }
        const checked = schema.parse(result);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(checked) }],
          structuredContent: checked,
          isError: checked.status === "error",
        };
      },
    );
  };
  register(
    "list_payroll_employees",
    "payroll_employee.list",
    "List payroll employee references",
    company.extend({ page }),
    pageOutput(payrollEmployee),
    (actor, v) =>
      service.employees(
        actor,
        String(v.company_id),
        v.page as number | undefined,
      ),
  );
  register(
    "get_payroll_employee",
    "payroll_employee.get",
    "Read a payroll employee reference",
    company.extend({ employee_id: payrollEmployeeId }),
    z
      .object({
        company_id: z.string().uuid(),
        record: payrollEmployee,
        complete: z.literal(true),
      })
      .strict(),
    (actor, v) =>
      service.employee(actor, String(v.company_id), String(v.employee_id)),
  );
  register(
    "list_salary_transactions",
    "salary_transaction.list",
    "List payroll input for an employee and day",
    company.extend({
      employee_id: payrollEmployeeId,
      date: accountingDate,
      page,
    }),
    pageOutput(record),
    (actor, v) =>
      service.list(
        actor,
        String(v.company_id),
        { employee_id: v.employee_id, date: v.date },
        v.page as number | undefined,
      ),
  );
  register(
    "get_salary_transaction",
    "salary_transaction.get",
    "Read a payroll input",
    company.extend({ salary_row: payrollRowId }),
    z
      .object({
        company_id: z.string().uuid(),
        record,
        complete: z.literal(true),
      })
      .strict(),
    (actor, v) =>
      service.get(actor, String(v.company_id), String(v.salary_row)),
  );
}
