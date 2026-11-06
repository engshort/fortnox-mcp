import {
  d1ReviewStore,
  insertReviewSql,
  type ReviewStore,
  reviewValues,
} from "./review.js";
import { runtimeCompany } from "./runtime-probe.js";

export function d1RuntimeReviews(db: D1Database): ReviewStore {
  const base = d1ReviewStore(db);
  return {
    async insert(record, now) {
      if (record.company !== runtimeCompany) return false;
      const result = await db.batch([
        db
          .prepare(
            "DELETE FROM s00_review WHERE company=? AND owner=? AND expires<=?",
          )
          .bind(runtimeCompany, record.owner, now),
        db
          .prepare(insertReviewSql)
          .bind(...reviewValues(record), record.owner, now),
      ]);
      return result[1].meta.changes === 1;
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
