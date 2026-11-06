import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("accounting operation evidence pins source and keeps partial live evidence unverified", () => {
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
      missingEvidence: string[];
      liveEvidence: null | {
        record: string;
        observedAt: string;
        serverCommit: string;
        runtime: string;
        boundary: string;
        result: string;
      };
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
    expect(operation.supported).toBe(false);
    expect(operation.enabledByDefault).toBe(false);
    expect(operation.missingEvidence.length).toBeGreaterThan(0);
    if (operation.liveEvidence) {
      const evidence = operation.liveEvidence;
      expect(evidence.serverCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(Number.isFinite(Date.parse(evidence.observedAt))).toBe(true);
      expect(evidence.record).toMatch(/^docs\/[a-zA-Z0-9/_.-]+\.md#/);
      expect(
        readFileSync(
          new URL(`../../${evidence.record.split("#")[0]}`, import.meta.url),
          "utf8",
        ).length,
      ).toBeGreaterThan(0);
      expect(evidence.runtime.length).toBeGreaterThan(0);
      expect(evidence.boundary.length).toBeGreaterThan(0);
      expect(evidence.result.length).toBeGreaterThan(0);
    }
  }
});
