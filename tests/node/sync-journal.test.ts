import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SyncEvent } from "@fortnox-mcp/core";
import { expect, it } from "vitest";
import { sqliteSyncJournal } from "../../apps/node/src/sync-storage.js";

it("rolls back both event and offset on a database failure, and survives reopening SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fortnox-sync-journal-"));
  const path = join(directory, "journal.sqlite");
  let db = new DatabaseSync(path);
  const event: SyncEvent = {
    event_id: "synthetic-event",
    company_id: "synthetic-company",
    resource: "customers",
    action: "upsert",
    identity: { CustomerNumber: "1" },
    occurred_at: new Date().toISOString(),
  };
  try {
    db.exec(
      readFileSync("apps/worker/migrations/0010_company_sync.sql", "utf8"),
    );
    let journal = sqliteSyncJournal(db);
    db.exec(
      "CREATE TRIGGER synthetic_offset_failure BEFORE INSERT ON sync_offsets BEGIN SELECT RAISE(ABORT,'Synthetic database failure'); END;",
    );
    await expect(
      journal.append(
        "owner",
        event.company_id,
        1,
        "integration",
        "customers",
        "opaque-1",
        [event],
        Date.now(),
      ),
    ).rejects.toThrow("Synthetic database failure");
    expect(
      (await journal.read("owner", event.company_id, 1, 0, 100, Date.now()))
        .tail,
    ).toBe(0);
    expect(await journal.offsets("integration")).toEqual([]);
    db.exec("DROP TRIGGER synthetic_offset_failure");
    await journal.append(
      "owner",
      event.company_id,
      1,
      "integration",
      "customers",
      "opaque-1",
      [event],
      Date.now(),
    );
    db.close();
    db = new DatabaseSync(path);
    journal = sqliteSyncJournal(db);
    expect(
      (await journal.read("owner", event.company_id, 1, 0, 100, Date.now()))
        .events[0]?.event,
    ).toEqual(event);
    expect((await journal.offsets("integration"))[0]?.offset).toBe("opaque-1");
    await journal.read("owner", event.company_id, 2, 0, 100, Date.now());
    await journal.append(
      "owner",
      event.company_id,
      1,
      "integration",
      "customers",
      "stale",
      [{ ...event, event_id: "stale" }],
      Date.now(),
    );
    expect((await journal.offsets("integration"))[0]?.offset).toBe("opaque-1");
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it("enforces the installation cap with explicit floors for affected companies", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync("apps/worker/migrations/0010_company_sync.sql", "utf8"),
    );
    const head = db.prepare(
      "INSERT INTO sync_heads(owner,company,generation,epoch,tail) VALUES('owner',?,1,'epoch',1000)",
    );
    const row = db.prepare(
      "INSERT INTO sync_events(owner,company,sequence,event_id,received,event) VALUES('owner',?,?,?,?, '{}')",
    );
    db.exec("BEGIN");
    for (let company = 0; company < 21; company++) {
      head.run(String(company));
      for (let seq = 1; seq <= 1000; seq++)
        row.run(String(company), seq, String(seq), Date.now());
    }
    db.exec("COMMIT");
    await sqliteSyncJournal(db).cleanup(Date.now());
    expect(db.prepare("SELECT count(*) AS n FROM sync_events").get()?.n).toBe(
      20000,
    );
    expect(
      db.prepare("SELECT floor FROM sync_heads WHERE company='0'").get()?.floor,
    ).toBe(1000);
  } finally {
    db.close();
  }
});
