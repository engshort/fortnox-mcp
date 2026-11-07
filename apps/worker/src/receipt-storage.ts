import { sqlReceiptFiles } from "../../shared/receipt-sql.js";
export function d1ReceiptFiles(db: D1Database) {
  return sqlReceiptFiles({
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
