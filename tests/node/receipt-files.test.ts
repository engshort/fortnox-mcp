import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteReceiptFiles } from "../../apps/node/src/receipt-storage.js";
import { receiptBatchesContract } from "../shared/receipt-batches.js";
import { receiptFilesContract } from "../shared/receipt-files.js";
import { receiptProviderContract } from "../shared/receipt-provider.js";

const opened: DatabaseSync[] = [];
afterEach(() => {
  for (const db of opened) db.close();
  opened.length = 0;
});
async function receiptFixture() {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  for (const name of [
    "0002_product_state.sql",
    "0003_product_auth.sql",
    "0004_product_oauth.sql",
    "0006_receipt_files.sql",
  ])
    db.exec(
      readFileSync(
        new URL(`../../apps/worker/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  return {
    state: sqliteState(db),
    files: sqliteReceiptFiles(db),
    raw: async () =>
      JSON.stringify({
        files: db.prepare("SELECT * FROM receipt_files").all(),
        chunks: db.prepare("SELECT * FROM receipt_chunks").all(),
      }),
  };
}
receiptFilesContract(receiptFixture);
receiptBatchesContract(receiptFixture);

receiptProviderContract(receiptFixture);
