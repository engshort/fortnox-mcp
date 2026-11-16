import {
  accountingHash,
  calculateInvoiceBalance,
  DatedFinancialAnalysis,
  FinancialAnalysis,
  type FinancialBasis,
  type InvoiceHistory,
  OpenItems,
  parseSie4,
  reconcileOpenItemLedger,
  type StateStore,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { accountingFixture } from "./accounting.js";
import { syntheticFinancialBasis, syntheticSie } from "./analytics.js";

async function setup(state: StateStore) {
  const f = await accountingFixture(state);
  const first = syntheticFinancialBasis(f.a.id);
  const second: FinancialBasis = {
    ...syntheticFinancialBasis(f.a.id),
    source_version: "b".repeat(64),
    year: { id: 8, from: "2026-07-01", to: "2027-06-30" },
    movements: [
      {
        id: "next:1",
        date: "2026-07-01",
        account: 1930,
        amount: "0.10",
        effective: true,
        source_ref: "synthetic:next",
        dimensions: {},
        description: "Synthetic next year",
      },
    ],
  };
  const bases = [first, second];
  const flags = {
    yearsComplete: true,
    disconnect: false,
    yearVersion: "c".repeat(64),
  };
  let calls = 0;
  const provider = {
    years: async () => {
      calls++;
      return {
        company_id: f.a.id,
        years: bases.map((b) => b.year),
        complete: flags.yearsComplete,
        source_version: flags.yearVersion,
        sources: [
          {
            operation: "synthetic_years",
            record_id: "1",
            sha256: flags.yearVersion,
          },
        ],
      };
    },
    basis: async (_actor: unknown, q: { financial_year: number }) => {
      calls++;
      if (flags.disconnect)
        await f.connections.disconnect(f.actor.ownerId, f.a.id);
      const basis = bases.find((b) => b.year.id === q.financial_year);
      if (!basis) throw Error("Missing synthetic year");
      return basis;
    },
  };
  const financial = new FinancialAnalysis(f.connections, provider, true);
  const service = new DatedFinancialAnalysis(
    f.connections,
    financial,
    provider,
    () => Date.parse("2026-11-13T12:00:00Z"),
  );
  return {
    ...f,
    first,
    second,
    bases,
    flags,
    service,
    provider,
    calls: () => calls,
  };
}
function history(company: string, id = "1"): InvoiceHistory {
  return {
    company_id: company,
    kind: "receivable",
    id,
    posted_on: "2025-12-01",
    original_amount: "1000.00",
    currency: "SEK",
    due_date: "2025-12-20",
    terms_verified: true,
    amounts_verified: true,
    complete: true,
    cancellation_verified: true,
    cancelled_on: null,
    settlements: [
      { id: "1", date: "2025-12-31", amount: "200.00" },
      { id: "2", date: "2026-01-10", amount: "800.00" },
    ],
    source_version: "d".repeat(64),
    sources: [
      {
        operation: "synthetic_invoice_history",
        record_id: id,
        sha256: "d".repeat(64),
      },
    ],
    limitations: [],
  };
}

export function datedFinancialContract(fixture: () => Promise<StateStore>) {
  describe("S08 dated balances and cross-year transaction pages", () => {
    it("selects the actual non-calendar year and preserves opening-plus-effective-movement balances", async () => {
      const f = await setup(await fixture());
      for (const [as_of, amount] of [
        ["2025-07-31", "1000.00"],
        ["2025-08-01", "1250.00"],
        ["2025-12-31", "1250.00"],
        ["2026-01-01", "1150.00"],
      ]) {
        const r = await f.service.balances(f.actor, {
          company_id: f.a.id,
          as_of,
          account_numbers: [1930],
        });
        expect(r.financial_year.id).toBe(7);
        expect(r.accounts[0]?.balance_as_of).toBe(amount);
      }
      const r = await f.service.balances(f.actor, {
        company_id: f.a.id,
        as_of: "2025-12-31",
      });
      expect(r.accounts.find((a) => a.number === 9901)).toMatchObject({
        active: false,
        balance_as_of: "0.00",
      });
      const page = await f.service.balances(f.actor, {
        company_id: f.a.id,
        as_of: "2025-12-31",
        page_size: 1,
      });
      expect(page.accounts_page.next).not.toBeNull();
      f.flags.yearVersion = "e".repeat(64);
      await expect(
        f.service.balances(f.actor, {
          company_id: f.a.id,
          as_of: "2025-12-31",
          continuation: page.accounts_page.next,
        }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
    });
    it("paginates all effective rows across years without adding opening balances or duplicating rows", async () => {
      const f = await setup(await fixture());
      const q = {
        company_id: f.a.id,
        from: "2026-01-01",
        to: "2026-07-01",
        page_size: 1,
      };
      let page = await f.service.transactions(f.actor, q);
      const rows = [...page.rows];
      while (page.page.next) {
        expect(page.complete).toBe(false);
        page = await f.service.transactions(f.actor, {
          ...q,
          continuation: page.page.next,
        });
        rows.push(...page.rows);
      }
      expect(rows.map((r) => [r.financial_year, r.account, r.amount])).toEqual([
        [7, 1930, "-100.00"],
        [7, 4000, "100.00"],
        [8, 1930, "0.10"],
      ]);
      expect(page.data_complete).toBe(true);
      expect(page.totals_scope).toBe("returned_page_only");
      expect(new Set(rows.map((r) => `${r.financial_year}:${r.id}`)).size).toBe(
        3,
      );
    });
    it("invalidates a continuation when a previously traversed year changes", async () => {
      const f = await setup(await fixture());
      const q = { company_id: f.a.id, from: "2026-06-30", to: "2026-07-01" };
      const page = await f.service.transactions(f.actor, q);
      expect(page.page.next).not.toBeNull();
      f.first.source_version = "e".repeat(64);
      await expect(
        f.service.transactions(f.actor, { ...q, continuation: page.page.next }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
    });
    it("surfaces absent years and incomplete indexes instead of inventing a complete empty interval", async () => {
      const f = await setup(await fixture());
      const empty = await f.service.transactions(f.actor, {
        company_id: f.a.id,
        from: "2024-01-01",
        to: "2024-12-31",
      });
      expect(empty).toMatchObject({
        complete: false,
        data_complete: false,
        rows: [],
        missing_intervals: [{ from: "2024-01-01", to: "2024-12-31" }],
      });
      f.flags.yearsComplete = false;
      await expect(
        f.service.balances(f.actor, {
          company_id: f.a.id,
          as_of: "2025-12-31",
        }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(
        (
          await f.service.transactions(f.actor, {
            company_id: f.a.id,
            from: "2025-08-01",
            to: "2025-08-01",
          })
        ).data_complete,
      ).toBe(false);
    });
    it("authorizes before retrieval and discards a late disconnect and unknown movement coverage", async () => {
      const f = await setup(await fixture());
      await expect(
        f.service.transactions(
          { ...f.actor, scopes: [] },
          { company_id: f.a.id, from: "2025-07-01", to: "2025-08-31" },
        ),
      ).rejects.toThrow("AUTH_REQUIRED");
      expect(f.calls()).toBe(0);
      f.first.coverage.movements = false;
      expect(
        (
          await f.service.balances(f.actor, {
            company_id: f.a.id,
            as_of: "2025-12-31",
          })
        ).accounts.every((a) => a.balance_as_of === null),
      ).toBe(true);
      f.flags.disconnect = true;
      await expect(
        f.service.transactions(f.actor, {
          company_id: f.a.id,
          from: "2025-07-01",
          to: "2025-08-31",
        }),
      ).rejects.toThrow();
    });
    it("validates SIE period movements without counting them as transactions and keeps transaction text", async () => {
      const sie = await parseSie4(
        new TextEncoder().encode(
          `${syntheticSie}#PSALDO 0 202508 1930 {} 250\n#PSALDO 0 202601 1930 {1 "SYNTHETIC"} -100\n`,
        ),
        "utf8",
      );
      expect(sie.period_balances).toHaveLength(2);
      expect(sie.movements).toHaveLength(4);
      expect(sie.limitations).not.toContain("period_balance_mismatch");
      expect(sie.movements[0]?.description).toBe("Synthetic");
      const bad = await parseSie4(
        new TextEncoder().encode(
          `${syntheticSie}#PSALDO 0 202508 1930 {} 251\n`,
        ),
        "utf8",
      );
      expect(bad.limitations).toContain("period_balance_mismatch");
    });
  });
  describe("S08 historical invoice balances", () => {
    it("reconciles the entire historical collection separately from page totals and rechecks earlier payment pages", async () => {
      const f = await accountingFixture(await fixture());
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes.push("invoice");
      });
      let changed = false;
      const service = new OpenItems(
        f.connections,
        {
          page: async (_actor, company, kind, number) => ({
            company_id: company,
            kind,
            records: [
              {
                id: String(number),
                counterparty_id: null,
                invoice_date: "2025-12-01",
                due_date: "2025-12-20",
                currency: "SEK",
                balance: "0.00",
                booked: true,
                cancelled: false,
                credit: false,
              },
            ],
            metadata_verified: true,
            exhausted: number === 2,
            next_page: number === 1 ? 2 : null,
            total_records: 2,
            source: {
              operation: "synthetic_invoices",
              record_id: String(number),
              sha256: number === 1 ? "a".repeat(64) : "b".repeat(64),
            },
            signed_balance_verified: true,
          }),
          history: async (_actor, company, kind, id) => ({
            ...history(company, id),
            kind,
            source_version:
              changed && id === "1" ? "e".repeat(64) : "d".repeat(64),
          }),
        },
        ["receivable"],
        () => Date.parse("2026-11-13T12:00:00Z"),
        async (_actor, _company, kind, _asOf, totals) => {
          expect(totals).toEqual([{ currency: "SEK", amount: "1600.00" }]);
          return reconcileOpenItemLedger(
            kind,
            "SEK",
            "1599.99",
            "1600.00",
            [9901],
            [],
          );
        },
      );
      const q = { company_id: f.a.id, kind: "receivable", as_of: "2025-12-31" };
      const first = await service.list(f.actor, q);
      const last = await service.list(f.actor, {
        ...q,
        continuation: first.page.next,
      });
      expect(last).toMatchObject({
        collection_complete: true,
        complete: false,
        totals: [{ balance_as_of_sum: "800.00" }],
        reconciliation: {
          scope: "entire_collection",
          status: "mismatch",
          subledger_balance: "1600.00",
          difference: "-0.01",
        },
      });
      changed = true;
      await expect(
        service.list(f.actor, { ...q, continuation: first.page.next }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
    });
    it("reconciles explicit control-account mappings with ledger signs and exact differences", () => {
      expect(
        reconcileOpenItemLedger(
          "receivable",
          "SEK",
          "800.00",
          "800.00",
          [9901],
          [],
        ),
      ).toMatchObject({ status: "matched", difference: "0.00" });
      expect(
        reconcileOpenItemLedger(
          "payable",
          "SEK",
          "-800.01",
          "800.00",
          [9902],
          [],
        ),
      ).toMatchObject({
        status: "mismatch",
        difference: "-0.01",
        subledger_balance: "-800.00",
      });
      expect(
        reconcileOpenItemLedger(
          "payable",
          "SEK",
          "100.10",
          "-100.10",
          [9902],
          [],
        ),
      ).toMatchObject({ status: "matched", difference: "0.00" });
    });
    it("uses inclusive dated settlements, credits and write-offs while preserving unknown histories", () => {
      const h = history("b1ebed10-cf85-4d62-9be3-ae56c71cc781");
      expect(calculateInvoiceBalance(h, "2025-11-30").balance_as_of).toBe(
        "0.00",
      );
      expect(calculateInvoiceBalance(h, "2025-12-30")).toMatchObject({
        balance_as_of: "1000.00",
        overdue: true,
      });
      expect(calculateInvoiceBalance(h, "2025-12-31").balance_as_of).toBe(
        "800.00",
      );
      expect(calculateInvoiceBalance(h, "2026-01-10").balance_as_of).toBe(
        "0.00",
      );
      const credit = {
        ...h,
        original_amount: "-100.00",
        settlements: [{ id: "c", date: "2025-12-15", amount: "-25.10" }],
      };
      expect(calculateInvoiceBalance(credit, "2025-12-31").balance_as_of).toBe(
        "-74.90",
      );
      expect(
        calculateInvoiceBalance({ ...h, complete: false }, "2025-12-31")
          .balance_as_of,
      ).toBeNull();
      expect(
        calculateInvoiceBalance(
          { ...h, cancellation_verified: false },
          "2025-12-31",
        ).balance_as_of,
      ).toBeNull();
      expect(
        calculateInvoiceBalance({ ...h, terms_verified: false }, "2025-12-31"),
      ).toMatchObject({
        balance_as_of: "800.00",
        due_date: null,
        overdue: null,
        complete: false,
      });
    });
    it("includes currently paid invoices and binds historical continuation to payment source versions", async () => {
      const f = await accountingFixture(await fixture());
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes.push("invoice", "supplierinvoice");
      });
      let version = "d".repeat(64);
      const service = new OpenItems(
        f.connections,
        {
          page: async (_actor, company, kind) => ({
            company_id: company,
            kind,
            records: Array.from({ length: 11 }, (_, i) => ({
              id: String(i + 1),
              counterparty_id: null,
              invoice_date: "2025-12-01",
              due_date: "2025-12-20",
              currency: "SEK",
              balance: "0.00",
              booked: true,
              cancelled: false,
              credit: false,
            })),
            metadata_verified: true,
            exhausted: true,
            next_page: null,
            total_records: 11,
            source: {
              operation: "synthetic_invoices",
              record_id: "1",
              sha256: "a".repeat(64),
            },
            signed_balance_verified: true,
          }),
          history: async (_actor, company, kind, id) => ({
            ...history(company, id),
            kind,
            source_version: version,
          }),
        },
        ["receivable", "payable"],
        () => Date.parse("2026-11-13T12:00:00Z"),
      );
      const query = {
        company_id: f.a.id,
        kind: "receivable",
        as_of: "2025-12-31",
      };
      const first = await service.list(f.actor, query);
      expect(first.records).toHaveLength(10);
      expect(first.records[0]).toMatchObject({
        balance: "0.00",
        current_provider_balance: "0.00",
        balance_as_of: "800.00",
        overdue: true,
      });
      const second = await service.list(f.actor, {
        ...query,
        continuation: first.page.next,
      });
      expect(second.records).toHaveLength(1);
      expect(second.page.next).toBeNull();
      version = await accountingHash("changed payment history");
      await expect(
        service.list(f.actor, { ...query, continuation: first.page.next }),
      ).rejects.toThrow("CONNECTION_CONFLICT");
    });
  });
}
