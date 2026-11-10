import {
  type AccountingReferences,
  planDocumentRows,
  type SalesRow,
  validateDocumentAccounts,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";

const row = (id?: string): SalesRow => ({
  ...(id ? { RowId: id } : {}),
  AccountNumber: 3001,
  Description: "Synthetic service",
  Quantity: "1",
  Price: "0.10",
  VAT: "25",
});
const refs = (): AccountingReferences => ({
  company_id: "90000000-0000-4000-8000-000000000001",
  financial_year: 1,
  year: { id: 1, from: "2026-01-01", to: "2026-12-31" },
  retrieved_at: 100000,
  complete: true,
  validation_verified: true,
  locked_through: null,
  accounts: [
    {
      number: 3001,
      active: true,
      cost_center: "ALLOWED",
      project: "ALLOWED",
      information: "ALLOWED",
    },
  ],
  series: [],
  cost_centers: [],
  projects: [],
});

export function documentRowsContract() {
  describe("sales document row contract", () => {
    it("preserves all intended rows and makes every deletion explicit", () => {
      const before = [row("11"), row("12"), row("13")];
      expect(() =>
        planDocumentRows("offer", before, [{ RowId: "11" }]),
      ).toThrow();
      const plan = planDocumentRows(
        "offer",
        before,
        [{ RowId: "11" }, { ...row("12"), Price: "0.20" }, row()],
        ["13"],
      );
      expect(plan.provider_rows[0]).toEqual({ RowId: "11" });
      expect(plan.intended_rows).toEqual([
        row("11"),
        { ...row("12"), Price: "0.20" },
        row(),
      ]);
      expect(plan.diff.map((d) => d.kind)).toEqual([
        "updated",
        "added",
        "removed",
      ]);
      expect(plan.removed_row_ids).toEqual(["13"]);
      expect(plan.totals).toEqual({
        net: "0.4",
        vat: "0.1",
        gross: "0.5",
        rounding: "unrounded",
        provider_total_verified: false,
      });
    });

    it("rejects duplicate, foreign, retained-and-removed and regenerated stale row IDs", () => {
      for (const [rows, removed] of [
        [[{ RowId: "11" }, { RowId: "11" }], []],
        [[{ RowId: "99" }], ["11"]],
        [[{ RowId: "11" }], ["11"]],
        [[row()], ["11", "11"]],
      ] as const)
        expect(() =>
          planDocumentRows("offer", [row("11")], rows, removed),
        ).toThrow();
      expect(() =>
        planDocumentRows("offer", [row("21")], [{ RowId: "11" }], ["21"]),
      ).toThrow();
      expect(() => planDocumentRows("offer", null, [row("11")])).toThrow();
    });

    it("keeps mixed VAT and large fractional prices exact without assuming provider rounding", () => {
      const plan = planDocumentRows("offer", null, [
        {
          ...row(),
          Price: "90071992547409.123456",
          Quantity: "0.000001",
          VAT: "25",
        },
        { ...row(), Price: "0.10", Quantity: "3", VAT: "12" },
        { ...row(), Price: "0.01", Quantity: "1", VAT: "6" },
      ]);
      expect(plan.totals.net).toBe("90071992.857409123456");
      expect(plan.totals.vat).toBe("22517998.173452280864");
      expect(plan.totals.gross).toBe("112589991.03086140432");
    });

    it("enforces resource-specific quantities and excludes implicit tax, stock and discounts", () => {
      expect(() =>
        planDocumentRows("offer", null, [{ ...row(), VAT: undefined }]),
      ).toThrow();
      expect(() =>
        planDocumentRows("offer", null, [{ ...row(), Price: "NaN" }]),
      ).toThrow();
      expect(() =>
        planDocumentRows("offer", null, [{ ...row(), Quantity: "0" }]),
      ).toThrow();
      expect(() =>
        planDocumentRows("offer", null, [{ ...row(), Discount: "10" }]),
      ).toThrow();
      expect(() => planDocumentRows("invoice", null, [row()])).toThrow();
      const { Quantity: _quantity, ...rest } = row() as ReturnType<
        typeof row
      > & { Quantity: string };
      expect(() =>
        planDocumentRows("order", null, [
          { ...rest, OrderedQuantity: "1", DeliveredQuantity: "2" },
        ]),
      ).toThrow();
      expect(() =>
        planDocumentRows("invoice", null, [
          { ...rest, DeliveredQuantity: "1", VAT: "12.5" },
        ]),
      ).toThrow();
    });

    it("requires company-specific verified current accounting references and open dates", () => {
      const input = {
        company_id: refs().company_id,
        financial_year: 1,
        date: "2026-11-10",
        rows: [row()],
      };
      expect(() =>
        validateDocumentAccounts(input, refs(), 100001),
      ).not.toThrow();
      for (const reference of [
        { ...refs(), company_id: "90000000-0000-4000-8000-000000000002" },
        { ...refs(), validation_verified: false },
        { ...refs(), complete: false },
        { ...refs(), financial_year: 2 },
        { ...refs(), retrieved_at: 1 },
        { ...refs(), retrieved_at: 100002 },
        { ...refs(), locked_through: "2026-11-10" },
        { ...refs(), accounts: [] },
        { ...refs(), account_numbers: [4001] },
        {
          ...refs(),
          accounts: [
            {
              number: 3001,
              active: true,
              cost_center: "REQUIRED" as const,
              project: "ALLOWED" as const,
              information: "ALLOWED" as const,
            },
          ],
        },
      ])
        expect(() =>
          validateDocumentAccounts(input, reference, 100001),
        ).toThrow();
      expect(() =>
        validateDocumentAccounts(
          { ...input, rows: [{ ...row(), CostCenter: "OTHER" }] },
          refs(),
          100001,
        ),
      ).toThrow();
    });
  });
}
