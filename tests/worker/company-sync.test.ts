import { env } from "cloudflare:workers";
import state from "../../apps/worker/migrations/0002_product_state.sql?raw";
import auth from "../../apps/worker/migrations/0003_product_auth.sql?raw";
import oauth from "../../apps/worker/migrations/0004_product_oauth.sql?raw";
import sync from "../../apps/worker/migrations/0010_company_sync.sql?raw";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { d1SyncJournal } from "../../apps/worker/src/sync-storage.js";
import { companySyncContract } from "../shared/company-sync.js";

companySyncContract(async () => {
  await env.DB.exec(state.replace(/\n/g, " "));
  for (const [table, schema] of [
    ["user", auth],
    ["oauthClient", oauth],
    ["sync_heads", sync],
  ]) {
    if (
      !(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name=?")
        .bind(table)
        .first())
    )
      await env.DB.exec(String(schema).replace(/\n/g, " "));
  }
  for (const table of [
    "product_state",
    "sync_events",
    "sync_offsets",
    "sync_heads",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  return {
    origin: "https://sync.example.invalid",
    secret: "synthetic-sync-secret-at-least-32-characters",
    database: env.DB,
    state: d1State(env.DB),
    journal: d1SyncJournal(env.DB),
  };
});
