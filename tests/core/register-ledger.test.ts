import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerOperationIds } from "@fortnox-mcp/core";
import { expect, it } from "vitest";

it("pins all S04 operation evidence without promoting synthetic acceptance", () => {
  const ledger = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/reference/s04-register-operations.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    sourceHashes: Record<string, string>;
    operations: Array<{
      localId: string;
      status: string;
      supported: boolean;
      enabledByDefault: boolean;
      liveEvidence: unknown;
      clientEvidence: unknown;
      missingEvidence: string[];
    }>;
  };
  for (const [path, hash] of Object.entries(ledger.sourceHashes))
    expect(
      createHash("sha256")
        .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
        .digest("hex"),
    ).toBe(hash);
  expect(ledger.operations.map((o) => o.localId).sort()).toEqual(
    [...registerOperationIds].sort(),
  );
  for (const operation of ledger.operations) {
    expect(operation.status).toBe("implemented_unverified");
    expect(operation.enabledByDefault).toBe(true);
    expect(operation.supported).toBe(false);
    expect(operation.liveEvidence).toBeNull();
    expect(operation.clientEvidence).toBeNull();
    expect(operation.missingEvidence.length).toBeGreaterThan(0);
  }
});
