import {
  AnalysisContextError,
  type AnalysisRecord,
  type AnalysisStore,
  analysisLimits,
  type Ciphertext,
} from "@fortnox-mcp/core";
import type { ReceiptSql, ReceiptStatement } from "./receipt-sql.js";

const partBudget = analysisLimits.contextBytes - 65536; // reserve space for the encrypted manifest
const expired = (now: number): ReceiptStatement[] => [
  {
    sql: "DELETE FROM analysis_parts WHERE context_id IN (SELECT id FROM analysis_contexts WHERE expires<=?)",
    values: [now],
  },
  { sql: "DELETE FROM analysis_contexts WHERE expires<=?", values: [now] },
];
function record(
  row: Record<string, unknown> | undefined,
): AnalysisRecord | null {
  return row
    ? {
        id: String(row.id),
        namespace: String(row.namespace),
        owner: String(row.owner),
        company: String(row.company),
        expires: Number(row.expires),
        ready: row.ready === 1,
        manifest: JSON.parse(String(row.manifest)) as Ciphertext,
      }
    : null;
}
export function sqlAnalysisStore(db: ReceiptSql): AnalysisStore {
  return {
    async reserve(r, now) {
      const changes = await db.batch([
        ...expired(now),
        {
          sql: `INSERT INTO analysis_contexts(id,namespace,owner,company,expires,ready,manifest)
          SELECT ?,?,?,?,?,0,? WHERE
          (SELECT count(*) FROM analysis_contexts WHERE owner=?) < ${analysisLimits.ownerBytes / analysisLimits.contextBytes}
          AND (SELECT count(*) FROM analysis_contexts) < ${analysisLimits.installationBytes / analysisLimits.contextBytes}
          ON CONFLICT DO NOTHING`,
          values: [
            r.id,
            r.namespace,
            r.owner,
            r.company,
            r.expires,
            JSON.stringify(r.manifest),
            r.owner,
          ],
        },
      ]);
      return changes[2] === 1;
    },
    async find(namespace) {
      return record(
        (
          await db.all("SELECT * FROM analysis_contexts WHERE namespace=?", [
            namespace,
          ])
        )[0],
      );
    },
    async get(id) {
      return record(
        (await db.all("SELECT * FROM analysis_contexts WHERE id=?", [id]))[0],
      );
    },
    async claim(id, now) {
      const lease = crypto.randomUUID();
      const [changed] = await db.batch([
        {
          sql: "UPDATE analysis_contexts SET lease=?,busy_until=? WHERE id=? AND ready=0 AND expires>? AND busy_until<=?",
          values: [lease, now + analysisLimits.leaseMs, id, now, now],
        },
      ]);
      return changed === 1 ? lease : null;
    },
    async write(id, lease, name, chunks, now) {
      const live =
        "EXISTS(SELECT 1 FROM analysis_contexts WHERE id=? AND lease=? AND busy_until>? AND expires>?)";
      await db.batch([
        {
          sql: `DELETE FROM analysis_parts WHERE context_id=? AND name=? AND ${live}`,
          values: [id, name, id, lease, now, now],
        },
      ]);
      const used = Number(
        (
          await db.all(
            "SELECT COALESCE(sum(bytes),0) AS n FROM analysis_parts WHERE context_id=?",
            [id],
          )
        )[0]?.n ?? 0,
      );
      const incoming = chunks.reduce(
        (n, c) => n + new TextEncoder().encode(JSON.stringify(c)).length,
        0,
      );
      if (used + incoming > partBudget)
        throw new AnalysisContextError(
          "analysis_storage_limit_67108864_use_direct_reads_or_fewer_years",
        );
      for (let offset = 0; offset < chunks.length; offset += 16) {
        const changes = await db.batch(
          chunks.slice(offset, offset + 16).map((chunk, i) => {
            const text = JSON.stringify(chunk),
              bytes = new TextEncoder().encode(text).length;
            return {
              sql: `INSERT INTO analysis_parts(context_id,name,ordinal,ciphertext,bytes)
              SELECT ?,?,?,?,? WHERE ${live} AND
              (SELECT COALESCE(sum(bytes),0) FROM analysis_parts WHERE context_id=?) + ? <= ${partBudget}`,
              values: [
                id,
                name,
                offset + i,
                text,
                bytes,
                id,
                lease,
                now,
                now,
                id,
                bytes,
              ],
            };
          }),
        );
        if (changes.some((n) => n !== 1)) return false;
      }
      return true;
    },
    async read(id, name) {
      return (
        await db.all(
          "SELECT ciphertext FROM analysis_parts WHERE context_id=? AND name=? ORDER BY ordinal",
          [id, name],
        )
      ).map((r) => JSON.parse(String(r.ciphertext)) as Ciphertext);
    },
    async finish(id, lease, manifest, expires, ready, now) {
      const [changed] = await db.batch([
        {
          sql: "UPDATE analysis_contexts SET manifest=?,expires=?,ready=?,lease='',busy_until=0 WHERE id=? AND lease=? AND busy_until>? AND expires>?",
          values: [
            JSON.stringify(manifest),
            expires,
            ready ? 1 : 0,
            id,
            lease,
            now,
            now,
          ],
        },
      ]);
      return changed === 1;
    },
    async remove(id, lease) {
      const condition = lease === undefined ? "id=?" : "id=? AND lease=?";
      const values = lease === undefined ? [id] : [id, lease];
      await db.batch([
        {
          sql: `DELETE FROM analysis_parts WHERE context_id IN (SELECT id FROM analysis_contexts WHERE ${condition})`,
          values,
        },
        { sql: `DELETE FROM analysis_contexts WHERE ${condition}`, values },
      ]);
    },
    async cleanup(now) {
      await db.batch(expired(now));
    },
    async clear() {
      await db.batch([
        { sql: "DELETE FROM analysis_parts", values: [] },
        { sql: "DELETE FROM analysis_contexts", values: [] },
      ]);
    },
  };
}
