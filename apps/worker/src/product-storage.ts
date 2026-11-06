import { SqlStateStore } from "../../shared/state.js";
export function d1State(db: D1Database) {
  return new SqlStateStore({
    async run(sql, values) {
      return (
        await db
          .prepare(sql)
          .bind(...values)
          .run()
      ).meta.changes;
    },
    async all(sql, values) {
      return (
        await db
          .prepare(sql)
          .bind(...values)
          .all<Record<string, unknown>>()
      ).results;
    },
  });
}
