import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it, vi } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
import { createProductApplication } from "../../apps/shared/product.js";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { onboardingFixture } from "../shared/onboarding.js";

for (const kind of ["SQLite", "D1"] as const) {
  it(`rotates persisted offline tokens after ${kind} close/reopen and a 73-hour stop without an owner session`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-restart-"));
    const options = convertV4MiniflareOptions({
      name: "offline-restart",
      modules: true,
      script: "export default {fetch(){return new Response('synthetic');}};",
      compatibilityDate: "2026-10-18",
      d1Databases: { DB: "offline-restart" },
      resourcePersistencePath: dir,
    });
    let worker: Miniflare | undefined;
    let sqlite: DatabaseSync | undefined;
    const open = async () => {
      if (kind === "SQLite") {
        sqlite = new DatabaseSync(join(dir, "product.sqlite"));
        return { database: sqlite, state: sqliteState(sqlite) };
      }
      worker = new Miniflare(options);
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
      const config = {
        ...storage,
        origin: "https://product.example.invalid",
        secret: "synthetic-offline-restart-secret-at-least-32-characters",
      };
      const f = await onboardingFixture(config, true);
      const attempt = await f.start();
      await f.provider(attempt);
      const approval = await f.approve(attempt);
      const pair = (await (await f.exchange(approval.target)).json()) as {
        access_token: string;
        refresh_token: string;
      };
      const company = (await f.app.connections.list(f.owner))[0];
      if (!company) throw new Error("Synthetic company missing");
      await f.app.auth.api.signOut({
        headers: new Headers({ cookie: f.cookie }),
      });
      await close();
      storage = await open();
      const app = createProductApplication(f.settings, storage, async () => {
        throw new Error("No provider replay after restart");
      });
      const before = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(before + 73 * 3600_000);
      await cleanupProduct(storage.state);
      const response = await app.fetch(
        new Request(`${config.origin}/auth/oauth2/token`, {
          method: "POST",
          headers: {
            authorization: f.client.authorization,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: pair.refresh_token,
            resource: `${config.origin}/mcp`,
          }),
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const rotated = (await response.json()) as {
        access_token: string;
        refresh_token: string;
      };
      expect(rotated.refresh_token).not.toBe(pair.refresh_token);
      const identity = await app.auth.api.verifyProductToken({
        body: { token: rotated.access_token },
      });
      expect(
        (
          await app.connections.authorize(
            f.owner,
            identity.clientId,
            company.id,
          )
        ).id,
      ).toBe(company.id);
      expect(
        (await app.connections.snapshot(f.owner))?.value.onboarding,
      ).toEqual([]);
      const grant = await storage.state.get(
        "company-grants",
        f.client.client_id,
      );
      expect(grant).toBeTruthy();
    } finally {
      vi.useRealTimers();
      await close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000); // Includes two actual workerd startups under the full regression workload.
}
