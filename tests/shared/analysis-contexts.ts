import {
  type AnalysisSource,
  type AnalysisStore,
  DatedFinancialAnalysis,
  FinancialAnalysis,
  FinancialContexts,
  type StateStore,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxFinancialReads,
  financialReadOperations,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { syntheticSieWorkload } from "../../scripts/lib/synthetic-sie.js";
import { syntheticFinancialBasis } from "./analytics.js";
import { setup } from "./financial-reads.js";

export interface AnalysisFixture {
  state: StateStore;
  store: AnalysisStore;
  stored: () => Promise<string>;
  count: () => Promise<number>;
}
export function analysisContextContract(
  fixture: () => Promise<AnalysisFixture>,
) {
  async function make() {
    const storage = await fixture(),
      f = await setup(storage.state);
    let offset = 0;
    const now = () => Date.now() + offset;
    const contexts = new FinancialContexts(
      f.connections,
      f.adapter,
      storage.store,
      true,
      now,
    );
    const service = new FinancialAnalysis(
      f.connections,
      f.adapter,
      true,
      contexts,
    );
    const q = { company_id: f.a.id, from: f.query.from, to: f.query.to };
    async function prepare() {
      let result = await contexts.prepare(f.actor, q);
      for (let i = 0; result.state !== "ready" && i < 100; i++)
        result = await contexts.prepare(f.actor, {
          ...q,
          analysis_context_id: result.analysis_context_id,
        });
      expect(result.state).toBe("ready");
      return result.analysis_context_id;
    }
    return {
      ...f,
      ...storage,
      contexts,
      analysis: service,
      q,
      prepare,
      advance: (ms: number) => {
        offset += ms;
      },
    };
  }
  describe("bounded encrypted analysis contexts", () => {
    it("pins multiple non-calendar years, continues without reloading earlier sources and rejects changed verification profiles", async () => {
      const f = await make();
      const years = [
        { id: 7, from: "2025-07-01", to: "2026-06-30" },
        { id: 8, from: "2026-07-01", to: "2027-06-30" },
      ];
      let version = "a".repeat(64),
        built = 0;
      const source: AnalysisSource = {
        years: async () => ({
          company_id: f.a.id,
          years,
          complete: true,
          source_version: "c".repeat(64),
          sources: [
            {
              operation: "synthetic.years",
              record_id: "all",
              sha256: "d".repeat(64),
            },
          ],
        }),
        profileVersion: async () => version,
        financialYear: async (_actor, _company, id) => {
          const year = years.find((y) => y.id === id);
          if (!year) throw new Error("Unknown synthetic year");
          return year;
        },
        beginAnalysisYear: async (_actor, q) => {
          built++;
          return { source: q, cursor: null };
        },
        advanceAnalysisYear: async (_actor, _cursor, readSource) => {
          const id = ((await readSource()) as { financial_year: number })
            .financial_year;
          const year = years.find((y) => y.id === id);
          if (!year) throw new Error("Unknown synthetic year");
          const basis = syntheticFinancialBasis(f.a.id);
          basis.year = year;
          basis.source_version = (id === 7 ? "a" : "b").repeat(64);
          if (id === 8)
            basis.movements = basis.movements.map((m) => ({
              ...m,
              date: m.date.replace("2026", "2027").replace("2025", "2026"),
            }));
          return { basis };
        },
      };
      const contexts = new FinancialContexts(
        f.connections,
        source,
        f.store,
        true,
      );
      const q = { company_id: f.a.id, from: "2025-07-01", to: "2026-08-31" };
      let status = await contexts.prepare(f.actor, q);
      for (let i = 0; status.state !== "ready" && i < 30; i++)
        status = await contexts.prepare(f.actor, {
          ...q,
          analysis_context_id: status.analysis_context_id,
        });
      expect(status).toMatchObject({ state: "ready", years_completed: 2 });
      const analysis = new FinancialAnalysis(
        f.connections,
        f.adapter,
        true,
        contexts,
      );
      const dated = new DatedFinancialAnalysis(f.connections, analysis, source);
      const query = {
        ...q,
        analysis_context_id: status.analysis_context_id,
        page_size: 1,
      };
      let page = await dated.transactions(f.actor, query),
        rows = page.rows.length,
        requests = 1;
      while (page.page.next && requests < 30) {
        page = await dated.transactions(f.actor, {
          ...query,
          continuation: page.page.next,
        });
        rows += page.rows.length;
        requests++;
      }
      expect(rows).toBeGreaterThan(3);
      expect(built).toBe(2);
      expect(page.page.next).toBeNull();
      version = "b".repeat(64);
      await expect(
        dated.balances(f.actor, {
          company_id: f.a.id,
          as_of: "2026-08-01",
          analysis_context_id: status.analysis_context_id,
        }),
      ).rejects.toMatchObject({
        reason: "analysis_profile_changed_prepare_again",
      });
    });
    it("reads a fourteen-page chart without rewriting or reloading the immutable SIE dataset for every page", async () => {
      const f = await make();
      let staged = 0,
        loaded = 0,
        accountPages = 0;
      const store = {
        ...f.store,
        write: async (...args: Parameters<AnalysisStore["write"]>) => {
          if (args[2] === "source" && args[3].length) staged++;
          return f.store.write(...args);
        },
        read: async (...args: Parameters<AnalysisStore["read"]>) => {
          if (args[1] === "source") loaded++;
          return f.store.read(...args);
        },
      };
      const provider = new FortnoxConnections({
        ...f.provider.config,
        fetch: async (input) => {
          const url = new URL((input as Request).url);
          if (url.pathname !== "/3/accounts")
            return f.provider.config.fetch(input);
          const page = Number(url.searchParams.get("page"));
          accountPages++;
          return Response.json({
            Accounts: Array.from({ length: 100 }, (_, i) => ({
              Number: 1000 + (page - 1) * 100 + i,
              Description: "Synthetic paginated account",
              Active: true,
              Year: 7,
              BalanceBroughtForward: "0",
              BalanceCarriedForward: "0",
            })),
            MetaInformation: {
              "@CurrentPage": page,
              "@TotalPages": 14,
              "@TotalResources": 1400,
            },
          });
        },
      });
      const adapter = new FortnoxFinancialReads(
        f.connections,
        provider,
        financialReadOperations,
        () => true,
      );
      const contexts = new FinancialContexts(
        f.connections,
        adapter,
        store,
        true,
      );
      let status = await contexts.prepare(f.actor, f.q);
      for (let i = 0; status.state !== "ready" && i < 30; i++)
        status = await contexts.prepare(f.actor, {
          ...f.q,
          analysis_context_id: status.analysis_context_id,
        });
      expect(status.state).toBe("ready");
      expect(accountPages).toBe(14);
      expect(staged).toBe(1);
      expect(loaded).toBe(1);
      const report = await new FinancialAnalysis(
        f.connections,
        adapter,
        true,
        contexts,
      ).report(f.actor, {
        ...f.query,
        analysis_context_id: status.analysis_context_id,
      });
      expect(report.coverage.accounts).toBe(true);
      expect(report.accounts_page.total_in_selection).toBeGreaterThanOrEqual(
        1400,
      );
    }, 60000);
    it.each([20000, 100000])(
      "builds and reuses an encrypted multi-step context exceeding the old SIE size and row limits (%i movements)",
      async (count) => {
        const f = await make();
        const bytes = new TextEncoder().encode(
          new TextDecoder()
            .decode(syntheticSieWorkload(count, count === 20000 ? 210 : 16))
            .replace("20250101 20251231", "20250701 20260630")
            .replaceAll("20250615", "20250801"),
        );
        const provider = new FortnoxConnections({
          ...f.provider.config,
          fetch: async (input) =>
            new URL((input as Request).url).pathname === "/3/sie/4"
              ? new Response(bytes)
              : f.provider.config.fetch(input),
        });
        const adapter = new FortnoxFinancialReads(
          f.connections,
          provider,
          financialReadOperations,
          () => true,
          Date.now,
          undefined,
          undefined,
          { large: true },
        );
        const contexts = new FinancialContexts(
          f.connections,
          adapter,
          f.store,
          true,
        );
        let status = await contexts.prepare(f.actor, f.q);
        let calls = 1;
        while (status.state !== "ready" && calls < 100) {
          status = await contexts.prepare(f.actor, {
            ...f.q,
            analysis_context_id: status.analysis_context_id,
          });
          calls++;
        }
        expect(status.state).toBe("ready");
        expect(calls).toBeGreaterThan(5);
        const service = new FinancialAnalysis(
          f.connections,
          adapter,
          true,
          contexts,
        );
        const report = await service.report(f.actor, {
          ...f.query,
          analysis_context_id: status.analysis_context_id,
        });
        expect(report.accounts.find((a) => a.number === 1930)).toMatchObject({
          period_movement: (count / 200).toFixed(2),
          movement_count: count / 2,
        });
        expect(report.complete).toBe(false);
        const page = await service.movements(f.actor, {
          ...f.query,
          account_number: 1930,
          page_size: 50,
          analysis_context_id: status.analysis_context_id,
        });
        expect(page.rows).toHaveLength(50);
        expect(page.page.total_in_selection).toBe(count / 2);
      },
      180000,
    );
    it("reduces ten repeated reads from twenty exports to two and preserves exact reports, source IDs and original observation times", async () => {
      const f = await make(),
        direct = new FinancialAnalysis(f.connections, f.adapter, true);
      let baseline = await direct.report(f.actor, f.query);
      for (let i = 1; i < 10; i++)
        baseline = await direct.report(f.actor, f.query);
      expect(f.requests.filter((r) => r.path === "/3/sie/4")).toHaveLength(20);
      f.requests.length = 0;
      const id = await f.prepare();
      for (let i = 0; i < 10; i++) {
        const result = await f.analysis.report(f.actor, {
          ...f.query,
          analysis_context_id: id,
        });
        expect(result.accounts).toEqual(baseline.accounts);
        expect(result.totals).toEqual(baseline.totals);
        expect(result.source_version).toBe(baseline.source_version);
        expect(result.limitations).toEqual(baseline.limitations);
        expect(result.analysis_context).toMatchObject({
          id,
          mode: "pinned_basis",
        });
        expect(result.retrieved.finished_at).toBeLessThanOrEqual(
          result.analysis_context?.provider_access_checked_at ?? 0,
        );
      }
      expect(f.requests.filter((r) => r.path === "/3/sie/4")).toHaveLength(2);
      expect(f.requests.filter((r) => r.path === "/3/accounts")).toHaveLength(
        1,
      );
      expect(await f.stored()).not.toContain("Synthetic booked bank");
      expect(await f.stored()).not.toContain("1150.00");
    }, 30000);
    it("supports source-bound movement paging, dated reads and a fresh source voucher through strict MCP schemas", async () => {
      const f = await make(),
        id = await f.prepare();
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider: f.provider,
        testMode: true,
        financial: { service: f.analysis, provider: f.adapter },
      });
      const [ct, st] = InMemoryTransport.createLinkedPair(),
        client = new Client({
          name: "synthetic-analysis-context",
          version: "1",
        });
      await server.connect(st);
      await client.connect(ct);
      try {
        expect(
          (await client.listTools()).tools.some(
            (t) => t.name === "prepare_financial_analysis",
          ),
        ).toBe(true);
        for (const [name, args] of [
          ["get_financial_analysis", f.query],
          ["get_account_balances", { company_id: f.a.id, as_of: "2026-01-01" }],
          [
            "list_financial_movements",
            { ...f.query, account_number: 1930, page_size: 1 },
          ],
          ["list_financial_transactions", f.q],
        ] as const) {
          const result = await client.callTool({
            name,
            arguments: { ...args, analysis_context_id: id },
          });
          expect(
            result.isError,
            JSON.stringify(result.structuredContent),
          ).not.toBe(true);
          expect(result.structuredContent).toMatchObject({
            status: "ok",
            data: { analysis_context: { id } },
          });
        }
        const first = await f.analysis.movements(f.actor, {
          ...f.query,
          account_number: 1930,
          page_size: 1,
          analysis_context_id: id,
        });
        expect(first.rows[0]?.voucher_ref).toMatchObject({
          financial_year: 7,
          series: "A",
        });
        const second = await f.analysis.movements(f.actor, {
          ...f.query,
          account_number: 1930,
          page_size: 1,
          analysis_context_id: id,
          continuation: first.page.next,
        });
        expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
        expect(second.page.next).toBeNull();
        const voucher = await client.callTool({
          name: "get_financial_voucher",
          arguments: {
            company_id: f.a.id,
            financial_year: 7,
            series: "A",
            number: 1,
          },
        });
        expect(voucher.structuredContent).toMatchObject({
          status: "ok",
          data: { rows: [{ debit: "9007199254740993.01" }] },
        });
      } finally {
        await client.close();
        await server.close();
      }
    });
    it("does not let a late executor delete or finalize another executor's lease", async () => {
      const f = await make(),
        result = await f.contexts.prepare(f.actor, f.q);
      const now = Date.now(),
        old = await f.store.claim(result.analysis_context_id, now);
      const current = await f.store.claim(
        result.analysis_context_id,
        now + 50001,
      );
      if (!old || !current) throw new Error("Missing synthetic lease");
      await f.store.remove(result.analysis_context_id, old);
      const record = await f.store.get(result.analysis_context_id);
      expect(record).not.toBeNull();
      if (!record) throw new Error("Missing synthetic context");
      expect(
        await f.store.finish(
          record.id,
          old,
          record.manifest,
          record.expires,
          true,
          now + 50001,
        ),
      ).toBe(false);
      await f.store.remove(record.id, current);
      expect(await f.store.get(record.id)).toBeNull();
    });
    it("resumes after a new service instance and coalesces concurrent preparations", async () => {
      const f = await make();
      const calls = await Promise.all([
        f.contexts.prepare(f.actor, f.q),
        f.contexts.prepare(f.actor, f.q),
      ]);
      expect(new Set(calls.map((c) => c.analysis_context_id)).size).toBe(1);
      expect(f.requests.filter((r) => r.path === "/3/sie/4")).toHaveLength(1);
      const resumed = new FinancialContexts(
        f.connections,
        f.adapter,
        f.store,
        true,
      );
      let result = calls[0];
      if (!result) throw new Error("Missing fixture result");
      for (let i = 0; result.state !== "ready" && i < 100; i++)
        result = await resumed.prepare(f.actor, {
          ...f.q,
          analysis_context_id: result.analysis_context_id,
        });
      expect(result.state).toBe("ready");
      const report = await new FinancialAnalysis(
        f.connections,
        f.adapter,
        true,
        resumed,
      ).report(f.actor, {
        ...f.query,
        analysis_context_id: result.analysis_context_id,
      });
      expect(
        report.accounts.find((a) => a.number === 1930)?.period_movement,
      ).toBe("150.00");
    });
    it("rejects other owners, companies and separately authorized clients without returning cached financial data", async () => {
      const f = await make(),
        id = await f.prepare(),
        q = { ...f.query, analysis_context_id: id };
      await f.connections.grant(f.actor.ownerId, "another-client", [f.a.id]);
      for (const [actor, query] of [
        [{ ...f.actor, ownerId: "other-owner" }, q],
        [{ ...f.actor, clientId: "another-client" }, q],
        [f.actor, { ...q, company_id: f.b.id }],
        [{ ...f.actor, scopes: [] }, q],
      ] as const)
        await expect(f.analysis.report(actor, query)).rejects.toThrow();
    });
    it("expires without sliding retention and physically cleans all encrypted parts", async () => {
      const f = await make(),
        id = await f.prepare();
      f.advance(4 * 60000);
      const first = await f.analysis.report(f.actor, {
        ...f.query,
        analysis_context_id: id,
      });
      f.advance(60001);
      await expect(
        f.analysis.report(f.actor, { ...f.query, analysis_context_id: id }),
      ).rejects.toMatchObject({ reason: "analysis_expired_prepare_again" });
      expect(first.analysis_context?.expires_at).toBeDefined();
      expect(await f.count()).toBe(0);
      expect(await f.store.get(id)).toBeNull();
    });
    it("rejects provider permission loss before a cache hit and discards the context", async () => {
      const f = await make(),
        id = await f.prepare();
      f.flags.denied = true;
      await expect(
        f.analysis.report(f.actor, { ...f.query, analysis_context_id: id }),
      ).rejects.toMatchObject({
        reason: "permission_scope_or_license_unknown",
      });
      expect(await f.count()).toBe(0);
    });
    it("keeps changed SIE sources incomplete and refuses to publish a reusable context", async () => {
      const f = await make();
      f.flags.changed = true;
      await expect(f.prepare()).rejects.toMatchObject({
        reason: "source_changed_during_retrieval_prepare_again",
      });
      expect(await f.count()).toBe(0);
    });
    it("invalidates a pinned basis before dispatch of an unknown voucher write", async () => {
      const f = await make(),
        id = await f.prepare();
      const proposal = await f.service.prepare(f.actor, f.voucher);
      f.service.provider.submit = async (_a, _v, before) => {
        await before();
        throw new Error("Synthetic lost reply");
      };
      await f.service.commit(
        f.actor,
        {
          company_id: proposal.company_id,
          proposal_id: proposal.proposal_id,
          proposal_hash: proposal.proposal_hash,
          capability: proposal.capability,
        },
        "review",
      );
      await expect(
        f.analysis.report(f.actor, { ...f.query, analysis_context_id: id }),
      ).rejects.toMatchObject({
        reason: "analysis_access_or_source_changed_prepare_again",
      });
    });
    it("bounds owner capacity atomically and deletes abandoned work", async () => {
      const f = await make();
      await f.contexts.prepare(f.actor, f.q);
      await f.contexts.prepare(f.actor, { ...f.q, from: "2025-08-01" });
      await expect(
        f.contexts.prepare(f.actor, { ...f.q, from: "2025-09-01" }),
      ).rejects.toMatchObject({
        reason: "analysis_capacity_exceeded_wait_for_expiry_or_reduce_input",
      });
      f.advance(10 * 60000 + 1);
      await f.store.cleanup(Date.now() + 11 * 60000);
      expect(await f.count()).toBe(0);
    });
    it("pins dates through the shared fiscal-year resolver and refreshes only on a new preparation", async () => {
      const f = await make(),
        id = await f.prepare();
      const dated = new DatedFinancialAnalysis(
        f.connections,
        f.analysis,
        f.adapter,
      );
      const result = await dated.transactions(f.actor, {
        ...f.q,
        analysis_context_id: id,
      });
      expect(result.rows.length).toBeGreaterThan(0);
      const next = await f.contexts.prepare(f.actor, f.q);
      expect(next.analysis_context_id).not.toBe(id);
    });
  });
}
