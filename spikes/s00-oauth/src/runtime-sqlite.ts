import type { DatabaseSync } from "node:sqlite";
import { insertReviewSql, type ReviewStore, reviewValues } from "./review.js";
import { sqliteReviewStore } from "./review-sqlite.js";
import { runtimeCompany } from "./runtime-probe.js";

export function sqliteRuntimeReviews(db: DatabaseSync): ReviewStore {
  const base = sqliteReviewStore(db);
  return {
    async insert(record, now) {
      if (record.company !== runtimeCompany) return false;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "DELETE FROM s00_review WHERE company=? AND owner=? AND expires<=?",
        ).run(runtimeCompany, record.owner, now);
        const result = db
          .prepare(insertReviewSql)
          .run(...reviewValues(record), record.owner, now);
        db.exec("COMMIT");
        return result.changes === 1;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    consume: (record, now) =>
      record.company === runtimeCompany
        ? base.consume(record, now)
        : Promise.resolve(false),
    read: (reference) =>
      reference.company === runtimeCompany
        ? base.read(reference)
        : Promise.resolve(null),
  };
}
