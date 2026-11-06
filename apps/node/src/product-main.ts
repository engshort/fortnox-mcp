import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAdaptorServer } from "@hono/node-server";
import { cleanupProduct } from "../../shared/maintenance.js";
import {
  createProductApplication,
  productSettings,
} from "../../shared/product.js";
import { hashToken, type Owner } from "../../shared/product-auth.js";
import { sqliteState } from "./product-storage.js";

if (process.env.PRODUCT_ENABLED !== "true")
  throw new Error("Product disabled; see .env.example");
const settings = productSettings(process.env);
const path = resolve(process.env.PRODUCT_DATABASE ?? ".data/product.sqlite");
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path);
await chmod(path, 0o600);
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
db.exec("CREATE TABLE IF NOT EXISTS product_migrations (id TEXT PRIMARY KEY)");
// Migrations are distributed with source; the built entry uses PRODUCT_MIGRATIONS_DIR.
const directory = resolve(
  process.env.PRODUCT_MIGRATIONS_DIR ?? "apps/worker/migrations",
);
for (const file of (await readdir(directory))
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort()) {
  if (db.prepare("SELECT id FROM product_migrations WHERE id = ?").get(file))
    continue;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(await readFile(resolve(directory, file), "utf8"));
    db.prepare("INSERT INTO product_migrations(id) VALUES(?)").run(file);
    db.exec("COMMIT");
  } catch {
    db.exec("ROLLBACK");
    throw new Error("Product migration failed");
  }
}
const state = sqliteState(db);
await cleanupProduct(state);
const cleanup = setInterval(() => {
  void cleanupProduct(state).catch(() =>
    console.error("product_cleanup_failed"),
  );
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
const app = createProductApplication(settings, { database: db, state });
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");
const server = createAdaptorServer({
  fetch: app.fetch,
  overrideGlobalObjects: false,
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    "product_server_started; bootstrap code is in the private database directory",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    clearInterval(cleanup);
    server.close(() => db.close());
  });
