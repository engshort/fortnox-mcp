import { env } from "cloudflare:workers";
import stateSchema from "../../apps/worker/migrations/0002_product_state.sql?raw";
import oauthSchema from "../../apps/worker/migrations/0004_product_oauth.sql?raw";
import receiptSchema from "../../apps/worker/migrations/0006_receipt_files.sql?raw";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { d1ReceiptFiles } from "../../apps/worker/src/receipt-storage.js";
import { receiptBatchesContract } from "../shared/receipt-batches.js";
import { receiptFilesContract } from "../shared/receipt-files.js";

async function receiptFixture() {
  const execute = async (schema: string) =>
    env.DB.exec(schema.replace(/--[^\n]*(?:\n|$)/g, "").replace(/\n/g, " "));
  await execute(stateSchema);
  if (
    !(await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name='oauthClient'",
    ).first())
  )
    await execute(oauthSchema);
  await execute(receiptSchema);
  for (const name of ["receipt_chunks", "receipt_files", "product_state"])
    await env.DB.prepare(`DELETE FROM ${name}`).run();
  return {
    state: d1State(env.DB),
    files: d1ReceiptFiles(env.DB),
    raw: async () =>
      JSON.stringify({
        files: (await env.DB.prepare("SELECT * FROM receipt_files").all())
          .results,
        chunks: (await env.DB.prepare("SELECT * FROM receipt_chunks").all())
          .results,
      }),
  };
}
receiptFilesContract(receiptFixture);
receiptBatchesContract(receiptFixture);
