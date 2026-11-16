import {
  type Actor,
  accountingDate,
  assertFeature,
  assertScopeProgram,
  type Connections,
  DomainError,
  decimalText,
  type FinancialReadProvider,
  type FinancialReadQuery,
  hasPermission,
  type ReadModule,
  type ReadOperation,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import {
  FortnoxHttp,
  type ProviderContext,
  ProviderError,
  type ProviderOperation,
  providerOperations,
} from "./http.js";

const integer = z
  .string()
  .regex(/^\d{1,15}$/)
  .transform(Number)
  .pipe(z.number().int().safe());
const text = z.string().max(4096);
const optionalText = text.nullish();
const bool = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true");
const money = decimalText.nullish();
const date = accountingDate.or(z.literal("")).nullish();
const invoiceFields = {
  InvoiceDate: date,
  DueDate: date,
  Currency: z.string().max(12).nullish(),
  Total: money,
  Balance: money,
  Booked: bool.nullish(),
  Cancelled: bool.nullish(),
  Sent: bool.nullish(),
  Credit: z.union([z.boolean(), text]).nullish(),
  InvoiceNumber: optionalText,
};
const rawRow = z.object({
  Account: integer.nullish(),
  AccountNumber: integer.nullish(),
  Description: optionalText,
  ItemDescription: optionalText,
  DeliveredQuantity: money,
  Quantity: money,
  Price: money,
  Total: money,
  Debit: money,
  Credit: money,
  VAT: money,
  CostCenter: optionalText,
  Project: optionalText,
});
const customer = z.object({
  ...invoiceFields,
  DocumentNumber: z.string().regex(/^[1-9]\d{0,11}$/),
  CustomerNumber: optionalText,
  CustomerName: optionalText,
});
const supplier = z.object({
  ...invoiceFields,
  GivenNumber: z.string().regex(/^[1-9]\d{0,11}$/),
  SupplierNumber: optionalText,
  SupplierName: optionalText,
});
const voucher = z.object({
  Currency: z.string().max(12).nullish(),
  Year: integer,
  VoucherSeries: z.string().regex(/^[A-Z0-9]{1,8}$/),
  VoucherNumber: integer,
  TransactionDate: accountingDate,
  Description: text,
  ReferenceNumber: optionalText,
  ReferenceType: optionalText,
});
const account = z.object({
  Currency: z.string().max(12).nullish(),
  Number: integer,
  Year: integer,
  Description: text,
  Active: bool,
  BalanceBroughtForward: money,
  BalanceCarriedForward: money,
});
const voucherRow = z.object({
  Account: integer,
  Debit: decimalText,
  Credit: decimalText,
  Removed: bool,
  Description: optionalText,
  TransactionInformation: optionalText,
  Quantity: money,
  CostCenter: optionalText,
  Project: optionalText,
});
const invoice = (raw: z.infer<typeof customer> | z.infer<typeof supplier>) => ({
  number: "DocumentNumber" in raw ? raw.DocumentNumber : raw.GivenNumber,
  kind: "DocumentNumber" in raw ? "customer" : "supplier",
  counterparty_number:
    "CustomerNumber" in raw
      ? (raw.CustomerNumber ?? null)
      : "SupplierNumber" in raw
        ? (raw.SupplierNumber ?? null)
        : null,
  counterparty_name:
    "CustomerName" in raw
      ? (raw.CustomerName ?? null)
      : "SupplierName" in raw
        ? (raw.SupplierName ?? null)
        : null,
  invoice_number: raw.InvoiceNumber ?? null,
  invoice_date: raw.InvoiceDate || null,
  due_date: raw.DueDate || null,
  currency: raw.Currency ?? null,
  total: raw.Total ?? null,
  balance: raw.Balance ?? null,
  booked: raw.Booked ?? null,
  cancelled: raw.Cancelled ?? null,
  sent: raw.Sent ?? null,
  credit:
    raw.Credit === true || raw.Credit === "true"
      ? true
      : raw.Credit === false || raw.Credit === "false"
        ? false
        : null,
});
const mapRow = (row: z.infer<typeof rawRow>) => ({
  account: row.Account ?? row.AccountNumber ?? null,
  description: row.Description ?? row.ItemDescription ?? null,
  quantity: row.DeliveredQuantity ?? row.Quantity ?? null,
  price: row.Price ?? null,
  total: row.Total ?? null,
  debit: row.Debit ?? null,
  credit: row.Credit ?? null,
  vat: row.VAT ?? null,
  cost_center: row.CostCenter ?? null,
  project: row.Project ?? null,
});
const mapVoucher = (v: z.infer<typeof voucher>) => ({
  currency: v.Currency ?? null,
  financial_year: v.Year,
  series: v.VoucherSeries,
  number: v.VoucherNumber,
  date: v.TransactionDate,
  description: v.Description,
  reference_number: v.ReferenceNumber ?? null,
  reference_type: v.ReferenceType ?? null,
});
interface Mapping {
  operation: ProviderOperation;
  module: ReadModule;
  envelope: string;
  list: boolean;
  schema: z.ZodType;
  map: (value: unknown) => unknown;
}
function mapping<T>(
  operation: ProviderOperation,
  module: ReadModule,
  envelope: string,
  list: boolean,
  schema: z.ZodType<T>,
  map: (value: T) => unknown,
): Mapping {
  return {
    operation,
    module,
    envelope,
    list,
    schema,
    map: (value) => map(schema.parse(value)),
  };
}
const customerDetails = customer.extend({
  InvoiceRows: z.array(rawRow).max(10000),
});
const supplierDetails = supplier.extend({
  SupplierInvoiceRows: z.array(rawRow).max(10000),
});
const voucherDetails = voucher.extend({
  VoucherRows: z.array(voucherRow).max(10000),
});
const mappings: Partial<Record<ReadOperation, Mapping>> = {
  list_invoices: mapping(
    "read_invoices",
    "customer_invoices",
    "Invoices",
    true,
    customer,
    invoice,
  ),
  get_invoice: mapping(
    "read_invoice",
    "customer_invoices",
    "Invoice",
    false,
    customerDetails,
    (v) => ({ ...invoice(v), rows: v.InvoiceRows.map(mapRow) }),
  ),
  list_supplier_invoices: mapping(
    "read_supplier_invoices",
    "supplier_invoices",
    "SupplierInvoices",
    true,
    supplier,
    invoice,
  ),
  get_supplier_invoice: mapping(
    "read_supplier_invoice",
    "supplier_invoices",
    "SupplierInvoice",
    false,
    supplierDetails,
    (v) => ({ ...invoice(v), rows: v.SupplierInvoiceRows.map(mapRow) }),
  ),
  list_vouchers: mapping(
    "read_vouchers",
    "vouchers",
    "Vouchers",
    true,
    voucher,
    mapVoucher,
  ),
  get_voucher: mapping(
    "read_voucher",
    "vouchers",
    "Voucher",
    false,
    voucherDetails,
    (v) => ({
      ...mapVoucher(v),
      rows: v.VoucherRows.map((r) => ({
        account: r.Account,
        debit: r.Debit,
        credit: r.Credit,
        removed: r.Removed,
        description: r.Description ?? null,
        information: r.TransactionInformation ?? null,
        quantity: r.Quantity ?? null,
        cost_center: r.CostCenter ?? null,
        project: r.Project ?? null,
      })),
    }),
  ),
  list_accounts: mapping(
    "read_accounts",
    "accounts",
    "Accounts",
    true,
    account,
    (v) => ({
      currency: v.Currency ?? null,
      number: v.Number,
      financial_year: v.Year,
      description: v.Description,
      active: v.Active,
      balance_brought_forward: v.BalanceBroughtForward ?? null,
      balance_carried_forward: v.BalanceCarriedForward ?? null,
    }),
  ),
  get_account: mapping(
    "read_account",
    "accounts",
    "Account",
    false,
    account,
    (v) => ({
      currency: v.Currency ?? null,
      number: v.Number,
      financial_year: v.Year,
      description: v.Description,
      active: v.Active,
      balance_brought_forward: v.BalanceBroughtForward ?? null,
      balance_carried_forward: v.BalanceCarriedForward ?? null,
    }),
  ),
};
export class FortnoxRawFinancialReads implements FinancialReadProvider {
  readonly http: FortnoxHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly modules: readonly ReadModule[],
    readonly testTenants: readonly string[] = provider.config.testTenants ?? [],
  ) {
    this.http = new FortnoxHttp({
      fetch: provider.config.fetch,
      state: connections.state,
    });
  }
  async read(
    actor: Actor,
    operation: ReadOperation,
    input: FinancialReadQuery,
    page: number,
  ) {
    const spec = mappings[operation];
    if (
      !spec ||
      !this.modules.includes(spec.module) ||
      !hasPermission(actor, "read") ||
      !hasPermission(actor, "finance_read")
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const c = await this.connections.authorizeActor(actor, input.company_id);
    if (!this.testTenants.includes(c.tenant))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const upstream = providerOperations[spec.operation];
    assertScopeProgram(c, upstream.scope);
    if (["accounts", "vouchers"].includes(spec.module))
      assertFeature(c, "references");
    if (!c.scopes.includes(upstream.scope))
      throw new ProviderError("CAPABILITY_UNAVAILABLE", "missing_scope");
    const context: ProviderContext = {
      owner: actor.ownerId,
      company: c.id,
      generation: c.generation,
      tenant: c.tenant,
      clientId: (await this.connections.credentials(actor.ownerId, c)).clientId,
      token: (force) => this.provider.token(actor.ownerId, c, force),
      assertActive: async () => {
        const current = await this.connections.authorizeActor(actor, c.id);
        assertScopeProgram(current, upstream.scope);
        if (["accounts", "vouchers"].includes(spec.module))
          assertFeature(current, "references");
        if (
          current.generation !== c.generation ||
          !current.scopes.includes(upstream.scope)
        )
          throw new DomainError("COMPANY_FORBIDDEN");
      },
    };
    const parameters = {
      ...(input.financial_year !== undefined
        ? { financialYear: input.financial_year }
        : {}),
      ...(spec.list ? { page, limit: input.limit ?? 100 } : {}),
      ...(["get_invoice", "get_supplier_invoice"].includes(operation)
        ? { documentNumber: String(input.number) }
        : {}),
      ...(operation === "get_account"
        ? { accountNumber: Number(input.number) }
        : {}),
      ...(operation === "get_voucher"
        ? {
            voucher: {
              series: input.series ?? "",
              number: Number(input.number),
            },
          }
        : {}),
    };
    const raw = await this.http.read(context, spec.operation, parameters);
    try {
      const body = z.record(z.string(), z.unknown()).parse(raw);
      const values = spec.list
        ? z
            .array(z.unknown())
            .max(input.limit ?? 100)
            .parse(body[spec.envelope])
        : [body[spec.envelope]];
      const items = values.map(spec.map);
      for (const value of items) {
        const item = z.record(z.string(), z.unknown()).parse(value);
        if (
          input.financial_year !== undefined &&
          item.financial_year !== input.financial_year
        )
          throw new DomainError("COMPANY_FORBIDDEN");
        if (
          !spec.list &&
          (String(item.number) !== String(input.number) ||
            (operation === "get_voucher" && item.series !== input.series))
        )
          throw new DomainError("COMPANY_FORBIDDEN");
      }
      let next: number | null = null;
      if (spec.list) {
        const meta = z
          .object({
            "@CurrentPage": integer,
            "@TotalPages": integer,
            "@TotalResources": integer.optional(),
          })
          .parse(body.MetaInformation);
        const empty =
          page === 1 &&
          items.length === 0 &&
          meta["@TotalPages"] === 0 &&
          meta["@TotalResources"] === 0 &&
          [0, 1].includes(meta["@CurrentPage"]);
        if (
          !empty &&
          (meta["@CurrentPage"] !== page ||
            meta["@TotalPages"] < page ||
            items.length === 0)
        )
          throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
        next = page < meta["@TotalPages"] ? page + 1 : null;
      }
      await context.assertActive();
      return {
        data: spec.list ? { items, count: items.length } : items[0],
        next,
        source: `Fortnox GET ${upstream.path}`,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "invalid_financial_read_response",
      );
    }
  }
}
