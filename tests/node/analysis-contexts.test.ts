import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteAnalysisStore } from "../../apps/node/src/receipt-storage.js";
import { analysisContextContract } from "../shared/analysis-contexts.js";

const opened: DatabaseSync[] = [];
afterEach(() => {
  for (const db of opened) db.close();
  opened.length = 0;
});
analysisContextContract(async () => {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  for (const file of ["0002_product_state.sql", "0007_analysis_contexts.sql"])
    db.exec(
      readFileSync(
        new URL(`../../apps/worker/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  return {
    state: sqliteState(db),
    store: sqliteAnalysisStore(db),
    stored: async () =>
      JSON.stringify(db.prepare("SELECT * FROM analysis_parts").all()),
    count: async () =>
      Number(db.prepare("SELECT count(*) AS n FROM analysis_parts").get()?.n),
  };
});
