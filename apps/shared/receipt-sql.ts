import {
  type ReceiptChunk,
  type ReceiptFileRecord,
  type ReceiptFileStore,
  receiptFileLimits,
} from "@fortnox-mcp/core";
export interface ReceiptStatement {
  sql: string;
  values: readonly (string | number)[];
}
export interface ReceiptSql {
  // All statements commit or roll back together, in order.
  batch(statements: ReceiptStatement[]): Promise<number[]>;
  all(
    sql: string,
    values: readonly (string | number)[],
  ): Promise<Record<string, unknown>[]>;
}
const deleteExpired = (now: number): ReceiptStatement[] => [
  {
    sql: "DELETE FROM receipt_chunks WHERE file_id IN (SELECT id FROM receipt_files WHERE expires<=?)",
    values: [now],
  },
  { sql: "DELETE FROM receipt_files WHERE expires<=?", values: [now] },
];
export function sqlReceiptFiles(db: ReceiptSql): ReceiptFileStore {
  return {
    async put(r, chunks, now) {
      if (chunks.length !== r.chunks) throw new Error("Invalid encrypted file");
      const statements: ReceiptStatement[] = [
        ...deleteExpired(now),
        {
          sql: `INSERT INTO receipt_files(id,owner,client,company,workflow,generation,policy,mime,bytes,hash,expires,chunks)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM receipt_files WHERE owner=? AND expires>?) < ${receiptFileLimits.activeFiles}`,
          values: [
            r.id,
            r.owner,
            r.client,
            r.company,
            r.workflow,
            r.generation,
            r.policy,
            r.mime,
            r.bytes,
            r.hash,
            r.expires,
            r.chunks,
            r.owner,
            now,
          ],
        },
        ...chunks.map((c) => ({
          sql: `INSERT INTO receipt_chunks(file_id,idx,key,iv,data)
          SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM receipt_files WHERE id=? AND owner=? AND company=? AND workflow=?)`,
          values: [
            r.id,
            c.index,
            c.key,
            c.iv,
            c.data,
            r.id,
            r.owner,
            r.company,
            r.workflow,
          ],
        })),
      ];
      const changes = await db.batch(statements);
      return changes[2] === 1;
    },
    async get(id, owner, company) {
      const r = (
        await db.all(
          "SELECT * FROM receipt_files WHERE id=? AND owner=? AND company=?",
          [id, owner, company],
        )
      )[0];
      if (!r) return null;
      const record: ReceiptFileRecord = {
        id: String(r.id),
        owner: String(r.owner),
        client: String(r.client),
        company: String(r.company),
        workflow: String(r.workflow),
        generation: Number(r.generation),
        policy: Number(r.policy),
        mime: String(r.mime),
        bytes: Number(r.bytes),
        hash: String(r.hash),
        expires: Number(r.expires),
        chunks: Number(r.chunks),
      };
      const chunks: ReceiptChunk[] = (
        await db.all(
          "SELECT idx,key,iv,data FROM receipt_chunks WHERE file_id=? ORDER BY idx",
          [id],
        )
      ).map((c) => ({
        index: Number(c.idx),
        key: String(c.key),
        iv: String(c.iv),
        data: String(c.data),
      }));
      return { record, chunks };
    },
    async removeWorkflow(workflow, owner, company) {
      await db.batch([
        {
          sql: "DELETE FROM receipt_chunks WHERE file_id IN (SELECT id FROM receipt_files WHERE workflow=? AND owner=? AND company=?)",
          values: [workflow, owner, company],
        },
        {
          sql: "DELETE FROM receipt_files WHERE workflow=? AND owner=? AND company=?",
          values: [workflow, owner, company],
        },
      ]);
    },
    async cleanup(now) {
      await db.batch(deleteExpired(now));
    },
  };
}
