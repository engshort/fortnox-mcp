import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { receiptFileSource, receiptSourceSettings } from "@fortnox-mcp/files";
import { nodeFileTransport } from "@fortnox-mcp/files/node";
import { createAdaptorServer } from "@hono/node-server";
import { cleanupProduct } from "../../shared/maintenance.js";
import {
  createProductApplication,
  productSettings,
} from "../../shared/product.js";
import { hashToken, type Owner } from "../../shared/product-auth.js";
import { openProductDatabase } from "./product-database.js";
import { sqliteState } from "./product-storage.js";
import { sqliteReceiptFiles } from "./receipt-storage.js";
import {
  nodeEnvironment,
  nodeRuntimeSettings,
  proxyRequest,
} from "./runtime-config.js";

const env = await nodeEnvironment(process.env);
if (env.PRODUCT_ENABLED !== "true")
  throw new Error("Product disabled; see .env.example");
const settings = productSettings(env);
const runtime = nodeRuntimeSettings(env);
const path = runtime.database;
const db = await openProductDatabase(path, runtime.migrations);
const state = sqliteState(db);
const receiptFiles = sqliteReceiptFiles(db);
await receiptFiles.cleanup(Date.now());
await cleanupProduct(state);
const cleanup = setInterval(() => {
  void Promise.all([
    cleanupProduct(state),
    receiptFiles.cleanup(Date.now()),
  ]).catch(() => console.error("product_cleanup_failed"));
}, 300000);
cleanup.unref();
if (!(await state.get("installation", "owner"))) {
  const code = crypto.randomUUID() + crypto.randomUUID();
  if (
    await state.put<Owner>(
      "installation",
      "owner",
      {
        phase: "ready",
        ownerId: "",
        tokenHash: await hashToken(code),
        expiresAt: Date.now() + 600000,
      },
      null,
    )
  )
    await writeFile(resolve(dirname(path), "bootstrap-code.txt"), code, {
      mode: 0o600,
      flag: "wx",
    });
}
const app = createProductApplication(settings, {
  database: db,
  state,
  receiptFiles,
  fileSource: receiptFileSource(
    settings.receiptSource ?? receiptSourceSettings({}, false),
    "node",
    nodeFileTransport,
  ),
});
let stopping = false;
const server = createAdaptorServer({
  fetch: async (request) => {
    if (stopping) return new Response("Unavailable", { status: 503 });
    try {
      return await app.fetch(
        proxyRequest(request, settings.origin, runtime.proxy),
      );
    } catch {
      return new Response("Request unavailable", { status: 403 });
    }
  },
  overrideGlobalObjects: false,
});
server.listen(runtime.port, runtime.host, () =>
  console.log(
    "product_server_started; bootstrap code is in the private database directory",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(cleanup);
    const deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
    server.close(() => {
      db.close();
      clearTimeout(deadline);
      process.exit(0);
    });
    if ("closeIdleConnections" in server) server.closeIdleConnections();
  });
