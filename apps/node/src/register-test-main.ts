import {
  type RegisterOperation,
  registerOperationIds,
} from "@fortnox-mcp/core";
import { z } from "zod";
import { startProduct } from "./product-runtime.js";

declare const __REGISTER_TEST_SOURCE_COMMIT__: string;
// This isolated entry never changes the ordinary product's activation gates.
void (async () => {
  const operations = z
    .array(z.string())
    .min(1)
    .max(registerOperationIds.length)
    .parse(JSON.parse(process.env.REGISTER_TEST_OPERATIONS ?? "[]"));
  if (
    operations.some(
      (op) => !registerOperationIds.includes(op as RegisterOperation),
    )
  )
    throw new Error("Unclassified test operation");
  await startProduct(undefined, {
    sourceCommit: __REGISTER_TEST_SOURCE_COMMIT__,
    until: Date.parse(process.env.REGISTER_TEST_UNTIL ?? ""),
    operations: operations as RegisterOperation[],
    financialReads: z
      .array(
        z.enum([
          "financial.accounts",
          "financial.account",
          "financial.year",
          "financial.sie4",
          "financial.voucher",
        ]),
      )
      .max(5)
      .parse(JSON.parse(process.env.FINANCIAL_TEST_OPERATIONS ?? "[]")),
    payrollReads: z
      .array(
        z.enum([
          "payroll_employee.list",
          "payroll_employee.get",
          "salary_transaction.list",
          "salary_transaction.get",
        ]),
      )
      .max(4)
      .parse(JSON.parse(process.env.PAYROLL_TEST_OPERATIONS ?? "[]")),
    documentReads: z
      .array(
        z.enum([
          "offer.list",
          "offer.get",
          "order.list",
          "order.get",
          "invoice.list",
          "invoice.get",
        ]),
      )
      .max(6)
      .parse(JSON.parse(process.env.DOCUMENT_TEST_OPERATIONS ?? "[]")),
    consentScopes: z
      .array(z.string())
      .max(8)
      .parse(JSON.parse(process.env.REGISTER_TEST_EXTRA_CONSENT ?? "[]")),
  });
})().catch(() => {
  console.error(
    "register_test_startup_failed; check private isolated test configuration",
  );
  process.exit(1);
});
