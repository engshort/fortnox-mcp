import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import {
  Connections,
  CredentialVault,
  FinancialAnalysis,
  FinancialContexts,
  largeSieLimits,
  parseSie4,
  sumFinancialAmounts,
} from "@fortnox-mcp/core";
import {
  type FinancialReadMetric,
  FortnoxConnections,
  FortnoxFinancialReads,
  financialReadOperations,
} from "@fortnox-mcp/fortnox";
import { sqliteState } from "../apps/node/src/product-storage.js";
import { sqliteAnalysisStore } from "../apps/node/src/receipt-storage.js";
import { syntheticSieWorkload } from "./lib/synthetic-sie.js";

const iterations = Number(process.argv[2] ?? 30);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100)
  throw new Error("Use 1–100 iterations");
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    p50_ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
const results: unknown[] = [];
if (!process.argv.includes("--queries-only"))
  for (const [name, count, text] of [
    ["small", 100, 16],
    ["large", 20000, 210],
    ["boundary", 100000, 16],
  ] as const) {
    const bytes = syntheticSieWorkload(count, text),
      times = [];
    const cpu = process.cpuUsage();
    let rss = process.memoryUsage().rss;
    for (let i = 0; i < iterations; i++) {
      global.gc?.();
      const started = performance.now();
      const parsed = await parseSie4(bytes, "cp437", largeSieLimits);
      if (
        parsed.movements.length !== count ||
        sumFinancialAmounts(
          parsed.movements.map((m) => m.amount),
          2,
        ) !== "0.00"
      )
        throw new Error("Incomplete synthetic workload");
      times.push(performance.now() - started);
      rss = Math.max(rss, process.memoryUsage().rss);
    }
    results.push({
      workload: name,
      movements: count,
      bytes: bytes.length,
      ...stats(times),
      cpu_microseconds: process.cpuUsage(cpu),
      observed_rss_bytes: rss,
      all_movements_preserved: true,
    });
  }
// End-to-end synthetic adapter traffic, including its real pacing and SQL cache.
for (const [workload, movementCount, textLength] of [
  ["small", 100, 16],
  ["large", 20000, 210],
] as const) {
  global.gc?.();
  const db = new DatabaseSync(":memory:");
  for (const file of ["0002_product_state.sql", "0007_analysis_contexts.sql"])
    db.exec(
      readFileSync(
        new URL(`../apps/worker/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  try {
    const state = sqliteState(db),
      store = sqliteAnalysisStore(db);
    const connections = new Connections(
      state,
      new CredentialVault({ synthetic: btoa("x".repeat(32)) }, "synthetic"),
    );
    const actor = {
      ownerId: "synthetic-benchmark-owner",
      clientId: "synthetic-benchmark-client",
      scopes: ["mcp:read"],
    };
    const company = await connections.add(
      actor.ownerId,
      {
        tenant: "100001",
        name: "Synthetic benchmark",
        organizationNumber: "0000000000",
        mode: "service",
        scopes: ["bookkeeping"],
      },
      {
        clientId: "synthetic-provider-client",
        clientSecret: "synthetic-provider-secret",
        accessToken: "synthetic-token",
        expiresAt: Date.now() + 3600000,
      },
    );
    await connections.grant(actor.ownerId, actor.clientId, [company.id]);
    const sie = syntheticSieWorkload(movementCount, textLength),
      metrics: FinancialReadMetric[] = [];
    let calls = 0,
      transferred = 0;
    const provider = new FortnoxConnections({
      origin: "https://synthetic.invalid",
      connections,
      testTenants: ["100001"],
      fetch: async (input) => {
        const path = new URL((input as Request).url).pathname;
        calls++;
        let response: Response;
        if (path === "/3/sie/4") response = new Response(sie);
        else if (path === "/3/financialyears")
          response = Response.json({
            FinancialYears: [
              { Id: 7, FromDate: "2025-01-01", ToDate: "2025-12-31" },
            ],
            MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 },
          });
        else if (path === "/3/financialyears/7")
          response = Response.json({
            FinancialYear: {
              Id: 7,
              FromDate: "2025-01-01",
              ToDate: "2025-12-31",
            },
          });
        else if (path === "/3/accounts")
          response = Response.json({
            Accounts: [1930, 4000].map((number) => ({
              Number: number,
              Description: "Synthetic account",
              Active: true,
              Year: 7,
              BalanceBroughtForward: "0.00",
              BalanceCarriedForward: (
                ((number === 1930 ? 1 : -1) * movementCount) /
                200
              ).toFixed(2),
            })),
            MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 },
          });
        else throw new Error("Unexpected synthetic operation");
        transferred += (await response.clone().arrayBuffer()).byteLength;
        return response;
      },
    });
    const adapter = new FortnoxFinancialReads(
      connections,
      provider,
      financialReadOperations,
      () => true,
      Date.now,
      undefined,
      undefined,
      { large: true, observe: (m) => metrics.push(m) },
    );
    const contexts = new FinancialContexts(connections, adapter, store, true),
      service = new FinancialAnalysis(connections, adapter, true, contexts);
    const query = {
      company_id: company.id,
      financial_year: 7,
      from: "2025-01-01",
      to: "2025-12-31",
    };
    const cold = [],
      warm = [],
      cpu = process.cpuUsage();
    let baselineRss = process.memoryUsage().rss;
    for (let i = 0; i < 10; i++) {
      const tick = performance.now();
      await service.report(actor, query);
      cold.push(performance.now() - tick);
      baselineRss = Math.max(baselineRss, process.memoryUsage().rss);
    }
    const baseline = {
      cpu_microseconds: process.cpuUsage(cpu),
      observed_rss_bytes: baselineRss,
      calls,
      transferred_bytes: transferred,
      exports: metrics.filter((m) => m.operation === "financial.sie4").length,
      ...stats(cold),
    };
    metrics.length = 0;
    calls = 0;
    transferred = 0;
    const preparedCpu = process.cpuUsage();
    let preparedRss = process.memoryUsage().rss;
    const tick = performance.now();
    const preparation = {
      company_id: company.id,
      from: query.from,
      to: query.to,
    };
    let status = await contexts.prepare(actor, preparation);
    while (status.state !== "ready")
      status = await contexts.prepare(actor, {
        ...preparation,
        analysis_context_id: status.analysis_context_id,
      });
    const preparation_ms = performance.now() - tick;
    for (let i = 0; i < 10; i++) {
      const begin = performance.now();
      await service.report(actor, {
        ...query,
        analysis_context_id: status.analysis_context_id,
      });
      warm.push(performance.now() - begin);
      preparedRss = Math.max(preparedRss, process.memoryUsage().rss);
    }
    results.push({
      workload: `ten_followups_${workload}`,
      movements: movementCount,
      baseline,
      prepared: {
        cpu_microseconds: process.cpuUsage(preparedCpu),
        observed_rss_bytes: preparedRss,
        preparation_ms,
        calls,
        transferred_bytes: transferred,
        exports: metrics.filter((m) => m.operation === "financial.sie4").length,
        parses: metrics.filter(
          (m) => m.operation === "sie.parse" && m.outcome === "ok",
        ).length,
        ...stats(warm),
      },
      cpu_microseconds: process.cpuUsage(cpu),
      observed_rss_bytes: process.memoryUsage().rss,
    });
  } finally {
    db.close();
  }
}
process.stdout.write(
  `${JSON.stringify({ environment: "synthetic-node-sqlite-only", runtime: process.version, results }, null, 2)}\n`,
);
