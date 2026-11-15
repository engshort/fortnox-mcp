import {
  largeSieLimits,
  parseSie4,
  SieLimitError,
  sumFinancialAmounts,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { syntheticSieWorkload } from "../../scripts/lib/synthetic-sie.js";
export function largeSieContract() {
  describe("bounded incremental SIE parsing", () => {
    it("processes an export exceeding both old byte and movement limits without omitting any exact movement", async () => {
      const bytes = syntheticSieWorkload(20000, 210);
      expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
      await expect(parseSie4(bytes, "cp437")).rejects.toBeInstanceOf(
        SieLimitError,
      );
      const result = await parseSie4(bytes, "cp437", largeSieLimits);
      expect(result.movements).toHaveLength(20000);
      expect(
        sumFinancialAmounts(
          result.movements
            .filter((m) => m.account === 1930)
            .map((m) => m.amount),
          2,
        ),
      ).toBe("100.00");
      expect(result.complete).toBe(false);
      expect(result.limitations).toContain("export_coverage_unverified");
    }, 30000);
    it("accepts the exact 100,000-movement boundary and refuses the first additional movement", async () => {
      const result = await parseSie4(
        syntheticSieWorkload(100000),
        "cp437",
        largeSieLimits,
      );
      expect(result.movements).toHaveLength(100000);
      expect(
        sumFinancialAmounts(
          result.movements.map((m) => m.amount),
          2,
        ),
      ).toBe("0.00");
      await expect(
        parseSie4(syntheticSieWorkload(100002), "cp437", largeSieLimits),
      ).rejects.toMatchObject({ limit: "movements", maximum: 100000 });
    }, 30000);
    it("preserves CRLF, source line identity and a multibyte UTF-8 name split across decode chunks", async () => {
      const header =
        "#FLAGGA 0\n#SIETYP 4\n#FORMAT PC8\n#RAR 0 20250101 20251231\n";
      const prefix = `${header}${Array.from({ length: 4 }, () => `#PROSA "${"a".repeat(7900)}"\n`).join("")}`;
      const fill =
        32767 -
        new TextEncoder().encode(prefix).length -
        '#KONTO 1930 "'.length;
      const bytes = new TextEncoder().encode(
        `${prefix}#PROSA "${"b".repeat(fill - 10)}"\n#KONTO 1930 "Åäö"\n`,
      );
      const result = await parseSie4(bytes, "utf8", largeSieLimits);
      expect(result.accounts[0]?.name).toBe("Åäö");
      expect(result.limitations).toContain("nonstandard_utf8_transport");
    });
    it("rejects byte, line and malformed-tail limits without returning partial totals", async () => {
      const bytes = syntheticSieWorkload(2);
      await expect(
        parseSie4(bytes, "cp437", {
          ...largeSieLimits,
          bytes: bytes.length - 1,
        }),
      ).rejects.toMatchObject({ limit: "bytes" });
      await expect(
        parseSie4(bytes, "cp437", { ...largeSieLimits, lines: 3 }),
      ).rejects.toMatchObject({ limit: "lines" });
      await expect(
        parseSie4(bytes.subarray(0, bytes.length - 4), "cp437", largeSieLimits),
      ).rejects.toThrow();
    });
  });
}
