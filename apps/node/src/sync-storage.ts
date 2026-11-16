import type { DatabaseSync } from "node:sqlite";
import { sqlSyncJournal } from "../../shared/sync-sql.js";
export function sqliteSyncJournal(db: DatabaseSync) {
  return sqlSyncJournal({
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const changes = statements.map((s) =>
          Number(db.prepare(s.sql).run(...s.values).changes),
        );
        db.exec("COMMIT");
        return changes;
      } catch (cause) {
        db.exec("ROLLBACK");
        throw cause;
      }
    },
    async all(sql, values) {
      return db.prepare(sql).all(...values);
    },
  });
}
