import { z } from "zod";
import { accountingDate, referenceAccountNumbers } from "./accounting.js";

export const readCompany = z.string().uuid();
export const readYear = z.number().int().positive().safe();
export const readNumber = z.string().regex(/^[1-9]\d{0,11}$/);
export const decimalText = z
  .string()
  .max(68)
  .regex(/^-?(?:0|[1-9]\d{0,47})(?:\.\d{1,18})?$/);
const text = z.string().max(4096);
const nullableText = text.nullable();
const nullableMoney = decimalText.nullable();
export const companySummary = z
  .object({
    company_id: readCompany,
    name: z.string(),
    state: z.enum(["active", "reconnect_required", "disconnected"]),
    mode: z.enum(["service", "user"]),
    read_only: z.boolean(),
    manual_vouchers: z.enum(["review_required", "client_managed"]),
  })
  .strict();
export const invoiceSummary = z
  .object({
    number: readNumber,
    kind: z.enum(["customer", "supplier"]),
    counterparty_number: nullableText,
    counterparty_name: nullableText,
    invoice_number: nullableText,
    invoice_date: accountingDate.nullable(),
    due_date: accountingDate.nullable(),
    currency: z.string().max(12).nullable(),
    total: nullableMoney,
    balance: nullableMoney,
    booked: z.boolean().nullable(),
    cancelled: z.boolean().nullable(),
    sent: z.boolean().nullable(),
    credit: z.boolean().nullable(),
  })
  .strict();
export const readInvoiceRow = z
  .object({
    account: z.number().int().safe().nullable(),
    description: nullableText,
    quantity: nullableMoney,
    price: nullableMoney,
    total: nullableMoney,
    debit: nullableMoney,
    credit: nullableMoney,
    vat: nullableMoney,
    cost_center: nullableText,
    project: nullableText,
  })
  .strict();
export const invoiceDetails = invoiceSummary
  .extend({ rows: z.array(readInvoiceRow).max(10000) })
  .strict();
export const voucherSummary = z
  .object({
    currency: z.string().max(12).nullable(),
    financial_year: readYear,
    series: z.string().regex(/^[A-Z0-9]{1,8}$/),
    number: readYear,
    date: accountingDate,
    description: text,
    reference_number: nullableText,
    reference_type: nullableText,
  })
  .strict();
export const voucherRow = z
  .object({
    account: z.number().int().safe(),
    debit: decimalText,
    credit: decimalText,
    removed: z.boolean(),
    description: nullableText,
    information: nullableText,
    quantity: nullableMoney,
    cost_center: nullableText,
    project: nullableText,
  })
  .strict();
export const voucherDetails = voucherSummary
  .extend({ rows: z.array(voucherRow).max(10000) })
  .strict();
export const accountRead = z
  .object({
    currency: z.string().max(12).nullable(),
    number: z.number().int().min(1000).max(9999),
    financial_year: readYear,
    description: text,
    active: z.boolean(),
    balance_brought_forward: nullableMoney,
    balance_carried_forward: nullableMoney,
  })
  .strict();
export const yearsRead = z
  .object({
    company_id: readCompany,
    retrieved_at: z.number().int(),
    complete: z.boolean(),
    years: z
      .array(
        z
          .object({ id: readYear, from: accountingDate, to: accountingDate })
          .strict(),
      )
      .max(500),
  })
  .strict();
const dimensionRule = z.enum(["REQUIRED", "ALLOWED", "NOTALLOWED", "UNKNOWN"]);
export const referencesRead = z
  .object({
    company_id: readCompany,
    financial_year: readYear,
    retrieved_at: z.number().int(),
    complete: z.boolean(),
    account_numbers: referenceAccountNumbers.optional(),
    validation_verified: z.boolean(),
    year: z.object({ id: readYear, from: z.string(), to: z.string() }).strict(),
    locked_through: z.string().nullable(),
    accounts: z.array(
      z
        .object({
          number: z.number().int(),
          active: z.boolean(),
          cost_center: dimensionRule,
          project: dimensionRule,
          information: dimensionRule,
        })
        .strict(),
    ),
    series: z.array(
      z.object({ code: z.string(), manual: z.boolean() }).strict(),
    ),
    cost_centers: z.array(
      z.object({ code: z.string(), active: z.boolean() }).strict(),
    ),
    projects: z.array(
      z.object({ code: z.string(), active: z.boolean() }).strict(),
    ),
  })
  .strict();
export const readEvidence = z
  .object({
    retrieved_at: z.string(),
    retrieval_started_at: z.string(),
    complete: z.boolean(),
    sources: z.array(z.string()),
    warnings: z.array(z.string()),
    financial_year: readYear.optional(),
  })
  .strict();
export const readError = z
  .object({
    status: z.literal("error"),
    error: z
      .object({
        code: z.string(),
        reason: z.string(),
        provider_code: z.string().nullable(),
        correlation_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
export function readOutput(data: z.ZodType) {
  return z
    .object({
      status: z.literal("ok"),
      company_id: readCompany.optional(),
      data,
      evidence: readEvidence,
      continuation: z.string().uuid().nullable(),
    })
    .strict();
}
const companyInput = z.object({ company_id: readCompany }).strict();
const yearInput = companyInput.extend({ financial_year: readYear }).strict();
const paging = {
  limit: z.number().int().min(1).max(100).optional(),
  continuation: z.string().uuid().optional(),
};
const invoiceInput = companyInput.extend({ number: readNumber }).strict();
const voucherInput = yearInput
  .extend({ series: z.string().regex(/^[A-Z0-9]{1,8}$/), number: readYear })
  .strict();
const list = (item: z.ZodType) =>
  z
    .object({
      items: z.array(item).max(100),
      count: z.number().int().min(0).max(100),
    })
    .strict();
export type ReadModule =
  | "customer_invoices"
  | "supplier_invoices"
  | "vouchers"
  | "accounts";
export interface ReadDefinition {
  path: string;
  input: z.ZodObject;
  data: z.ZodType;
  module?: ReadModule;
  scope?: string;
  list?: boolean;
}
export const readDefinitions = {
  get_capabilities: {
    path: "/capabilities",
    input: z.object({}).strict(),
    data: z.object({ operations: z.array(z.string()) }).strict(),
  },
  list_companies: {
    path: "/companies",
    input: z.object({}).strict(),
    data: z
      .object({ companies: z.array(companySummary), count: z.number().int() })
      .strict(),
  },
  get_connection_status: {
    path: "/companies/:company_id/connection-status",
    input: companyInput,
    data: companySummary,
  },
  get_company_profile: {
    path: "/companies/:company_id/profile",
    input: companyInput,
    data: z
      .object({ name: z.string(), organization_number: z.string() })
      .strict(),
    scope: "companyinformation",
  },
  list_financial_years: {
    path: "/companies/:company_id/financial-years",
    input: companyInput,
    data: yearsRead,
    scope: "bookkeeping",
  },
  get_accounting_references: {
    path: "/companies/:company_id/financial-years/:financial_year/accounting-references",
    input: yearInput
      .extend({ account_numbers: referenceAccountNumbers.optional() })
      .strict(),
    data: referencesRead,
    scope: "bookkeeping",
  },
  list_invoices: {
    path: "/companies/:company_id/customer-invoices",
    input: companyInput.extend(paging).strict(),
    data: list(invoiceSummary),
    module: "customer_invoices",
    scope: "invoice",
    list: true,
  },
  get_invoice: {
    path: "/companies/:company_id/customer-invoices/:number",
    input: invoiceInput,
    data: invoiceDetails,
    module: "customer_invoices",
    scope: "invoice",
  },
  list_supplier_invoices: {
    path: "/companies/:company_id/supplier-invoices",
    input: companyInput.extend(paging).strict(),
    data: list(invoiceSummary),
    module: "supplier_invoices",
    scope: "supplierinvoice",
    list: true,
  },
  get_supplier_invoice: {
    path: "/companies/:company_id/supplier-invoices/:number",
    input: invoiceInput,
    data: invoiceDetails,
    module: "supplier_invoices",
    scope: "supplierinvoice",
  },
  list_vouchers: {
    path: "/companies/:company_id/financial-years/:financial_year/vouchers",
    input: yearInput.extend(paging).strict(),
    data: list(voucherSummary),
    module: "vouchers",
    scope: "bookkeeping",
    list: true,
  },
  get_voucher: {
    path: "/companies/:company_id/financial-years/:financial_year/vouchers/:series/:number",
    input: voucherInput,
    data: voucherDetails,
    module: "vouchers",
    scope: "bookkeeping",
  },
  list_accounts: {
    path: "/companies/:company_id/financial-years/:financial_year/accounts",
    input: yearInput.extend(paging).strict(),
    data: list(accountRead),
    module: "accounts",
    scope: "bookkeeping",
    list: true,
  },
  get_account: {
    path: "/companies/:company_id/financial-years/:financial_year/accounts/:number",
    input: yearInput
      .extend({ number: z.number().int().min(1000).max(9999) })
      .strict(),
    data: accountRead,
    module: "accounts",
    scope: "bookkeeping",
  },
} satisfies Record<string, ReadDefinition>;
export type ReadOperation = keyof typeof readDefinitions;
export const readOperationNames = Object.keys(
  readDefinitions,
) as ReadOperation[];
export const financialReadQuery = z
  .object({
    company_id: readCompany,
    financial_year: readYear.optional(),
    number: z.union([readNumber, readYear]).optional(),
    series: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    continuation: z.string().uuid().optional(),
  })
  .strict();

export type FinancialReadQuery = z.infer<typeof financialReadQuery>;
