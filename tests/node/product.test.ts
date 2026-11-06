import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { connectionContract } from "../shared/connections.js";
import { ownerContract } from "../shared/product-auth.js";

const opened: DatabaseSync[] = [];
afterEach(() => {
  for (const db of opened) db.close();
  opened.length = 0;
});
async function fixture() {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  for (const file of ["0002_product_state.sql", "0003_product_auth.sql"])
    db.exec(
      readFileSync(
        new URL(`../../apps/worker/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  return {
    origin: "https://product.example.invalid",
    secret: "synthetic-auth-secret-at-least-32-characters",
    database: db,
    state: sqliteState(db),
  };
}
ownerContract(fixture);
connectionContract(async () => (await fixture()).state);
