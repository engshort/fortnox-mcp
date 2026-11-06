import { expect, it } from "vitest";
import {
  clientChecks,
  validateClientEvidence,
} from "../../scripts/acceptance-lib.mjs";

it("does not accept an incomplete or failed manual client acceptance record", () => {
  const record = {
    serverCommit: "a".repeat(40),
    observedAt: "2026-11-06T00:00:00Z",
    client: "Synthetic client",
    runtime: "synthetic test",
    limitations: "No actual host",
    checks: Object.fromEntries(clientChecks.map((c: string) => [c, true])),
  };
  expect(validateClientEvidence(record)).toBe(true);
  expect(
    validateClientEvidence({
      ...record,
      checks: { ...record.checks, reloadTools: false },
    }),
  ).toBe(false);
  expect(validateClientEvidence({ ...record, serverCommit: "unknown" })).toBe(
    false,
  );
});
