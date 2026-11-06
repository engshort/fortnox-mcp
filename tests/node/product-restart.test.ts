import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Connections, CredentialVault } from "@fortnox-mcp/core";
import { expect, it } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import {
  keyA,
  syntheticCompany,
  syntheticCredentials,
} from "../shared/connections.js";

it("retains encrypted connections and authorization across SQLite process handles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m02-restart-"));
  let db = new DatabaseSync(join(dir, "product.sqlite"));
  try {
    db.exec(
      readFileSync(
        new URL(
          "../../apps/worker/migrations/0002_product_state.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const service = new Connections(
      sqliteState(db),
      new CredentialVault({ a: keyA }, "a"),
    );
    const c = await service.add(
      "owner",
      syntheticCompany,
      syntheticCredentials,
    );
    await service.grant("owner", "client", [c.id]);
    db.close();
    db = new DatabaseSync(join(dir, "product.sqlite"));
    const restarted = new Connections(
      sqliteState(db),
      new CredentialVault({ a: keyA }, "a"),
    );
    expect(
      await restarted.credentials(
        "owner",
        await restarted.authorize("owner", "client", c.id),
      ),
    ).toEqual(syntheticCredentials);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
