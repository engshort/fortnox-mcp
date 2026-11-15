import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Connections,
  CredentialVault,
  FinancialAnalysis,
  FinancialContexts,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxFinancialReads,
  financialReadOperations,
} from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";
import { openProductDatabase } from "../../apps/node/src/product-database.js";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteAnalysisStore } from "../../apps/node/src/receipt-storage.js";
import { keyA } from "../shared/connections.js";
import { setup } from "../shared/financial-reads.js";

it("resumes encrypted analysis checkpoints after closing and reopening the actual SQLite database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fortnox-analysis-restart-"));
  const path = join(directory, "product.sqlite"),
    migrations = resolve("apps/worker/migrations");
  let db = await openProductDatabase(path, migrations);
  try {
    const f = await setup(sqliteState(db));
    const q = { company_id: f.a.id, from: f.query.from, to: f.query.to };
    const contexts = new FinancialContexts(
      f.connections,
      f.adapter,
      sqliteAnalysisStore(db),
      true,
    );
    let result = await contexts.prepare(f.actor, q);
    expect(result.state).toBe("building");
    db.close();
    db = await openProductDatabase(path, migrations);
    const connections = new Connections(
      sqliteState(db),
      new CredentialVault({ a: keyA }, "a"),
    );
    const provider = new FortnoxConnections({
      ...f.provider.config,
      connections,
    });
    const reads = new FortnoxFinancialReads(
      connections,
      provider,
      financialReadOperations,
      () => true,
    );
    const resumed = new FinancialContexts(
      connections,
      reads,
      sqliteAnalysisStore(db),
      true,
    );
    for (let i = 0; result.state !== "ready" && i < 30; i++)
      result = await resumed.prepare(f.actor, {
        ...q,
        analysis_context_id: result.analysis_context_id,
      });
    expect(result.state).toBe("ready");
    const report = await new FinancialAnalysis(
      connections,
      reads,
      true,
      resumed,
    ).report(f.actor, {
      ...f.query,
      analysis_context_id: result.analysis_context_id,
    });
    expect(
      report.accounts.find((a) => a.number === 1930)?.period_movement,
    ).toBe("150.00");
    expect(f.requests.filter((r) => r.path === "/3/sie/4")).toHaveLength(2);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
