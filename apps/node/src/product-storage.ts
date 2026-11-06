import type { DatabaseSync } from "node:sqlite";
import { SqlStateStore } from "../../shared/state.js";
export function sqliteState(db: DatabaseSync) {
  return new SqlStateStore({
    async run(sql, values) {
      return Number(db.prepare(sql).run(...values).changes);
    },
    async all(sql, values) {
      return db.prepare(sql).all(...values);
    },
  });
}
