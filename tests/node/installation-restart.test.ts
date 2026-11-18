import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it, vi } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { createProductApplication } from "../../apps/shared/product.js";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { installationAccessFixture } from "../shared/installation-access.js";

for (const kind of ["SQLite", "D1"] as const) {
  it(`acquires installation access after ${kind} storage close/reopen and 31 idle days`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "installation-restart-"));
    let sqlite: DatabaseSync | undefined;
    let worker: Miniflare | undefined;
    const open = async () => {
      if (kind === "SQLite") {
        sqlite = new DatabaseSync(join(dir, "product.sqlite"));
        return { database: sqlite, state: sqliteState(sqlite) };
      }
      worker = new Miniflare(
        convertV4MiniflareOptions({
          name: "installation-restart",
          modules: true,
          script:
            "export default {fetch(){return new Response('synthetic');}};",
          compatibilityDate: "2026-10-18",
          d1Databases: { DB: "installation-restart" },
          resourcePersistencePath: dir,
        }),
      );
      const db = await worker.getD1Database("DB");
      return { database: db, state: d1State(db) };
    };
    const close = async () => {
      sqlite?.close();
      sqlite = undefined;
      await worker?.dispose();
      worker = undefined;
    };
    try {
      let storage = await open();
      for (const file of [
        "0002_product_state.sql",
        "0003_product_auth.sql",
        "0004_product_oauth.sql",
      ]) {
        const sql = readFileSync(
          new URL(`../../apps/worker/migrations/${file}`, import.meta.url),
          "utf8",
        );
        if (sqlite) sqlite.exec(sql);
        else
          await (await worker?.getD1Database("DB"))?.exec(
            sql.replace(/\n/g, " "),
          );
      }
      const f = await installationAccessFixture({
        ...storage,
        origin: "https://product.example.invalid",
        secret: "synthetic-installation-restart-secret-at-least-32-characters",
      });
      const client = await f.create();
      expect((await f.token(client)).status).toBe(200);
      await f.app.auth.api.signOut({
        headers: new Headers({ cookie: f.cookie }),
      });
      await close();
      storage = await open();
      const restarted = createProductApplication(
        f.settings,
        storage,
        f.fetcher,
      );
      const future = Date.now() + 31 * 86400_000,
        wall = performance.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(future);
      vi.spyOn(Date, "now").mockImplementation(() =>
        Math.floor(future + performance.now() - wall),
      );
      const issued = await f.token(client, {}, restarted);
      expect(issued.status, await issued.clone().text()).toBe(200);
      const token = (await issued.json()) as {
        access_token: string;
        refresh_token?: string;
      };
      expect(token.refresh_token).toBeUndefined();
      const read = await f.request(
        `/api/v1/companies/${f.a.id}/financial-years/1/accounts`,
        undefined,
        { authorization: `Bearer ${token.access_token}` },
        restarted,
      );
      expect(read.status, await read.clone().text()).toBe(200);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
      await close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
}
