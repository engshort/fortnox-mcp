import { Decimal } from "decimal.js";
import { z } from "zod";
import { type AccountingReferences, accountingDate } from "./accounting.js";
import { DomainError } from "./errors.js";
import { parseAmount } from "./money.js";
import { registerDecimal, registerId } from "./registers.js";

// Independent sales-document row contract. No stock, discounts, housework or
// implicit account/VAT defaults. Prices exclude VAT; previews are unrounded.
const Exact = Decimal.clone({ precision: 96 });
export const documentRowId = z.string().regex(/^[1-9]\d{0,11}$/);
const account = z.number().int().min(1000).max(9999);
const dimensions = {
  CostCenter: registerId.optional(),
  Project: registerId.optional(),
};
const common = {
  RowId: documentRowId.optional(),
  AccountNumber: account,
  Description: z.string().trim().min(1).max(200),
  Price: registerDecimal,
  VAT: registerDecimal.refine((v) => new Exact(v).lte(100)),
  Unit: registerId.optional(),
  ...dimensions,
};
const positiveQuantity = registerDecimal.refine((v) => new Exact(v).gt(0));
export const offerRow = z
  .object({ ...common, Quantity: positiveQuantity })
  .strict();
export const orderRow = z
  .object({
    ...common,
    OrderedQuantity: positiveQuantity,
    DeliveredQuantity: registerDecimal,
  })
  .strict()
  .refine((r) => new Exact(r.DeliveredQuantity).lte(r.OrderedQuantity));
export const invoiceRow = z
  .object({
    ...common,
    DeliveredQuantity: positiveQuantity,
    // The invoice endpoint documents integer VAT rates.
    VAT: z.string().regex(/^(?:0|[1-9]\d?|100)$/),
  })
  .strict();
export const salesRowSchemas = {
  offer: offerRow,
  order: orderRow,
  invoice: invoiceRow,
} as const;
export type SalesResource = keyof typeof salesRowSchemas;
export type SalesRow =
  | z.infer<typeof offerRow>
  | z.infer<typeof orderRow>
  | z.infer<typeof invoiceRow>;
export const retainedDocumentRow = z.object({ RowId: documentRowId }).strict();
export type RetainedDocumentRow = z.infer<typeof retainedDocumentRow>;
export const salesRowsInput = (resource: SalesResource) =>
  z
    .array(z.union([salesRowSchemas[resource], retainedDocumentRow]))
    .min(1)
    .max(20);

export interface DocumentRowPlan {
  // All surviving source IDs are present, including unchanged {RowId} rows.
  provider_rows: (SalesRow | RetainedDocumentRow)[];
  intended_rows: SalesRow[];
  diff: Array<{
    kind: "added" | "updated" | "removed";
    row_id: string | null;
    before: SalesRow | null;
    after: SalesRow | null;
  }>;
  removed_row_ids: string[];
  totals: {
    net: string;
    vat: string;
    gross: string;
    rounding: "unrounded";
    provider_total_verified: false;
  };
}

/** Fortnox regenerates row IDs after every update. Never synthesize positions as IDs. */
export function planDocumentRows(
  resource: SalesResource,
  source: readonly SalesRow[] | null,
  raw: unknown,
  removed: readonly string[] = [],
): DocumentRowPlan {
  const input = salesRowsInput(resource).parse(raw);
  const removal = z.array(documentRowId).max(20).parse(removed);
  const before = new Map<string, SalesRow>();
  for (const row of source ?? []) {
    const parsed = salesRowSchemas[resource].parse(row);
    if (!parsed.RowId || before.has(parsed.RowId))
      throw new DomainError("UPSTREAM_UNAVAILABLE");
    before.set(parsed.RowId, parsed);
  }
  const remaining = new Set<string>(),
    deleted = new Set(removal);
  if (deleted.size !== removal.length || removal.some((id) => !before.has(id)))
    throw new DomainError("VALIDATION_FAILED");
  const intended: SalesRow[] = [];
  const diff: DocumentRowPlan["diff"] = [];
  for (const row of input) {
    const id = row.RowId;
    if (id && (!before.has(id) || remaining.has(id) || deleted.has(id)))
      throw new DomainError("VALIDATION_FAILED");
    if (!source && id) throw new DomainError("VALIDATION_FAILED");
    if (id) remaining.add(id);
    const previous = id ? (before.get(id) as SalesRow) : null;
    const next = salesRowSchemas[resource].parse(
      Object.keys(row).length === 1 ? previous : row,
    );
    intended.push(next);
    if (!previous || !sameSalesRow(previous, next))
      diff.push({
        kind: previous ? "updated" : "added",
        row_id: id ?? null,
        before: previous,
        after: next,
      });
  }
  // Omission alone must never remove a row. Every source ID is retained or
  // explicitly removed; partial snapshots cannot be passed as source rows.
  if ([...before.keys()].some((id) => !remaining.has(id) && !deleted.has(id)))
    throw new DomainError("VALIDATION_FAILED");
  for (const id of removal)
    diff.push({
      kind: "removed",
      row_id: id,
      before: before.get(id) as SalesRow,
      after: null,
    });
  let net = new Exact(0),
    vat = new Exact(0);
  for (const row of intended) {
    const quantity =
      "Quantity" in row
        ? row.Quantity
        : "OrderedQuantity" in row
          ? row.OrderedQuantity
          : row.DeliveredQuantity;
    const amount = new Exact(row.Price).times(quantity);
    net = net.plus(amount);
    vat = vat.plus(amount.times(row.VAT).dividedBy(100));
  }
  return {
    provider_rows: input,
    intended_rows: intended,
    diff,
    removed_row_ids: removal,
    totals: {
      net: net.toFixed(),
      vat: vat.toFixed(),
      gross: net.plus(vat).toFixed(),
      rounding: "unrounded",
      provider_total_verified: false,
    },
  };
}

function sameSalesRow(a: SalesRow, b: SalesRow) {
  return (
    JSON.stringify(Object.entries(a).sort()) ===
    JSON.stringify(Object.entries(b).sort())
  );
}

/** Verified accounting references remain mandatory; an observable read is not booking evidence. */
export function validateDocumentAccounts(
  input: {
    company_id: string;
    financial_year: number;
    date: string;
    rows: readonly SalesRow[];
  },
  refs: AccountingReferences,
  now: number,
) {
  if (refs.company_id !== input.company_id)
    throw new DomainError("COMPANY_FORBIDDEN");
  const date = accountingDate.parse(input.date);
  if (
    !refs.validation_verified ||
    !refs.complete ||
    refs.retrieved_at > now ||
    now - refs.retrieved_at > 60000
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  if (
    refs.financial_year !== input.financial_year ||
    refs.year.id !== input.financial_year ||
    !accountingDate.safeParse(refs.year.from).success ||
    !accountingDate.safeParse(refs.year.to).success ||
    refs.year.from > refs.year.to ||
    date < refs.year.from ||
    date > refs.year.to ||
    (refs.locked_through !== null &&
      (!accountingDate.safeParse(refs.locked_through).success ||
        date <= refs.locked_through))
  )
    throw new DomainError("VALIDATION_FAILED");
  for (const row of input.rows) {
    parseAmount(row.Price, 6);
    const found = refs.accounts.find((a) => a.number === row.AccountNumber);
    if (
      !found?.active ||
      (refs.account_numbers &&
        !refs.account_numbers.includes(row.AccountNumber))
    )
      throw new DomainError("VALIDATION_FAILED");
    for (const [field, key, collection] of [
      ["CostCenter", "cost_center", refs.cost_centers],
      ["Project", "project", refs.projects],
    ] as const) {
      const rule = found[key],
        value = row[field];
      if (
        !["REQUIRED", "ALLOWED", "NOTALLOWED"].includes(rule) ||
        (rule === "REQUIRED" && !value) ||
        (rule === "NOTALLOWED" && value) ||
        (value && !collection.some((r) => r.code === value && r.active))
      )
        throw new DomainError("VALIDATION_FAILED");
    }
    // This sales profile has no voucher transaction-information input.
    if (!["ALLOWED", "NOTALLOWED"].includes(found.information))
      throw new DomainError("VALIDATION_FAILED");
  }
}
