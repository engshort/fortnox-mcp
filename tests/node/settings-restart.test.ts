import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CredentialVault, InstallationSettings } from "@fortnox-mcp/core";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { keyA } from "../shared/connections.js";

for (const kind of ["SQLite", "D1"] as const) {
  it(`retains app overrides and encrypted email keys after an actual ${kind} restart`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "settings-restart-"));
    const options = convertV4MiniflareOptions({
      name: "settings-restart",
      modules: true,
      script: "export default {fetch(){return new Response('synthetic');}};",
      compatibilityDate: "2026-10-18",
      d1Databases: { DB: "settings-restart" },
      resourcePersistencePath: directory,
    });
    let worker: Miniflare | undefined;
    let db: DatabaseSync | undefined;
    const open = async () => {
      if (kind === "SQLite") {
        db = new DatabaseSync(join(directory, "settings.sqlite"));
        return sqliteState(db);
      }
      worker = new Miniflare(options);
      return d1State(await worker.getD1Database("DB"));
    };
    const close = async () => {
      db?.close();
      db = undefined;
      await worker?.dispose();
      worker = undefined;
    };
    try {
      let state = await open();
      const sql = readFileSync(
        new URL(
          "../../apps/worker/migrations/0002_product_state.sql",
          import.meta.url,
        ),
        "utf8",
      );
      if (db) db.exec(sql);
      else
        await (await worker?.getD1Database("DB"))?.exec(
          sql.replace(/\n/g, " "),
        );
      let settings = new InstallationSettings(
        state,
        new CredentialVault({ a: keyA }, "a"),
      );
      await settings.save(
        "synthetic-owner",
        {
          expected_revision: null,
          changes: {
            restApi: true,
            emailApiKey: "re_synthetic_restart_secret",
          },
        },
        async () => {},
      );
      await close();
      state = await open();
      settings = new InstallationSettings(
        state,
        new CredentialVault({ a: keyA }, "a"),
      );
      const restored = await settings.snapshot("synthetic-owner");
      expect(restored.values.restApi).toBe(true);
      expect(restored.values.emailApiKey).toBe("re_synthetic_restart_secret");
      expect(restored.revision).toBe(1);
      expect(
        JSON.stringify(
          await state.get("installation-settings-v1", "synthetic-owner"),
        ),
      ).not.toContain("re_synthetic_restart_secret");
      await settings.save(
        "synthetic-owner",
        { expected_revision: restored.revision, changes: { restApi: false } },
        async () => {},
      );
      expect((await settings.snapshot("synthetic-owner")).values.restApi).toBe(
        false,
      );
    } finally {
      await close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
}
