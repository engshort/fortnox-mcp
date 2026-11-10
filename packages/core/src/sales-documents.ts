import { z } from "zod";
import { accountingDate } from "./accounting.js";
import type { AccountingActor, AccountingProvider } from "./bookkeeping.js";
import {
  type BusinessOperation,
  type BusinessWriteResult,
  BusinessWrites,
  type PreparedBusinessWrite,
} from "./business-writes.js";
import type { Connections } from "./connections.js";
import {
  planDocumentRows,
  type SalesResource,
  type SalesRow,
  salesRowSchemas,
  salesRowsInput,
  validateDocumentAccounts,
} from "./document-rows.js";
import { DomainError } from "./errors.js";
import { parseAmount } from "./money.js";
import { type Registers, registerId, registerVersion } from "./registers.js";

export const salesDocumentId = z.string().regex(/^[1-9]\d{0,11}$/);
const email = z
  .object({
    EmailAddressTo: z.email().max(254),
    EmailAddressCC: z.literal(""),
    EmailAddressBCC: z.literal(""),
    EmailSubject: z.string().min(1).max(100),
    EmailBody: z.string().min(1).max(20000),
  })
  .strict();
const common = {
  CustomerNumber: registerId,
  Currency: z.literal("SEK"),
  VATIncluded: z.literal(false),
  Comments: z.string().max(1000).optional(),
  TermsOfPayment: registerId,
  OurReference: z.string().max(50).optional(),
  YourReference: z.string().max(50).optional(),
  EmailInformation: email.optional(),
};
export const salesHeaderSchemas = {
  offer: z
    .object({
      ...common,
      OfferDate: accountingDate,
      ExpireDate: accountingDate,
      NotCompleted: z.boolean(),
    })
    .strict(),
  order: z
    .object({ ...common, OrderDate: accountingDate, NotCompleted: z.boolean() })
    .strict(),
  invoice: z
    .object({
      ...common,
      InvoiceDate: accountingDate,
      DueDate: accountingDate,
      InvoiceType: z.literal("INVOICE"),
    })
    .strict(),
} as const;
export type SalesHeader = z.infer<(typeof salesHeaderSchemas)[SalesResource]>;
export const salesActions = {
  offer: [
    "list",
    "get",
    "create",
    "update",
    "email",
    "cancel",
    "to_order",
    "to_invoice",
  ],
  order: ["list", "get", "create", "update", "email", "cancel", "to_invoice"],
  invoice: [
    "list",
    "get",
    "create",
    "update",
    "email",
    "bookkeep",
    "credit",
    "cancel",
  ],
} as const;
export type SalesWriteAction =
  | "create"
  | "update"
  | "email"
  | "cancel"
  | "to_order"
  | "to_invoice"
  | "bookkeep"
  | "credit";
export const salesOperationIds = Object.entries(salesActions).flatMap(
  ([r, actions]) => actions.map((a) => `${r}.${a}`),
);
export const salesQueries = {
  offer: z
    .object({
      customernumber: registerId.optional(),
      filter: z
        .enum([
          "cancelled",
          "expired",
          "completed",
          "notcompleted",
          "ordercreated",
          "ordernotcreated",
        ])
        .optional(),
    })
    .strict(),
  order: z
    .object({
      customernumber: registerId.optional(),
      filter: z
        .enum(["cancelled", "invoicecreated", "invoicenotcreated"])
        .optional(),
    })
    .strict(),
  invoice: z
    .object({
      customernumber: registerId.optional(),
      filter: z
        .enum(["cancelled", "fullypaid", "unpaid", "unbooked", "unpaidoverdue"])
        .optional(),
    })
    .strict(),
};
export interface SalesDocumentRecord {
  id: string;
  version: string;
  fields: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  // False for unmodeled/partial source content. Such records cannot be updated.
  editable: boolean;
  complete: boolean;
  observed: {
    cancelled: boolean | null;
    booked: boolean | null;
    sent: boolean | null;
    credit: boolean | null;
    order_reference: string | null;
    invoice_reference: string | null;
    credit_reference: string | null;
    offer_reference?: string | null;
  };
}
export interface SalesDocumentPage {
  records: SalesDocumentRecord[];
  complete: boolean;
  next_page: number | null;
}
export interface SalesDocumentProvider {
  get(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    id: string,
  ): Promise<SalesDocumentRecord>;
  page(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    query: Record<string, string>,
    page: number,
    until: number,
  ): Promise<SalesDocumentPage>;
  write(
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
  ): Promise<BusinessWriteResult>;
}
export function salesContentHash(
  resource: SalesResource,
  fields: Record<string, unknown>,
  rows: unknown[],
) {
  const exact = new Set([
    "Price",
    "VAT",
    "Quantity",
    "OrderedQuantity",
    "DeliveredQuantity",
  ]);
  const normalized = rows.map((raw) => {
    const row = salesRowSchemas[resource].parse(raw);
    return Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => key !== "RowId")
        .map(([key, value]) => [
          key,
          exact.has(key) ? parseAmount(value, 6) : value,
        ]),
    );
  });
  return registerVersion({ fields, rows: normalized });
}
const pending = z
  .object({
    id: salesDocumentId.nullable(),
    financial_year: z.number().int().positive().safe(),
    fields: z.unknown(),
    rows: z.array(z.unknown()).nullable(),
  })
  .strict();

export class SalesDocuments {
  readonly writes: BusinessWrites;
  constructor(
    readonly connections: Connections,
    readonly provider: SalesDocumentProvider,
    readonly registers: Registers,
    readonly accounting: Pick<AccountingProvider, "references">,
    readonly enabled: readonly string[] = [],
    readonly approvedRecipients: readonly string[] = [],
    readonly now = Date.now,
  ) {
    if (enabled.some((op) => !salesOperationIds.includes(op)))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const operations: Record<string, BusinessOperation> = {};
    for (const resource of Object.keys(salesActions) as SalesResource[])
      for (const action of salesActions[resource]) {
        if (action === "get" || action === "list") continue;
        const operation = `${resource}.${action}`;
        if (enabled.includes(operation) && !enabled.includes(`${resource}.get`))
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        operations[operation] = {
          scope: resource,
          enabled: enabled.includes(operation),
          evidence: async (prepared) => {
            const input = pending.parse(prepared.input);
            const fields =
              input.fields === null
                ? {}
                : salesHeaderSchemas[resource].parse(input.fields);
            const preview = z
              .object({ intended_rows: z.array(z.unknown()).optional() })
              .parse(prepared.preview);
            return {
              target: input.id,
              fields: Object.keys(fields).sort(),
              digest: await salesContentHash(
                resource,
                fields,
                preview.intended_rows ?? [],
              ),
            };
          },
          prepare: (actor, company, raw) =>
            this.prepareBody(actor, company, resource, action, raw),
          validate: async (actor, company, prepared) => {
            const input = pending.parse(prepared.input);
            if (input.id) {
              const current = await this.get(
                actor,
                company,
                resource,
                input.id,
              );
              if (current.record.version !== prepared.baseline)
                throw new DomainError("PROPOSAL_STALE");
              await this.checkAction(
                actor,
                company,
                resource,
                action,
                current.record,
                input.financial_year,
              );
            }
            if (input.fields !== null) {
              const fields = salesHeaderSchemas[resource].parse(input.fields);
              const preview = z
                .object({ intended_rows: z.array(z.unknown()) })
                .parse(prepared.preview);
              const rows = planDocumentRows(
                resource,
                null,
                preview.intended_rows.map((r) => {
                  const { RowId: _id, ...value } = z
                    .record(z.string(), z.unknown())
                    .parse(r);
                  return value;
                }),
              ).intended_rows;
              await this.references(
                actor,
                company,
                resource,
                input.financial_year,
                fields,
                rows,
              );
            }
          },
          // Reconciliation requires operation-specific provider identity evidence.
          // A Sent flag alone is never evidence that this intent sent an email.
          reconcile: async (actor, company, execution) => {
            if (action === "email" || !execution.evidence)
              return { state: "outcome_unknown" };
            const id =
              action === "create"
                ? execution.reference
                : execution.evidence.target;
            if (!id) return { state: "outcome_unknown" };
            try {
              const record = (await this.get(actor, company, resource, id))
                .record;
              if (!record.complete) return { state: "outcome_unknown" };
              if (action === "create" || action === "update") {
                const fields = Object.fromEntries(
                  execution.evidence.fields.map((key) => [
                    key,
                    record.fields[key],
                  ]),
                );
                if (
                  (await salesContentHash(resource, fields, record.rows)) ===
                  execution.evidence.digest
                )
                  return { state: "succeeded", reference: id };
              } else if (
                (action === "cancel" && record.observed.cancelled === true) ||
                (action === "bookkeep" && record.observed.booked === true)
              ) {
                return { state: "succeeded", reference: id };
              } else if (
                action === "to_order" ||
                action === "to_invoice" ||
                action === "credit"
              ) {
                const target: SalesResource =
                  action === "to_order" ? "order" : "invoice";
                const reference =
                  action === "to_order"
                    ? record.observed.order_reference
                    : action === "credit"
                      ? record.observed.credit_reference
                      : record.observed.invoice_reference;
                if (reference) {
                  const result = (
                    await this.get(actor, company, target, reference)
                  ).record;
                  if (
                    result.complete &&
                    (action === "credit"
                      ? result.observed.credit === true
                      : resource === "offer"
                        ? result.observed.offer_reference === id
                        : result.observed.order_reference === id)
                  )
                    return { state: "succeeded", reference };
                }
              }
            } catch {
              /* Unavailable, partial or mismatched content remains uncertain. */
            }
            return { state: "outcome_unknown" };
          },
          dispatch: async (actor, company, prepared, beforeDispatch) => {
            const input = pending.parse(prepared.input);
            return provider.write(
              actor,
              company,
              resource,
              action,
              {
                id: input.id,
                version: prepared.baseline,
                fields:
                  input.fields === null
                    ? null
                    : salesHeaderSchemas[resource].parse(input.fields),
                rows: input.rows,
              },
              beforeDispatch,
            );
          },
        };
      }
    this.writes = new BusinessWrites(connections, operations, now);
  }
  private async authorize(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    action: string,
  ) {
    z.string().uuid().parse(company);
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    if (!this.enabled.includes(`${resource}.${action}`))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    if (!c.scopes.includes(resource))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  async get(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    id: string,
  ) {
    salesDocumentId.parse(id);
    const before = await this.authorize(actor, company, resource, "get");
    const record = await this.provider.get(actor, company, resource, id);
    const after = await this.authorize(actor, company, resource, "get");
    if (record.id !== id || before.generation !== after.generation)
      throw new DomainError("COMPANY_FORBIDDEN");
    return { company_id: company, record, complete: record.complete };
  }
  async list(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    raw: unknown = {},
    start = 1,
  ) {
    const before = await this.authorize(actor, company, resource, "list");
    const query = salesQueries[resource].parse(raw);
    z.number().int().min(1).max(10000).parse(start);
    const records: SalesDocumentRecord[] = [],
      seen = new Set<string>();
    const until = this.now() + 15000;
    let page = start,
      next: number | null = start,
      complete = false;
    for (let n = 0; n < 5 && this.now() < until; n++) {
      const result = await this.provider.page(
        actor,
        company,
        resource,
        Object.fromEntries(
          Object.entries(query).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        page,
        until,
      );
      if (
        records.length + result.records.length > 500 ||
        JSON.stringify([...records, ...result.records]).length > 262144
      )
        break;
      for (const record of result.records) {
        if (seen.has(record.id)) throw new DomainError("UPSTREAM_UNAVAILABLE");
        seen.add(record.id);
        records.push(record);
      }
      complete = result.complete;
      next = result.next_page;
      if (complete || next === null) break;
      if (next !== page + 1) throw new DomainError("UPSTREAM_UNAVAILABLE");
      page = next;
    }
    const after = await this.authorize(actor, company, resource, "list");
    if (before.generation !== after.generation)
      throw new DomainError("COMPANY_FORBIDDEN");
    return {
      company_id: company,
      records,
      complete,
      next_page: complete ? null : next,
    };
  }
  private async references(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    year: number,
    fields: SalesHeader,
    rows: SalesRow[],
  ) {
    await this.registers.resolve(
      actor,
      company,
      "customer",
      fields.CustomerNumber,
    );
    await this.registers.resolve(actor, company, "currency", fields.Currency);
    await this.registers.resolve(
      actor,
      company,
      "terms_of_payment",
      fields.TermsOfPayment,
    );
    for (const unit of new Set(
      rows.map((r) => r.Unit).filter((u): u is string => !!u),
    ))
      await this.registers.resolve(actor, company, "unit", unit);
    const date =
      resource === "offer"
        ? (fields as z.infer<typeof salesHeaderSchemas.offer>).OfferDate
        : resource === "order"
          ? (fields as z.infer<typeof salesHeaderSchemas.order>).OrderDate
          : (fields as z.infer<typeof salesHeaderSchemas.invoice>).InvoiceDate;
    const due =
      "DueDate" in fields
        ? fields.DueDate
        : "ExpireDate" in fields
          ? fields.ExpireDate
          : null;
    if (due && due < date) throw new DomainError("VALIDATION_FAILED");
    const accounts = [...new Set(rows.map((r) => r.AccountNumber))];
    const refs = await this.accounting.references(
      actor,
      company,
      year,
      accounts,
    );
    validateDocumentAccounts(
      { company_id: company, financial_year: year, date, rows },
      refs,
      this.now(),
    );
  }
  private async checkAction(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    action: SalesWriteAction,
    record: SalesDocumentRecord,
    year: number,
  ) {
    const state = record.observed;
    if (
      !record.complete ||
      state.cancelled ||
      state.credit ||
      (resource === "offer" &&
        (state.order_reference || state.invoice_reference)) ||
      (resource === "order" && state.invoice_reference) ||
      (resource === "invoice" && state.credit_reference)
    )
      throw new DomainError("VALIDATION_FAILED");
    if (
      (action === "update" || action === "cancel" || action === "bookkeep") &&
      state.booked
    )
      throw new DomainError("VALIDATION_FAILED");
    if (action === "credit" && !state.booked)
      throw new DomainError("VALIDATION_FAILED");
    const target =
      action === "to_order"
        ? "order"
        : action === "to_invoice"
          ? "invoice"
          : null;
    if (target) await this.authorize(actor, company, target, "get");
    if (target && "NotCompleted" in record.fields && record.fields.NotCompleted)
      throw new DomainError("VALIDATION_FAILED");
    if (action === "email") {
      const information = email.parse(record.fields.EmailInformation);
      if (
        state.sent ||
        !this.approvedRecipients.includes(information.EmailAddressTo)
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    }
    if (["bookkeep", "credit", "to_order", "to_invoice"].includes(action)) {
      if (!record.editable) throw new DomainError("CAPABILITY_UNAVAILABLE");
      await this.references(
        actor,
        company,
        resource,
        year,
        salesHeaderSchemas[resource].parse(record.fields),
        record.rows.map((row) => salesRowSchemas[resource].parse(row)),
      );
    }
  }
  private async prepareBody(
    actor: AccountingActor,
    company: string,
    resource: SalesResource,
    action: SalesWriteAction,
    raw: unknown,
  ): Promise<PreparedBusinessWrite> {
    const base = { financial_year: z.number().int().positive().safe() };
    if (action !== "create" && action !== "update") {
      const input = z
        .object({ ...base, id: salesDocumentId })
        .strict()
        .parse(raw);
      const record = (await this.get(actor, company, resource, input.id))
        .record;
      await this.checkAction(
        actor,
        company,
        resource,
        action,
        record,
        input.financial_year,
      );
      return {
        input: { ...input, fields: null, rows: null },
        baseline: record.version,
        preview: {
          resource,
          action,
          provider_id: record.id,
          observed: record.observed,
          ...(action === "email"
            ? {
                recipient: email.parse(record.fields.EmailInformation)
                  .EmailAddressTo,
              }
            : {}),
        },
      };
    }
    const input = z
      .object({
        ...base,
        id: salesDocumentId.optional(),
        fields: z.unknown(),
        rows: salesRowsInput(resource),
        removed_row_ids: z.array(salesDocumentId).max(20),
      })
      .strict()
      .parse(raw);
    if ((action === "create" && input.id) || (action === "update" && !input.id))
      throw new DomainError("VALIDATION_FAILED");
    const before = input.id
      ? (await this.get(actor, company, resource, input.id)).record
      : null;
    if (before) {
      if (!before.editable) throw new DomainError("CAPABILITY_UNAVAILABLE");
      await this.checkAction(
        actor,
        company,
        resource,
        action,
        before,
        input.financial_year,
      );
    }
    const fields = (
      action === "create"
        ? salesHeaderSchemas[resource]
        : salesHeaderSchemas[resource].partial()
    ).parse(input.fields);
    const intended = salesHeaderSchemas[resource].parse({
      ...before?.fields,
      ...fields,
    });
    const plan = planDocumentRows(
      resource,
      before?.rows.map((row) => salesRowSchemas[resource].parse(row)) ?? null,
      input.rows,
      input.removed_row_ids,
    );
    await this.references(
      actor,
      company,
      resource,
      input.financial_year,
      intended,
      plan.intended_rows,
    );
    return {
      input: {
        id: input.id ?? null,
        financial_year: input.financial_year,
        fields: intended,
        rows: plan.provider_rows,
      },
      baseline: before?.version ?? null,
      preview: {
        resource,
        action,
        before: before ? { fields: before.fields, rows: before.rows } : null,
        intended_fields: intended,
        intended_rows: plan.intended_rows,
        row_diff: plan.diff,
        removed_row_ids: plan.removed_row_ids,
        totals: plan.totals,
      },
    };
  }
}
