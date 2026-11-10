import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { payrollOperationIds } from "@fortnox-mcp/core";
import {
  financialReadOperations,
  openItemReadOperations,
} from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";

it("pins analytical/payroll operation sources without promoting operator probes to accepted support", () => {
  const ledger = JSON.parse(
    readFileSync(
      new URL("../../docs/reference/s08-s09-operations.json", import.meta.url),
      "utf8",
    ),
  ) as {
    sourceHashes: Record<string, string>;
    operations: Array<{
      localId: string;
      supported: boolean;
      enabledByDefault: boolean;
      liveEvidence: unknown;
      clientEvidence: unknown;
    }>;
  };
  for (const [path, hash] of Object.entries(ledger.sourceHashes))
    expect(
      createHash("sha256")
        .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
        .digest("hex"),
      path,
    ).toBe(hash);
  expect(ledger.operations.map((o) => o.localId).sort()).toEqual(
    [
      ...payrollOperationIds,
      ...financialReadOperations,
      ...openItemReadOperations,
      "financial_report.calculate",
      "financial_report.compare",
      "sie4.parse",
      "financial_movements.list",
      "payroll_employee.create",
    ].sort(),
  );
  for (const operation of ledger.operations) {
    expect(operation.supported).toBe(false);
    expect(operation.enabledByDefault).toBe(false);
    expect(operation.liveEvidence).toBeNull();
    expect(operation.clientEvidence).toBeNull();
  }
});
