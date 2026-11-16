import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteSyncJournal } from "../../apps/node/src/sync-storage.js";
import { companySyncContract } from "../shared/company-sync.js";

const opened: DatabaseSync[] = [];
afterEach(() => {
  for (const db of opened) db.close();
  opened.length = 0;
});
companySyncContract(async () => {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  for (const file of [
    "0002_product_state.sql",
    "0003_product_auth.sql",
    "0004_product_oauth.sql",
    "0010_company_sync.sql",
  ])
    db.exec(readFileSync(`apps/worker/migrations/${file}`, "utf8"));
  return {
    origin: "https://sync.example.invalid",
    secret: "synthetic-sync-secret-at-least-32-characters",
    database: db,
    state: sqliteState(db),
    journal: sqliteSyncJournal(db),
  };
});
