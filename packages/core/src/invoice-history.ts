import { z } from "zod";
import { accountingDate } from "./accounting.js";
import { parseAmount, sumAmounts } from "./money.js";

const money = z
  .string()
  .max(68)
  .transform((v) => parseAmount(v, 2));
export const invoiceHistory = z
  .object({
    company_id: z.string().uuid(),
    kind: z.enum(["receivable", "payable"]),
    id: z.string().regex(/^[1-9]\d{0,19}$/),
    posted_on: accountingDate.nullable(),
    original_amount: money.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    due_date: accountingDate.nullable(),
    terms_verified: z.boolean(),
    amounts_verified: z.boolean(),
    complete: z.boolean(),
    cancellation_verified: z.boolean(),
    cancelled_on: accountingDate.nullable(),
    settlements: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            date: accountingDate,
            // Signed reduction in the invoice currency, including verified write-offs.
            amount: money,
          })
          .strict(),
      )
      .max(10000),
    source_version: z.string().regex(/^[a-f0-9]{64}$/),
    sources: z
      .array(
        z
          .object({
            operation: z.string().min(1).max(128),
            record_id: z.string().min(1).max(128),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    limitations: z.array(z.string().max(128)).max(32),
  })
  .strict();
export type InvoiceHistory = z.infer<typeof invoiceHistory>;
export function calculateInvoiceBalance(input: InvoiceHistory, asOf: string) {
  const history = invoiceHistory.parse(input);
  accountingDate.parse(asOf);
  const limitations = new Set(history.limitations);
  if (
    new Set(history.settlements.map((p) => p.id)).size !==
    history.settlements.length
  )
    limitations.add("duplicate_settlement_identity");
  if (!history.complete) limitations.add("payment_history_incomplete");
  if (!history.amounts_verified)
    limitations.add("historical_amount_semantics_unverified");
  if (!history.cancellation_verified)
    limitations.add("cancellation_history_unverified");
  if (!history.terms_verified)
    limitations.add("historical_due_date_unverified");
  if (
    history.posted_on === null ||
    history.original_amount === null ||
    history.currency === null
  )
    limitations.add("historical_invoice_fields_missing");
  const known =
    history.complete &&
    history.amounts_verified &&
    history.cancellation_verified &&
    history.posted_on !== null &&
    history.original_amount !== null &&
    history.currency !== null &&
    !limitations.has("duplicate_settlement_identity");
  const beforePosting = history.posted_on !== null && history.posted_on > asOf;
  const cancelled =
    history.cancelled_on !== null && history.cancelled_on <= asOf;
  const amount = !known
    ? null
    : beforePosting || cancelled
      ? "0.00"
      : sumAmounts(
          [
            history.original_amount as string,
            ...history.settlements
              .filter((p) => p.date <= asOf)
              .map((p) =>
                p.amount.startsWith("-") ? p.amount.slice(1) : `-${p.amount}`,
              ),
          ],
          2,
        );
  return {
    balance_as_of: amount,
    due_date: history.terms_verified ? history.due_date : null,
    overdue:
      history.terms_verified && history.due_date !== null && amount !== null
        ? amount !== "0.00" && history.due_date < asOf
        : null,
    complete: known && history.terms_verified && limitations.size === 0,
    limitations: [...limitations].sort(),
  };
}
