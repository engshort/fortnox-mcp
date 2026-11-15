import { env } from "cloudflare:workers";
import stateSchema from "../../apps/worker/migrations/0002_product_state.sql?raw";
import schema from "../../apps/worker/migrations/0007_analysis_contexts.sql?raw";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { d1AnalysisStore } from "../../apps/worker/src/receipt-storage.js";
import { analysisContextContract } from "../shared/analysis-contexts.js";

analysisContextContract(async () => {
  for (const source of [stateSchema, schema])
    await env.DB.exec(
      source.replace(/--[^\n]*(?:\n|$)/g, "").replace(/\n/g, " "),
    );
  await env.DB.exec(
    "DELETE FROM analysis_parts; DELETE FROM analysis_contexts; DELETE FROM product_state;",
  );
  return {
    state: d1State(env.DB),
    store: d1AnalysisStore(env.DB),
    stored: async () =>
      JSON.stringify(
        (await env.DB.prepare("SELECT * FROM analysis_parts").all()).results,
      ),
    count: async () =>
      (await env.DB.prepare(
        "SELECT count(*) AS n FROM analysis_parts",
      ).first<number>("n")) ?? 0,
  };
});
