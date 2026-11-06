import type { StateRecord, StateStore } from "@fortnox-mcp/core";

export type { StateRecord, StateStore } from "@fortnox-mcp/core";
export interface StateSql {
  run(sql: string, values: readonly (string | number)[]): Promise<number>;
  all(
    sql: string,
    values: readonly (string | number)[],
  ): Promise<Record<string, unknown>[]>;
}
// Every modification is one durable compare-and-set, shared by SQLite and D1.
export class SqlStateStore implements StateStore {
  constructor(private readonly sql: StateSql) {}
  async get<T>(space: string, id: string): Promise<StateRecord<T> | null> {
    const row = (
      await this.sql.all(
        "SELECT version, value FROM product_state WHERE space = ? AND id = ?",
        [space, id],
      )
    )[0];
    return row
      ? {
          version: Number(row.version),
          value: JSON.parse(String(row.value)) as T,
        }
      : null;
  }
  async put<T>(
    space: string,
    id: string,
    value: T,
    expected: number | null,
  ): Promise<boolean> {
    const json = JSON.stringify(value);
    if (json.length > 131072) throw new Error("Operational record too large");
    return (
      (expected === null
        ? await this.sql.run(
            "INSERT INTO product_state(space,id,version,value) VALUES(?,?,1,?) ON CONFLICT DO NOTHING",
            [space, id, json],
          )
        : await this.sql.run(
            "UPDATE product_state SET value = ?, version = version + 1 WHERE space = ? AND id = ? AND version = ?",
            [json, space, id, expected],
          )) === 1
    );
  }
  async list<T>(space: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101)
      throw new Error("Invalid state limit");
    return (
      await this.sql.all(
        "SELECT id,version,value FROM product_state WHERE space = ? ORDER BY id LIMIT ?",
        [space, limit],
      )
    ).map((r) => ({
      id: String(r.id),
      version: Number(r.version),
      value: JSON.parse(String(r.value)) as T,
    }));
  }
}
