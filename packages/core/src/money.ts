import { Decimal } from "decimal.js";
import { z } from "zod";
import { DomainError } from "./errors.js";

// Bound operands so all supported sums fit within the decimal context exactly.
const ExactDecimal = Decimal.clone({ precision: 96 });
const amountSchema = z
  .string()
  .max(68)
  .regex(/^-?(?:0|[1-9]\d{0,47})(?:\.\d{1,18})?$/);

export function parseAmount(input: unknown, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new DomainError("VALIDATION_FAILED");
  }
  const parsed = amountSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION_FAILED");
  const value = new ExactDecimal(parsed.data);
  if (value.decimalPlaces() > scale) throw new DomainError("VALIDATION_FAILED");
  return value.toFixed(scale);
}

export function sumAmounts(inputs: readonly unknown[], scale: number): string {
  if (inputs.length > 10_000) throw new DomainError("VALIDATION_FAILED");
  let total = new ExactDecimal(parseAmount("0", scale));
  for (const input of inputs) total = total.plus(parseAmount(input, scale));
  return total.toFixed(scale);
}

// Read-only ledger aggregation has a larger independently bounded row budget.
// Voucher validation retains the original 10,000-operand bound above.
export function sumFinancialAmounts(
  inputs: readonly unknown[],
  scale: number,
): string {
  if (inputs.length > 100_000) throw new DomainError("VALIDATION_FAILED");
  const partial: string[] = [];
  for (let i = 0; i < inputs.length; i += 10_000)
    partial.push(sumAmounts(inputs.slice(i, i + 10_000), scale));
  return sumAmounts(partial, scale);
}
