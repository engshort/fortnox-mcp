import type { DatabaseSync } from "node:sqlite";
import { sqlAnalysisStore } from "../../shared/analysis-sql.js";
import { sqlReceiptFiles } from "../../shared/receipt-sql.js";
export function sqliteReceiptFiles(db: DatabaseSync) {
  return sqlReceiptFiles({
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

export function sqliteAnalysisStore(db: DatabaseSync) {
  return sqlAnalysisStore({
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
