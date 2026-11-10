import {
  type AccountingActor,
  type BusinessWriteResult,
  type Connections,
  DomainError,
  parseAmount,
  registerVersion,
  retainedDocumentRow,
  type SalesDocumentPage,
  type SalesDocumentProvider,
  type SalesDocumentRecord,
  type SalesHeader,
  type SalesResource,
  type SalesWriteAction,
  salesActions,
  salesDocumentId,
  salesHeaderSchemas,
  salesOperationIds,
  salesQueries,
  salesRowSchemas,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";

// Independent finite endpoint mapping. No caller-selected URL or HTTP verb.
export const salesProviderResources = {
  offer: { path: "offers", single: "Offer", list: "Offers", rows: "OfferRows" },
  order: { path: "orders", single: "Order", list: "Orders", rows: "OrderRows" },
  invoice: {
    path: "invoices",
    single: "Invoice",
    list: "Invoices",
    rows: "InvoiceRows",
  },
} as const;
const suffixes = {
  email: "email",
  cancel: "cancel",
  bookkeep: "bookkeep",
  credit: "credit",
  to_order: "createorder",
  to_invoice: "createinvoice",
} as const;
const stringValue = z.string().max(20000).nullable();
const headerKeys = [
  "CustomerNumber",
  "Currency",
  "VATIncluded",
  "Comments",
  "TermsOfPayment",
  "OurReference",
  "YourReference",
  "OfferDate",
  "ExpireDate",
  "OrderDate",
  "InvoiceDate",
  "DueDate",
  "InvoiceType",
  "NotCompleted",
] as const;
const rowKeys = [
  "RowId",
  "AccountNumber",
  "Description",
  "Price",
  "VAT",
  "Unit",
  "CostCenter",
  "Project",
  "Quantity",
  "OrderedQuantity",
  "DeliveredQuantity",
] as const;
const decimalKeys = new Set(["Price", "VAT"]);
const quantityKeys = new Set([
  "Quantity",
  "OrderedQuantity",
  "DeliveredQuantity",
]);
const reviewedSourceRowKeys = new Set<string>([
  ...rowKeys,
  "@url",
  "ArticleNumber",
  "ContributionPercent",
  "ContributionValue",
  "Cost",
  "Discount",
  "DiscountType",
  "EAN",
  "HouseWork",
  "HouseWorkHoursToReport",
  "HouseWorkType",
  "ReservedQuantity",
  "StockPointCode",
  "StockPointId",
  "Total",
  "TotalExcludingVAT",
  "PriceExcludingVAT",
  "VATCode",
]);
const sourceReference = (raw: unknown): string | null =>
  raw === null || raw === undefined || raw === "" || raw === "0"
    ? null
    : salesDocumentId.parse(raw);
const observedBoolean = (raw: unknown): boolean | null =>
  typeof raw === "boolean" ? raw : null;
function projectFields(source: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const key of headerKeys) {
    if (!Object.hasOwn(source, key)) continue;
    if (key === "VATIncluded" || key === "NotCompleted")
      fields[key] = z.boolean().nullable().parse(source[key]);
    else fields[key] = stringValue.parse(source[key]);
  }
  if (
    source.EmailInformation !== undefined &&
    source.EmailInformation !== null
  ) {
    const info = z
      .record(z.string(), z.unknown())
      .parse(source.EmailInformation);
    fields.EmailInformation = Object.fromEntries(
      [
        "EmailAddressTo",
        "EmailAddressCC",
        "EmailAddressBCC",
        "EmailSubject",
        "EmailBody",
      ]
        .filter((key) => Object.hasOwn(info, key))
        .map((key) => [key, stringValue.parse(info[key])]),
    );
  }
  return fields;
}
function projectRow(source: unknown) {
  const raw = z.record(z.string(), z.unknown()).parse(source);
  const row: Record<string, unknown> = {};
  for (const key of rowKeys) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    if (key === "AccountNumber") {
      row[key] = z
        .string()
        .regex(/^\d{4}$/)
        .transform(Number)
        .nullable()
        .parse(value);
    } else row[key] = stringValue.parse(value);
  }
  // Empty optional dimensions mean no selected reference in the bounded domain.
  for (const key of ["Unit", "CostCenter", "Project"])
    if (row[key] === "" || row[key] === null) delete row[key];
  return { raw, row };
}
function ordinaryRows(rows: Record<string, unknown>[]) {
  return rows.every(
    (r) =>
      Object.keys(r).every((key) => reviewedSourceRowKeys.has(key)) &&
      (r.ArticleNumber === undefined ||
        r.ArticleNumber === "" ||
        r.ArticleNumber === null) &&
      (r.Discount === undefined ||
        r.Discount === "0" ||
        r.Discount === "0.0" ||
        r.Discount === "0.00") &&
      (r.HouseWork === undefined || r.HouseWork === false) &&
      (r.HouseWorkType === undefined ||
        r.HouseWorkType === "" ||
        r.HouseWorkType === null) &&
      (r.VATCode === undefined || r.VATCode === "" || r.VATCode === null) &&
      (r.StockPointCode === undefined ||
        r.StockPointCode === "" ||
        r.StockPointCode === null),
  );
}
function zeroOrAbsent(raw: unknown) {
  return (
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && /^0(?:\.0+)?$/.test(raw))
  );
}
export async function projectSalesDocument(
  resource: SalesResource,
  source: unknown,
  detail = true,
): Promise<SalesDocumentRecord> {
  const raw = z.record(z.string(), z.unknown()).parse(source);
  const id = salesDocumentId.parse(raw.DocumentNumber);
  const fields = projectFields(raw);
  const suppliedRows = raw[salesProviderResources[resource].rows];
  const sourceRows =
    suppliedRows === undefined
      ? []
      : z.array(z.unknown()).max(100).parse(suppliedRows);
  const projected = sourceRows.map(projectRow);
  const rows = projected.map((r) => r.row);
  const observed = {
    cancelled: observedBoolean(raw.Cancelled),
    booked: resource === "invoice" ? observedBoolean(raw.Booked) : false,
    sent: observedBoolean(raw.Sent),
    credit:
      resource === "invoice"
        ? raw.Credit === "true"
          ? true
          : raw.Credit === "false"
            ? false
            : null
        : false,
    order_reference: sourceReference(raw.OrderReference),
    invoice_reference: sourceReference(raw.InvoiceReference),
    credit_reference: sourceReference(raw.CreditInvoiceReference),
    offer_reference: sourceReference(raw.OfferReference),
  };
  const complete =
    detail &&
    suppliedRows !== undefined &&
    observed.cancelled !== null &&
    observed.booked !== null &&
    observed.sent !== null &&
    observed.credit !== null;
  const editable =
    complete &&
    rows.length > 0 &&
    rows.length <= 20 &&
    salesHeaderSchemas[resource].safeParse(fields).success &&
    rows.every((row) => salesRowSchemas[resource].safeParse(row).success) &&
    ordinaryRows(projected.map((r) => r.raw)) &&
    zeroOrAbsent(raw.Freight) &&
    zeroOrAbsent(raw.AdministrationFee) &&
    (raw.HouseWork === undefined || raw.HouseWork === false) &&
    (raw.CurrencyRate === undefined ||
      (typeof raw.CurrencyRate === "string" &&
        /^1(?:\.0+)?$/.test(raw.CurrencyRate)));
  const { "@url": _url, ...versioned } = raw;
  return {
    id,
    fields,
    rows,
    observed,
    complete,
    editable,
    version: await registerVersion(versioned),
  };
}

export function serializeSalesDocument(
  resource: SalesResource,
  fields: SalesHeader,
  rows: unknown[],
) {
  const header = salesHeaderSchemas[resource].parse(fields);
  const parsedRows = z
    .array(z.union([salesRowSchemas[resource], retainedDocumentRow]))
    .min(1)
    .max(20)
    .parse(rows);
  const encodedRows = parsedRows.map(
    (row) =>
      `{${Object.entries(row)
        .map(([key, value]) => {
          const encoded = decimalKeys.has(key)
            ? parseAmount(value, 6)
            : key === "RowId"
              ? salesDocumentId.parse(value)
              : quantityKeys.has(key)
                ? JSON.stringify(value)
                : JSON.stringify(value);
          return `${JSON.stringify(key)}:${encoded}`;
        })
        .join(",")}}`,
  );
  const entries = Object.entries(header).map(
    ([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`,
  );
  entries.push(
    `${JSON.stringify(salesProviderResources[resource].rows)}:[${encodedRows.join(",")}]`,
  );
  return `{${JSON.stringify(salesProviderResources[resource].single)}:{${entries.join(",")}}}`;
}

export class FortnoxSalesDocuments implements SalesDocumentProvider {
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly enabled: readonly string[] = [],
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
  ) {
    if (enabled.some((op) => !salesOperationIds.includes(op)))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    this.http = new DocumentHttp(connections, provider, enabled, active, now);
  }
  private url(
    resource: SalesResource,
    id: string | null,
    action?: SalesWriteAction,
  ) {
    let path = `/3/${salesProviderResources[resource].path}`;
    if (id !== null) path += `/${salesDocumentId.parse(id)}`;
    if (action && action !== "create" && action !== "update")
      path += `/${suffixes[action]}`;
    return new URL(path, "https://api.fortnox.se");
  }
  async get(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    id: string,
  ) {
    const context = await this.http.context(
      actor,
      company,
      `${resource}.get`,
      resource,
    );
    const raw = await this.http.read(context, this.url(resource, id));
    let record: SalesDocumentRecord;
    try {
      record = await projectSalesDocument(
        resource,
        raw[salesProviderResources[resource].single],
      );
    } catch {
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "invalid_document_response",
      );
    }
    if (record.id !== id)
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "reference_mismatch");
    return record;
  }
  async page(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    query: Record<string, string>,
    page: number,
    until: number,
  ): Promise<SalesDocumentPage> {
    const context = await this.http.context(
      actor,
      company,
      `${resource}.list`,
      resource,
    );
    const url = this.url(resource, null);
    // Only the domain's reviewed filters can enter this internal adapter.
    const parsed = salesQueries[resource].parse(query);
    for (const [key, value] of Object.entries(parsed))
      if (value !== undefined) url.searchParams.set(key, value);
    z.number().int().min(1).max(10000).parse(page);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "100");
    const raw = await this.http.read(context, url, until);
    const records: SalesDocumentRecord[] = [];
    try {
      for (const value of z
        .array(z.unknown())
        .max(100)
        .parse(raw[salesProviderResources[resource].list]))
        records.push(await projectSalesDocument(resource, value, false));
    } catch {
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "invalid_document_response",
      );
    }
    const int = z
      .string()
      .regex(/^\d{1,6}$/)
      .transform(Number);
    const meta = z
      .object({ "@CurrentPage": int, "@TotalPages": int })
      .safeParse(raw.MetaInformation);
    if (!meta.success) return { records, complete: false, next_page: null };
    const current = meta.data["@CurrentPage"],
      total = meta.data["@TotalPages"];
    if (
      current !== page ||
      (total < current && !(total === 0 && page === 1 && records.length === 0))
    )
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
    return {
      records,
      complete: current >= total,
      next_page: current < total ? current + 1 : null,
    };
  }
  async write(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    action: SalesWriteAction,
    input: {
      id: string | null;
      version: string | null;
      fields: SalesHeader | null;
      rows: unknown[] | null;
    },
    beforeDispatch: () => Promise<void>,
  ): Promise<BusinessWriteResult> {
    if (!(salesActions[resource] as readonly string[]).includes(action))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if ((action === "create") !== (input.id === null))
      throw new DomainError("VALIDATION_FAILED");
    const context = await this.http.context(
      actor,
      company,
      `${resource}.${action}`,
      resource,
      true,
    );
    const body =
      action === "create" || action === "update"
        ? serializeSalesDocument(
            resource,
            input.fields as SalesHeader,
            input.rows as unknown[],
          )
        : undefined;
    const before =
      input.id === null
        ? null
        : await this.get(actor, company, resource, input.id);
    if (before && before.version !== input.version)
      throw new DomainError("PROPOSAL_STALE");
    const intendedRows = (input.rows ?? []).map((raw) => {
      const row = z.record(z.string(), z.unknown()).parse(raw);
      return Object.keys(row).length === 1
        ? before?.rows.find((r) => r.RowId === row.RowId)
        : row;
    });
    if (intendedRows.some((row) => !row))
      throw new DomainError("VALIDATION_FAILED");
    const raw = await this.http.submit(
      context,
      this.url(resource, input.id, action),
      action === "create" ? "POST" : action === "email" ? "GET" : "PUT",
      body,
      beforeDispatch,
    );
    let reference: string | undefined;
    try {
      if (!raw) return { state: "outcome_unknown" };
      const returned = z
        .record(z.string(), z.unknown())
        .parse(raw[salesProviderResources[resource].single]);
      reference = salesDocumentId.parse(returned.DocumentNumber);
      if (input.id !== null && reference !== input.id)
        return { state: "outcome_unknown" };
      const source = await this.get(actor, company, resource, reference);
      if (
        action === "to_order" ||
        action === "to_invoice" ||
        action === "credit"
      ) {
        const target: SalesResource =
          action === "to_order" ? "order" : "invoice";
        const targetId =
          action === "to_order"
            ? source.observed.order_reference
            : action === "credit"
              ? source.observed.credit_reference
              : source.observed.invoice_reference;
        if (!targetId) return { state: "outcome_unknown", reference };
        const created = await this.get(actor, company, target, targetId);
        const related =
          action === "credit"
            ? created.observed.credit === true
            : resource === "offer"
              ? created.observed.offer_reference === reference
              : created.observed.order_reference === reference;
        return {
          state: related ? "succeeded" : "outcome_unknown",
          reference: targetId,
        };
      }
      if (action === "create" || action === "update") {
        const requested = salesHeaderSchemas[resource].parse(input.fields);
        const fieldsMatch = Object.entries(requested).every(
          ([key, value]) =>
            JSON.stringify(source.fields[key]) === JSON.stringify(value),
        );
        // Compare the entire intended result after IDs have been regenerated.
        const allFull = intendedRows.map((r) =>
          salesRowSchemas[resource].safeParse(r),
        );
        const rowsMatch =
          allFull.every((r) => r.success) &&
          intendedRows.length === source.rows.length &&
          allFull.every(
            (r, i) =>
              r.success &&
              Object.entries(r.data)
                .filter(([key]) => key !== "RowId")
                .every(([key, value]) =>
                  decimalKeys.has(key) || quantityKeys.has(key)
                    ? parseAmount(source.rows[i]?.[key], 6) ===
                      parseAmount(value, 6)
                    : source.rows[i]?.[key] === value,
                ),
          );
        return {
          state: fieldsMatch && rowsMatch ? "succeeded" : "outcome_unknown",
          reference,
        };
      }
      const verified =
        action === "email"
          ? source.observed.sent === true
          : action === "cancel"
            ? source.observed.cancelled === true
            : source.observed.booked === true;
      return { state: verified ? "succeeded" : "outcome_unknown", reference };
    } catch {
      return { state: "outcome_unknown", ...(reference ? { reference } : {}) };
    }
  }
}
