import { z } from "zod";
import { DomainError } from "./errors.js";
import { parseAmount, sumAmounts } from "./money.js";

export const accountingDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const date = new Date(`${s}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s
    );
  });
const code = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export const voucherInput = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int().positive().safe(),
    date: accountingDate,
    series: z.string().regex(/^[A-Z0-9]{1,8}$/),
    description: z.string().trim().min(1).max(200),
    currency: z.literal("SEK"),
    rows: z
      .array(
        z
          .object({
            account: z.number().int().min(1000).max(9999),
            debit: z.string().max(32),
            credit: z.string().max(32),
            cost_center: code.optional(),
            project: code.optional(),
            information: z.string().trim().min(1).max(100).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(100),
    // File linking belongs to M16. An empty list is explicit, never a fake attachment.
    attachments: z.array(z.never()).max(0),
  })
  .strict();
export type VoucherInput = z.infer<typeof voucherInput>;
export const referenceAccountNumbers = z
  .array(z.number().int().min(1000).max(9999))
  .min(1)
  .max(20)
  .refine((numbers) => new Set(numbers).size === numbers.length);
export interface AccountingReferences {
  company_id: string;
  financial_year: number;
  retrieved_at: number;
  complete: boolean;
  // When present, completeness covers exactly these accounts, not the whole chart.
  account_numbers?: number[];
  year: { id: number; from: string; to: string };
  locked_through: string | null;
  // Historical acceptance evidence, independent of current reference validation.
  validation_verified: boolean;
  accounts: Array<{
    number: number;
    active: boolean;
    cost_center: DimensionRule;
    project: DimensionRule;
    information: DimensionRule;
  }>;
  series: Array<{ code: string; manual: boolean }>;
  cost_centers: Array<{ code: string; active: boolean }>;
  projects: Array<{ code: string; active: boolean }>;
}
export type DimensionRule = "REQUIRED" | "ALLOWED" | "NOTALLOWED" | "UNKNOWN";
export class AccountingValidationError extends DomainError {
  constructor(readonly fields: ReadonlyArray<{ path: string; rule: string }>) {
    super("VALIDATION_FAILED");
  }
}
export function validateVoucher(
  input: unknown,
  refs: AccountingReferences,
  now: number,
) {
  const parsed = voucherInput.safeParse(input);
  if (!parsed.success)
    throw new AccountingValidationError(
      parsed.error.issues.map((v) => ({
        path: v.path.join("."),
        rule: "structure",
      })),
    );
  const value = parsed.data;
  const fields: Array<{ path: string; rule: string }> = [];
  const fail = (path: string, rule: string) => fields.push({ path, rule });
  if (refs.company_id !== value.company_id)
    throw new DomainError("COMPANY_FORBIDDEN");
  if (
    refs.account_numbers &&
    (value.rows.some((row) => !refs.account_numbers?.includes(row.account)) ||
      refs.accounts.some((a) => !refs.account_numbers?.includes(a.number)))
  )
    fail("references", "account_selection_mismatch");
  if (
    !refs.complete ||
    refs.retrieved_at > now ||
    now - refs.retrieved_at > 60000
  )
    fail("references", "incomplete_or_stale");
  if (
    refs.financial_year !== value.financial_year ||
    refs.year.id !== value.financial_year ||
    !accountingDate.safeParse(refs.year.from).success ||
    !accountingDate.safeParse(refs.year.to).success ||
    refs.year.from > refs.year.to ||
    value.date < refs.year.from ||
    value.date > refs.year.to
  )
    fail("date", "fiscal_year");
  if (
    refs.locked_through !== null &&
    (!accountingDate.safeParse(refs.locked_through).success ||
      value.date <= refs.locked_through)
  )
    fail("date", "locked_period");
  if (!refs.series.some((s) => s.code === value.series && s.manual))
    fail("series", "manual_series");
  const normalized = value.rows.map((row, index) => {
    const path = `rows.${index}`;
    let debit = "0.00",
      credit = "0.00";
    try {
      debit = parseAmount(row.debit, 2);
      credit = parseAmount(row.credit, 2);
      // Narrow MVP creation profile: no signed, correction, removed or zero rows.
      if (
        debit.startsWith("-") ||
        credit.startsWith("-") ||
        (debit === "0.00") === (credit === "0.00") ||
        debit.replace(".", "").length > 14 ||
        credit.replace(".", "").length > 14
      )
        throw new Error();
    } catch {
      fail(path, "amount_precision_sign_or_overflow");
    }
    const account = refs.accounts.find((a) => a.number === row.account);
    if (!account?.active)
      fail(`${path}.account`, "inactive_or_missing_account");
    for (const dimension of [
      "cost_center",
      "project",
      "information",
    ] as const) {
      const rule = account?.[dimension];
      if (!rule || !["REQUIRED", "ALLOWED", "NOTALLOWED"].includes(rule))
        fail(`${path}.${dimension}`, "unknown_dimension_rule");
      if (rule === "REQUIRED" && !row[dimension])
        fail(`${path}.${dimension}`, "required");
      if (rule === "NOTALLOWED" && row[dimension])
        fail(`${path}.${dimension}`, "not_allowed");
      if (dimension !== "information" && row[dimension]) {
        const list =
          dimension === "project" ? refs.projects : refs.cost_centers;
        if (!list.some((d) => d.code === row[dimension] && d.active))
          fail(`${path}.${dimension}`, "inactive_or_missing_reference");
      }
    }
    return { ...row, debit, credit };
  });
  const debit = sumAmounts(
    normalized.map((r) => r.debit),
    2,
  );
  const credit = sumAmounts(
    normalized.map((r) => r.credit),
    2,
  );
  const difference = sumAmounts([debit, `-${credit}`], 2);
  if (difference !== "0.00") fail("rows", "unbalanced");
  if (fields.length) throw new AccountingValidationError(fields);
  return {
    voucher: { ...value, rows: normalized },
    totals: { debit, credit, difference },
  };
}
// Stable schema property order, normalized decimal strings, explicit company/year/files.
export async function accountingHash(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
