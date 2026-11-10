import {
  calculateFinancialReport,
  compareFinancialReports,
  FinancialAnalysis,
  type FinancialBasis,
  type FinancialQuery,
  parseSie4,
  type StateStore,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { accountingFixture } from "./accounting.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing synthetic fixture");
  return value;
}
const company = "b1ebed10-cf85-4d62-9be3-ae56c71cc781";
export function syntheticFinancialBasis(company_id = company): FinancialBasis {
  return {
    company_id,
    source_version: "a".repeat(64),
    year: { id: 7, from: "2025-07-01", to: "2026-06-30" },
    currency: "SEK",
    accounts: [
      {
        number: 1930,
        name: "Synthetic booked bank",
        active: true,
        opening: "1000",
        provider_closing: "1150",
        category: "assets",
      },
      {
        number: 9901,
        name: "Synthetic custom inactive",
        active: false,
        opening: "0",
        provider_closing: "0",
        category: "unmapped",
      },
      {
        number: 4000,
        name: "Synthetic expense",
        active: true,
        opening: "0",
        provider_closing: "-150",
        category: "expenses",
      },
    ],
    movements: [
      {
        id: "A:1:1",
        account: 1930,
        date: "2025-08-01",
        amount: "250",
        effective: true,
        source_ref: "A:1",
        dimensions: {},
      },
      {
        id: "A:1:2",
        account: 4000,
        date: "2025-08-01",
        amount: "-250",
        effective: true,
        source_ref: "A:1",
        dimensions: {},
      },
      {
        id: "A:2:1",
        account: 1930,
        date: "2026-01-01",
        amount: "-100",
        effective: true,
        source_ref: "A:2",
        dimensions: { "1": "SYNTHETIC" },
      },
      {
        id: "A:2:2",
        account: 4000,
        date: "2026-01-01",
        amount: "100",
        effective: true,
        source_ref: "A:2",
        dimensions: {},
      },
      {
        id: "A:2:3",
        account: 1930,
        date: "2026-01-01",
        amount: "999",
        effective: false,
        source_ref: "A:2",
        dimensions: {},
      },
    ],
    sources: [
      {
        operation: "synthetic_ledger",
        record_id: "year:7",
        sha256: "a".repeat(64),
      },
    ],
    retrieved: { started_at: 100, finished_at: 200 },
    coverage: { accounts: true, movements: true, opening_balances: true },
    semantics_verified: true,
    mapping_version: "synthetic-explicit/1",
    consistency: "not_atomic",
    limitations: [],
  };
}
const query = (company_id = company): FinancialQuery => ({
  company_id,
  financial_year: 7,
  from: "2025-07-01",
  to: "2026-06-30",
});
export const syntheticSie = `#FLAGGA 0
#PROGRAM "Synthetic" "1"
#FORMAT PC8
#SIETYP 4
#VALUTA SEK
#RAR 0 20250701 20260630
#RAR -1 20240701 20250630
#KONTO 1930 "Synthetic bank"
#KONTO 4000 "Synthetic expense"
#KONTO 9901 "Synthetic zero"
#IB 0 1930 1000
#UB 0 1930 1150
#RES 0 4000 -150
#UB -1 1930 1000
#VER "A" "1" 20250801 "Synthetic"
{
#TRANS 1930 {} 250
#TRANS 4000 {} -250
}
#VER "A" "2" 20260101
{
#BTRANS 1930 {} 100
#RTRANS 1930 {1 "SYNTHETIC"} -100
#TRANS 1930 {1 "SYNTHETIC"} -100
#TRANS 4000 {} 100
}
`;
const bytes = (v: string) => new TextEncoder().encode(v);
export function analyticsCalculationContract() {
  describe("S08 deterministic ledger evidence", () => {
    it("bounds report pages and binds continuation to source, company, year and interval", () => {
      const basis = syntheticFinancialBasis();
      for (let number = 1100; number < 1300; number++)
        basis.accounts.push({
          number,
          name: "Synthetic zero",
          active: false,
          opening: "0",
          provider_closing: "0",
          category: "unmapped",
        });
      let result = calculateFinancialReport(query(), basis);
      expect(result.accounts).toHaveLength(50);
      expect(result.complete).toBe(false);
      expect(result.data_complete).toBe(true);
      expect(result.totals_scope).toBe("entire_account_selection");
      const numbers = result.accounts.map((a) => a.number);
      const initial = result.accounts_page.next;
      if (!initial) throw new Error("Expected synthetic continuation");
      expect(() =>
        calculateFinancialReport(
          { ...query(), to: "2026-01-31", continuation: initial },
          basis,
        ),
      ).toThrow("CONNECTION_CONFLICT");
      expect(() =>
        calculateFinancialReport(
          { ...query(), continuation: initial },
          { ...basis, source_version: "b".repeat(64) },
        ),
      ).toThrow("CONNECTION_CONFLICT");
      while (result.accounts_page.next) {
        result = calculateFinancialReport(
          { ...query(), continuation: result.accounts_page.next },
          basis,
        );
        expect(result.complete).toBe(false);
        numbers.push(...result.accounts.map((a) => a.number));
      }
      expect(numbers).toHaveLength(203);
      expect(new Set(numbers).size).toBe(203);
    });
    it("never promotes unbalanced or unsupported source evidence to complete", () => {
      const basis = syntheticFinancialBasis();
      basis.limitations = ["unbalanced_voucher"];
      expect(calculateFinancialReport(query(), basis).complete).toBe(false);
    });
    it("reconciles signed movements while retaining inactive, zero and unmapped accounts", () => {
      const result = calculateFinancialReport(
        query(),
        syntheticFinancialBasis(),
      );
      expect(result.complete).toBe(true);
      expect(result.reconciliation).toBe("matched");
      expect(result.accounts.map((a) => [a.number, a.balance_as_of])).toEqual([
        [1930, "1150.00"],
        [4000, "-150.00"],
        [9901, "0.00"],
      ]);
      expect(result.accounts[0]?.movement_ids).toEqual(["A:1:1", "A:2:1"]);
      expect(result.accounts.find((a) => a.number === 9901)?.active).toBe(
        false,
      );
      expect(
        result.totals.find((v) => v.category === "unmapped")?.account_count,
      ).toBe(1);
      expect(result.limitations).toContain("retrieval_is_not_atomic");
      expect(result.bank_balance_kind).toBe("booked_ledger_balance");
    });
    it("uses opening plus movements through D, never the year-end field for partial years", () => {
      const result = calculateFinancialReport(
        { ...query(), from: "2025-08-01", to: "2025-08-31" },
        syntheticFinancialBasis(),
      );
      expect(result.accounts[0]).toMatchObject({
        balance_as_of: "1250.00",
        provider_closing: "1150.00",
        period_movement: "250.00",
        reconciliation: { boundary: "2026-06-30", status: "matched" },
      });
    });
    it("preserves decimal cents and large values without binary floating point", () => {
      const basis = syntheticFinancialBasis();
      basis.accounts[0] = {
        ...required(basis.accounts[0]),
        opening: "9007199254740993.00",
        provider_closing: "9007199254740993.30",
      };
      basis.movements = ["0.10", "0.20"].map((amount, i) => ({
        id: `large:${i}`,
        account: 1930,
        date: "2026-01-01",
        amount,
        effective: true,
        source_ref: "large",
        dimensions: {},
      }));
      basis.accounts = basis.accounts.slice(0, 1);
      expect(
        calculateFinancialReport(query(), basis).accounts[0]?.balance_as_of,
      ).toBe("9007199254740993.30");
      required(basis.movements[0]).amount = "0.001";
      expect(() => calculateFinancialReport(query(), basis)).toThrow();
    });
    it("never presents missing openings, partial pages or unknown effective rows as complete", () => {
      for (const change of ["opening", "pages", "semantics", "row"] as const) {
        const basis = syntheticFinancialBasis();
        if (change === "opening") required(basis.accounts[0]).opening = null;
        if (change === "pages") basis.coverage.movements = false;
        if (change === "semantics") basis.semantics_verified = false;
        if (change === "row") required(basis.movements[0]).effective = null;
        expect(calculateFinancialReport(query(), basis).complete).toBe(false);
        if (change !== "semantics")
          expect(
            calculateFinancialReport(query(), basis).accounts[0]?.balance_as_of,
          ).toBeNull();
      }
    });
    it("does not hide mismatches outside the requested account subset or concurrent changes", () => {
      const basis = syntheticFinancialBasis();
      required(basis.accounts[2]).provider_closing = "-149.99";
      const result = calculateFinancialReport(
        { ...query(), account_numbers: [1930] },
        basis,
      );
      expect(result.complete).toBe(false);
      expect(result.reconciliation).toBe("mismatch");
      required(basis.accounts[2]).provider_closing = "-150";
      basis.consistency = "changed";
      expect(calculateFinancialReport(query(), basis).complete).toBe(false);
    });
    it("rejects cross-company/year, duplicate records, missing account references and invalid intervals", () => {
      expect(() =>
        calculateFinancialReport(
          { ...query(), company_id: crypto.randomUUID() },
          syntheticFinancialBasis(),
        ),
      ).toThrow("COMPANY_FORBIDDEN");
      expect(() =>
        calculateFinancialReport(
          { ...query(), financial_year: 8 },
          syntheticFinancialBasis(),
        ),
      ).toThrow();
      expect(() =>
        calculateFinancialReport(
          { ...query(), to: "2026-07-01" },
          syntheticFinancialBasis(),
        ),
      ).toThrow();
      const basis = syntheticFinancialBasis();
      basis.movements.push({ ...required(basis.movements[0]) });
      expect(() => calculateFinancialReport(query(), basis)).toThrow();
      basis.movements.pop();
      required(basis.movements[0]).account = 9000;
      expect(() => calculateFinancialReport(query(), basis)).toThrow();
    });
    it("compares explicit periods without merging currencies or claiming consolidation", () => {
      const first = calculateFinancialReport(
        query(),
        syntheticFinancialBasis(),
      );
      const basis = syntheticFinancialBasis();
      basis.currency = "EUR";
      const compared = compareFinancialReports(
        first,
        calculateFinancialReport(query(), basis),
      );
      expect(compared).toMatchObject({
        compatible: false,
        complete: false,
        consolidated: false,
        converted_currency: false,
        differences: [],
      });
    });
  });
  describe("bounded SIE4 ingestion", () => {
    it("preserves year boundaries, exact balances, dimensions and effective correction rows", async () => {
      const result = await parseSie4(bytes(syntheticSie), "cp437");
      expect(result.complete).toBe(false);
      expect(result.years).toEqual([
        { index: 0, from: "2025-07-01", to: "2026-06-30" },
        { index: -1, from: "2024-07-01", to: "2025-06-30" },
      ]);
      expect(result.movements.map((m) => m.amount)).toEqual([
        "250.00",
        "-250.00",
        "-100.00",
        "100.00",
      ]);
      expect(result.movements[2]?.dimensions).toEqual({ "1": "SYNTHETIC" });
      expect(result.accounts[0]?.balances).toEqual([
        { year: 0, opening: "1000.00", closing: "1150.00" },
        { year: -1, opening: null, closing: "1000.00" },
      ]);
      const hash = await crypto.subtle.digest("SHA-256", bytes(syntheticSie));
      expect(result.sha256).toBe(
        Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      );
    });
    it("does not invent omitted zero balances or silently ignore unknown accounting records", async () => {
      const result = await parseSie4(
        bytes(`${syntheticSie}#FUTURE 1 2 3\n`),
        "cp437",
      );
      expect(result.accounts[2]?.balances).toEqual([]);
      expect(result.limitations).toContain("unsupported_record:#FUTURE");
      expect(result.limitations).toContain("missing_zero_balances_unverified");
    });
    it("decodes CP437 Swedish names without interpreting legacy bytes as UTF-8", async () => {
      const content = bytes(
        syntheticSie.replace("Synthetic bank", "SYNTHETIC_"),
      );
      const at = Array.from(content).findIndex(
        (_, i) =>
          new TextDecoder().decode(content.slice(i, i + 10)) === "SYNTHETIC_",
      );
      content[at] = 0x8e;
      content[at + 1] = 0x99;
      content[at + 2] = 0x8f;
      expect(
        (await parseSie4(content, "cp437")).accounts[0]?.name.startsWith("ÄÖÅ"),
      ).toBe(true);
      await expect(parseSie4(content, "utf8")).rejects.toThrow();
    });
    it("rejects truncation, duplicate balances, malformed correction pairs and unsupported precision", async () => {
      for (const invalid of [
        syntheticSie.slice(0, -3),
        syntheticSie.replace(
          "#UB 0 1930 1150",
          "#UB 0 1930 1150\n#UB 0 1930 1150",
        ),
        syntheticSie.replace(
          '#TRANS 1930 {1 "SYNTHETIC"} -100',
          '#TRANS 1930 {1 "SYNTHETIC"} -99',
        ),
        syntheticSie.replace("{} 250", "{} 250.001"),
        syntheticSie.replace("#SIETYP 4", "#SIETYP 1"),
      ])
        await expect(parseSie4(bytes(invalid), "cp437")).rejects.toThrow();
    });
    it("surfaces unbalanced voucher and unchecked checksum without claiming verified input", async () => {
      const result = await parseSie4(
        bytes(`${syntheticSie.replace("{} -250", "{} -249")}#KSUMMA 123\n`),
        "cp437",
      );
      expect(result.limitations).toEqual(
        expect.arrayContaining(["unbalanced_voucher", "checksum_not_verified"]),
      );
    });
  });
}
export function analyticsAuthorizationContract(
  fixture: () => Promise<StateStore>,
) {
  it("authorizes before reading, defaults off and discards late disconnect/program changes", async () => {
    const f = await accountingFixture(await fixture());
    let calls = 0;
    const provider = {
      basis: async () => {
        calls++;
        return syntheticFinancialBasis(f.a.id);
      },
    };
    const disabled = new FinancialAnalysis(f.connections, provider);
    await expect(disabled.report(f.actor, query(f.a.id))).rejects.toThrow(
      "CAPABILITY_UNAVAILABLE",
    );
    const service = new FinancialAnalysis(f.connections, provider, true);
    await expect(
      service.report({ ...f.actor, scopes: [] }, query(f.a.id)),
    ).rejects.toThrow("AUTH_REQUIRED");
    await expect(
      service.report(f.actor, query(crypto.randomUUID())),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    expect(calls).toBe(0);
    expect((await service.report(f.actor, query(f.a.id))).complete).toBe(true);
    provider.basis = async () => {
      calls++;
      await f.connections.disconnect(f.actor.ownerId, f.a.id);
      return syntheticFinancialBasis(f.a.id);
    };
    await expect(service.report(f.actor, query(f.a.id))).rejects.toThrow();
    expect(calls).toBe(2);
  });
}
