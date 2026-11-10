import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { accountingContract } from "../shared/accounting.js";
import { accountingMigrationContract } from "../shared/accounting-migration.js";
import { accountingSelectionContract } from "../shared/accounting-selection.js";
import { accountingTransportContract } from "../shared/accounting-transport.js";
import { businessWritesContract } from "../shared/business-writes.js";
import { connectionContract } from "../shared/connections.js";
import { consentHttpContract } from "../shared/consent-http.js";
import { diagnosticsContract } from "../shared/diagnostics.js";
import { disconnectContract } from "../shared/disconnect.js";
import { documentRowsContract } from "../shared/document-rows.js";
import { fortnoxConnectionContract } from "../shared/fortnox-connections.js";
import { maintenanceContract } from "../shared/maintenance.js";
import { ownerSetupContract } from "../shared/owner-setup.js";
import { ownerContract } from "../shared/product-auth.js";
import { oauthContract } from "../shared/product-oauth.js";
import { providerContract } from "../shared/provider.js";
import { registersContract } from "../shared/registers.js";
import { salesDocumentsContract } from "../shared/sales-documents.js";
import { userTokenContract } from "../shared/user-tokens.js";

const opened: DatabaseSync[] = [];
documentRowsContract();
afterEach(() => {
  for (const db of opened) db.close();
  opened.length = 0;
});
async function fixture() {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  for (const file of [
    "0002_product_state.sql",
    "0003_product_auth.sql",
    "0004_product_oauth.sql",
  ])
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
diagnosticsContract(async () => (await fixture()).state);
ownerSetupContract(fixture);
connectionContract(async () => (await fixture()).state);

oauthContract(fixture);
consentHttpContract(fixture);

providerContract(async () => (await fixture()).state);

fortnoxConnectionContract(async () => (await fixture()).state);

userTokenContract(async () => (await fixture()).state);

disconnectContract(async () => (await fixture()).state);

maintenanceContract(async () => (await fixture()).state);
accountingContract(async () => (await fixture()).state);
accountingTransportContract(async () => (await fixture()).state);
accountingSelectionContract(async () => (await fixture()).state);
accountingMigrationContract(async () => {
  const { database } = await fixture();
  return {
    execute: async (sql) => database.exec(sql),
    all: async (sql) => database.prepare(sql).all(),
    migrate: async () =>
      database.exec(
        readFileSync(
          new URL(
            "../../apps/worker/migrations/0005_accounting_scope.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
  };
});

businessWritesContract(async () => (await fixture()).state);
registersContract(async () => (await fixture()).state);
salesDocumentsContract(async () => (await fixture()).state);
