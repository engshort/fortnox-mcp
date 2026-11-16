import { sqlSyncJournal } from "../../shared/sync-sql.js";
export function d1SyncJournal(db: D1Database) {
  return sqlSyncJournal({
    async batch(statements) {
      return (
        await db.batch(
          statements.map((s) => db.prepare(s.sql).bind(...s.values)),
        )
      ).map((r) => r.meta.changes);
    },
    async all(sql, values) {
      return (
        await db
          .prepare(sql)
          .bind(...values)
          .all()
      ).results;
    },
  });
}
