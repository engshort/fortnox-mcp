import {
  type AccountingActor,
  accountingDate,
  accountingHash,
  type Connections,
  DomainError,
  type InvoiceHistory,
  invoiceHistory,
  type OpenItemKind,
  type OpenItemProvider,
  openItemRecord,
  parseAmount,
  sumAmounts,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";

export const openItemReadOperations = [
  "open_receivable.list",
  "open_payable.list",
  "open_receivable.history",
  "open_payable.history",
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
export interface InvoiceHistoryVerification {
  version: string;
  sha256: string;
  invoice_currency_amounts: boolean;
  signed_credit_amounts: boolean;
  effective_dates: boolean;
  full_payment_history: boolean;
  immutable_terms: boolean;
  current_balance_currency_and_sign?: boolean;
}
export class FortnoxOpenItems implements OpenItemProvider {
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly enabled: readonly OpenItemReadOperation[] = [],
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
    readonly verification?: (
      company: string,
      kind: OpenItemKind,
    ) => InvoiceHistoryVerification | undefined,
  ) {
    if (
      new Set(enabled).size !== enabled.length ||
      enabled.some((op) => !openItemReadOperations.includes(op))
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    this.http = new DocumentHttp(connections, provider, enabled, active, now);
  }
  async history(
    actor: AccountingActor,
    company: string,
    kind: OpenItemKind,
    id: string,
    until: number,
  ): Promise<InvoiceHistory> {
    const resource = resources[kind];
    openItemRecord.shape.id.parse(id);
    const operation =
      kind === "receivable"
        ? "open_receivable.history"
        : "open_payable.history";
    const context = await this.http.context(
      actor,
      company,
      operation,
      resource.scope,
    );
    const detailUrl = new URL(
      `https://api.fortnox.se/3/${resource.path}/${id}`,
    );
    const detail = await this.http.read(context, detailUrl, until);
    const record = z
      .record(z.string(), z.unknown())
      .parse(detail[kind === "receivable" ? "Invoice" : "SupplierInvoice"]);
    if (String(record[resource.id]) !== id)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "invoice_identity_mismatch",
      );
    const evidence = this.verification?.(company, kind);
    if (
      evidence &&
      (!/^[a-f0-9]{64}$/.test(evidence.sha256) ||
        !evidence.version ||
        evidence.version.length > 128)
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const sources: InvoiceHistory["sources"] = [
      {
        operation,
        record_id: `${id}:invoice`,
        sha256: await accountingHash(detail),
      },
    ];
    if (evidence)
      sources.push({
        operation: "invoice_history_verification",
        record_id: evidence.version,
        sha256: evidence.sha256,
      });
    const currency =
      typeof record.Currency === "string" && /^[A-Z]{3}$/.test(record.Currency)
        ? record.Currency
        : null;
    const settlements: InvoiceHistory["settlements"] = [];
    const limitations = new Set<string>();
    let complete = false;
    let firstPayments: string | null = null;
    const paymentPath =
      kind === "receivable" ? "invoicepayments" : "supplierinvoicepayments";
    const paymentEnvelope =
      kind === "receivable" ? "InvoicePayments" : "SupplierInvoicePayments";
    const paymentUrl = (page: number) => {
      const url = new URL(`https://api.fortnox.se/3/${paymentPath}`);
      url.search = new URLSearchParams({
        invoicenumber: id,
        page: String(page),
        limit: "100",
      }).toString();
      return url;
    };
    for (let page = 1; page <= 50 && this.now() < until; page++) {
      const raw = await this.http.read(context, paymentUrl(page), until);
      const hash = await accountingHash(raw);
      if (page === 1) firstPayments = hash;
      if (sources.length >= 96) {
        limitations.add("payment_history_size_limit");
        break;
      }
      sources.push({
        operation,
        record_id: `${id}:payments:${page}`,
        sha256: hash,
      });
      const payments = z
        .array(z.record(z.string(), z.unknown()))
        .max(100)
        .parse(raw[paymentEnvelope]);
      for (const p of payments) {
        if (String(p.InvoiceNumber) !== id)
          throw new ProviderError(
            "UPSTREAM_UNAVAILABLE",
            "payment_invoice_mismatch",
          );
        if (p.Booked === false) continue;
        const date = accountingDate.safeParse(p.PaymentDate);
        if (
          p.Booked !== true ||
          !date.success ||
          p.Currency !== currency ||
          typeof p.AmountCurrency !== "string" ||
          !/^[1-9]\d{0,19}$/.test(String(p.Number))
        ) {
          limitations.add("payment_fields_unverified");
          continue;
        }
        let amount = parseAmount(p.AmountCurrency, 2);
        if (p.WriteOffExist === true) {
          if (!Array.isArray(p.WriteOffs) || !p.WriteOffs.length) {
            limitations.add("write_off_history_missing");
            continue;
          }
          const writeOffs = z
            .array(z.object({ Amount: z.string(), Currency: z.string() }))
            .max(1000)
            .parse(p.WriteOffs);
          if (writeOffs.some((w) => w.Currency !== currency)) {
            limitations.add("write_off_currency_unverified");
            continue;
          }
          amount = sumAmounts(
            [amount, ...writeOffs.map((w) => parseAmount(w.Amount, 2))],
            2,
          );
        } else if (
          p.WriteOffExist !== false ||
          (Array.isArray(p.WriteOffs) && p.WriteOffs.length)
        ) {
          limitations.add("write_off_semantics_unverified");
          continue;
        }
        settlements.push({ id: String(p.Number), date: date.data, amount });
      }
      const meta = metadata.safeParse(raw.MetaInformation);
      if (!meta.success) break;
      if (
        meta.data["@CurrentPage"] !== page &&
        !(page === 1 && payments.length === 0 && meta.data["@TotalPages"] === 0)
      )
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
      if (page >= meta.data["@TotalPages"]) {
        complete = true;
        break;
      }
    }
    if (
      !firstPayments ||
      (await accountingHash(
        await this.http.read(context, paymentUrl(1), until),
      )) !== firstPayments ||
      (await accountingHash(
        await this.http.read(context, detailUrl, until),
      )) !== sources[0]?.sha256
    )
      limitations.add("invoice_history_changed_during_retrieval");
    if (record.Booked !== true)
      limitations.add("invoice_posting_history_unverified");
    if (record.Cancelled !== false)
      limitations.add("cancellation_history_unverified");
    if (!evidence?.effective_dates)
      limitations.add("invoice_effective_dates_unverified");
    const original =
      typeof record.Total === "string" ? parseAmount(record.Total, 2) : null;
    // No amount/credit/currency rule is inferred from a field name or schema.
    const amountsVerified =
      evidence?.invoice_currency_amounts === true &&
      evidence.signed_credit_amounts;
    if (
      original !== null &&
      typeof record.Balance === "string" &&
      complete &&
      amountsVerified &&
      sumAmounts(
        [
          original,
          ...settlements.map((p) =>
            p.amount.startsWith("-") ? p.amount.slice(1) : `-${p.amount}`,
          ),
        ],
        2,
      ) !== parseAmount(record.Balance, 2)
    )
      limitations.add("invoice_balance_reconciliation_mismatch");
    const normalized = {
      company_id: company,
      kind,
      id,
      posted_on:
        evidence?.effective_dates && record.Booked === true
          ? date(record.VoucherDate ?? record.InvoiceDate)
          : null,
      original_amount: original,
      currency,
      due_date: date(record.DueDate),
      terms_verified: evidence?.immutable_terms === true,
      amounts_verified: amountsVerified,
      complete:
        complete &&
        evidence?.full_payment_history === true &&
        limitations.size === 0,
      cancellation_verified: record.Cancelled === false,
      cancelled_on: null,
      settlements,
      sources,
      limitations: [...limitations].sort(),
    };
    return invoiceHistory.parse({
      ...normalized,
      source_version: await accountingHash({
        ...normalized,
        evidence: evidence ?? null,
      }),
    });
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
    const verification = this.verification?.(company, kind);
    if (
      verification &&
      (!/^[a-f0-9]{64}$/.test(verification.sha256) ||
        !verification.version ||
        verification.version.length > 128)
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
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
        sha256: await accountingHash(
          verification ? { raw, verification } : raw,
        ),
      },
      signed_balance_verified:
        verification?.current_balance_currency_and_sign === true,
      historical_coverage_verified:
        verification?.full_payment_history === true &&
        verification.effective_dates &&
        verification.invoice_currency_amounts &&
        verification.signed_credit_amounts &&
        verification.immutable_terms,
    };
  }
}
