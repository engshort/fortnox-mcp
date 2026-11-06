import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("accounting operation evidence pins the actual independent source and never advertises missing live evidence", () => {
  const ledger = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/reference/mvp-accounting-operations.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    sourceHashes: Record<string, string>;
    operations: Array<{
      localId: string;
      supported: boolean;
      enabledByDefault: boolean;
      status: string;
      liveEvidence: unknown;
    }>;
  };
  for (const [path, hash] of Object.entries(ledger.sourceHashes)) {
    expect(path).toMatch(/^packages\/[a-z]+\/src\/[a-z-]+\.ts$/);
    const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  }
  expect(new Set(ledger.operations.map((o) => o.localId)).size).toBe(8);
  for (const operation of ledger.operations) {
    expect(operation.status).toBe("implemented_unverified");
    expect(operation.liveEvidence).toBeNull();
    expect(operation.supported).toBe(false);
    expect(operation.enabledByDefault).toBe(false);
  }
});
