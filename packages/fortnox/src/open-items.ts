import {
  type AccountingActor,
  accountingDate,
  accountingHash,
  type Connections,
  DomainError,
  type OpenItemKind,
  type OpenItemProvider,
  openItemRecord,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";

export const openItemReadOperations = [
  "open_receivable.list",
  "open_payable.list",
] as const;
export type OpenItemReadOperation = (typeof openItemReadOperations)[number];
const integer = z
  .string()
  .regex(/^\d{1,8}$/)
  .transform(Number);
const metadata = z.object({
  "@CurrentPage": integer,
  "@TotalPages": integer,
  "@TotalResources": integer.optional(),
});
const resources = {
  receivable: {
    operation: "open_receivable.list",
    scope: "invoice",
    path: "invoices",
    envelope: "Invoices",
    id: "DocumentNumber",
    counterparty: "CustomerNumber",
  },
  payable: {
    operation: "open_payable.list",
    scope: "supplierinvoice",
    path: "supplierinvoices",
    envelope: "SupplierInvoices",
    id: "GivenNumber",
    counterparty: "SupplierNumber",
  },
} as const;
const date = (value: unknown) =>
  value === undefined || value === null || value === ""
    ? null
    : accountingDate.parse(value);
const boolean = (value: unknown) => (typeof value === "boolean" ? value : null);
export class FortnoxOpenItems implements OpenItemProvider {
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly enabled: readonly OpenItemReadOperation[] = [],
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
  ) {
    if (
      new Set(enabled).size !== enabled.length ||
      enabled.some((op) => !openItemReadOperations.includes(op))
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    this.http = new DocumentHttp(connections, provider, enabled, active, now);
  }
  async page(
    actor: AccountingActor,
    company: string,
    kind: OpenItemKind,
    page: number,
    until: number,
  ) {
    const resource = resources[kind];
    z.number().int().min(1).max(10000).parse(page);
    const context = await this.http.context(
      actor,
      company,
      resource.operation,
      resource.scope,
    );
    const url = new URL(`https://api.fortnox.se/3/${resource.path}`);
    // No unverified unpaid/date/currency filter can silently omit a source row.
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "100");
    if (kind === "receivable") url.searchParams.set("sortby", "documentnumber");
    const raw = await this.http.read(context, url, until);
    let records: z.infer<typeof openItemRecord>[];
    try {
      records = z
        .array(z.record(z.string(), z.unknown()))
        .max(100)
        .parse(raw[resource.envelope])
        .map((r) =>
          openItemRecord.parse({
            id: r[resource.id],
            counterparty_id: r[resource.counterparty] || null,
            invoice_date: date(r.InvoiceDate),
            due_date: date(r.DueDate),
            currency: r.Currency || null,
            balance: r.Balance ?? null,
            booked: boolean(r.Booked),
            cancelled: boolean(r.Cancelled),
            credit:
              kind === "receivable"
                ? r.Credit === "true"
                  ? true
                  : r.Credit === "false"
                    ? false
                    : null
                : boolean(r.Credit),
          }),
        );
    } catch {
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "invalid_open_item_response",
      );
    }
    const meta = metadata.safeParse(raw.MetaInformation);
    const valid =
      meta.success &&
      ((meta.data["@CurrentPage"] === page &&
        meta.data["@TotalPages"] >= page) ||
        (page === 1 &&
          records.length === 0 &&
          meta.data["@TotalPages"] === 0 &&
          meta.data["@CurrentPage"] <= 1));
    if (meta.success && !valid)
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
    const next =
      valid && meta.success && page < meta.data["@TotalPages"]
        ? page + 1
        : null;
    return {
      company_id: company,
      kind,
      records,
      metadata_verified: valid,
      exhausted: valid && next === null,
      next_page: next,
      total_records:
        valid && meta.success ? (meta.data["@TotalResources"] ?? null) : null,
      source: {
        operation: resource.operation,
        record_id: String(page),
        sha256: await accountingHash(raw),
      },
      signed_balance_verified: false,
    };
  }
}
