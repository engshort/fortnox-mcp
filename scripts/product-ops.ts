import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { CredentialVault } from "@fortnox-mcp/core";
import { installationLock } from "../apps/node/src/installation-lock.js";
import { openProductDatabase } from "../apps/node/src/product-database.js";
import {
  backupDatabase,
  issueOwnerCode,
  reconcileRestore,
  restoreDatabase,
  rotateCredentials,
} from "../apps/node/src/product-operations.js";
import { sqliteState } from "../apps/node/src/product-storage.js";
import { sqliteReceiptFiles } from "../apps/node/src/receipt-storage.js";
import {
  nodeEnvironment,
  nodeRuntimeSettings,
} from "../apps/node/src/runtime-config.js";
import { cleanupProduct } from "../apps/shared/maintenance.js";
import { productSettings } from "../apps/shared/product.js";

let unlock: (() => Promise<void>) | undefined;
let db: DatabaseSync | undefined;
try {
  const env = await nodeEnvironment(process.env);
  if (env.MAINTENANCE_MODE !== "true") throw new Error("Maintenance required");
  const runtime = nodeRuntimeSettings(env),
    settings = productSettings(env);
  const vault = new CredentialVault(settings.keys, settings.activeKey);
  const [command, path] = process.argv.slice(2);
  if (
    ![
      "backup",
      "restore",
      "rotate-keys",
      "upgrade",
      "cleanup",
      "restore-status",
      "reconcile-restore",
      "bootstrap-code",
      "reset-owner",
    ].includes(command ?? "")
  )
    throw new Error("Unknown operator command");
  unlock = await installationLock(runtime.database);
  if (command === "restore") {
    if (!path || !env.BACKUP_KEY)
      throw new Error("Private backup input required");
    const result = await restoreDatabase({
      input: path,
      backupKey: env.BACKUP_KEY,
      database: runtime.database,
      migrations: runtime.migrations,
      vault,
    });
    console.log(JSON.stringify(result)); // Opaque interval identifiers only; no company or financial content.
  } else {
    if (command === "backup" || command === "upgrade") {
      if (!path || !env.BACKUP_KEY)
        throw new Error("Private backup output required");
      db = new DatabaseSync(runtime.database, { readOnly: true });
      await backupDatabase(db, env.BACKUP_KEY, path);
      db.close();
      db = undefined;
    }
    if (command !== "backup") {
      db = await openProductDatabase(runtime.database, runtime.migrations);
      if (command === "bootstrap-code" || command === "reset-owner") {
        if (!path) throw new Error("Private output file required");
        await issueOwnerCode(
          db,
          settings.origin,
          settings.secret,
          path,
          command === "reset-owner",
        );
      }
      if (command === "rotate-keys") await rotateCredentials(db, vault);
      if (command === "reconcile-restore") {
        if (!path) throw new Error("Private reconciliation record required");
        await reconcileRestore(db, JSON.parse(await readFile(path, "utf8")));
      }
      if (command === "cleanup") {
        await cleanupProduct(sqliteState(db));
        await sqliteReceiptFiles(db).cleanup(Date.now());
      }
      if (command === "restore-status")
        console.log(
          JSON.stringify(
            (await sqliteState(db).get("installation", "restore"))?.value ?? {
              reconciled: true,
            },
          ),
        );
    }
    console.log("Operator command completed; activation gates unchanged.");
  }
} catch {
  console.error(
    "Operator command failed. Stop the application, check private inputs and retain the original state/keys. No private values were emitted.",
  );
  process.exitCode = 1;
} finally {
  db?.close();
  await unlock?.();
}
