import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { receiptProviderOperations } from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";

it("pins the receipt operation evidence without promoting synthetic support", () => {
  const ledger = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/reference/mvp-receipt-operations.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    sourceHashes: Record<string, string>;
    operations: Array<{
      localId: keyof typeof receiptProviderOperations;
      method: string;
      path: string;
      providerScope: string;
      status: string;
      supported: boolean;
      enabledByDefault: boolean;
      liveEvidence: unknown;
      missingEvidence: string[];
    }>;
  };
  for (const [path, hash] of Object.entries(ledger.sourceHashes)) {
    const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  }
  expect(new Set(ledger.operations.map((o) => o.localId)).size).toBe(4);
  for (const operation of ledger.operations) {
    expect(receiptProviderOperations[operation.localId]).toMatchObject({
      method: operation.method,
      path: operation.path,
      scope: operation.providerScope,
    });
    expect(operation.status).toBe("implemented_unverified");
    expect(operation.supported).toBe(false);
    expect(operation.enabledByDefault).toBe(true);
    expect(operation.liveEvidence).toBeNull();
    expect(operation.missingEvidence.length).toBeGreaterThan(0);
  }
});
