import type { FinancialMapping, FinancialVerification } from "./analytics.js";
import type { InvoiceHistoryVerification } from "./open-items.js";

// Optional trusted source evidence. Tool availability does not attest financial
// semantics; absent callbacks keep computed values unknown and results partial.
export interface FinancialReadEvidence {
  controlAccountMapping?: (
    company: string,
    kind: "receivable" | "payable",
    asOf: string,
  ) =>
    | {
        financial_year: number;
        account_numbers: readonly number[];
        currency: string;
        version: string;
        sha256: string;
      }
    | undefined;
  financialVerification?: (
    company: string,
    year: number,
  ) => FinancialVerification | undefined;
  invoiceVerification?: (
    company: string,
    kind: "receivable" | "payable",
  ) => InvoiceHistoryVerification | undefined;
  financialMappings?: readonly {
    company_id: string;
    financial_year: number;
    mapping: FinancialMapping;
    cash_account_numbers: readonly number[];
  }[];
}
