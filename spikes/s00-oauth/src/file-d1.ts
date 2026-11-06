import {
  chunkValues,
  cleanupChunksSql,
  cleanupFilesSql,
  fileValues,
  insertChunkSql,
  insertFileSql,
  readChunksSql,
  readFileSql,
  removeChunksSql,
  removeFilesSql,
} from "./file-sql.js";
import {
  type FileRecord,
  type FileStore,
  fileLimits,
  type SealedChunk,
} from "./files.js";

export function d1FileStore(db: D1Database): FileStore {
  return {
    async put(record, chunks, now) {
      const statements = [
        db.prepare(cleanupChunksSql).bind(now),
        db.prepare(cleanupFilesSql).bind(now),
        db
          .prepare(insertFileSql)
          .bind(...fileValues(record), record.owner, now),
        ...chunks.map((c) =>
          db.prepare(insertChunkSql).bind(...chunkValues(record, c)),
        ),
      ];
      const results = await db.batch(statements);
      return results[2].meta.changes === 1;
    },
    async get(id, owner, company, now, maxBytes = fileLimits.bytes) {
      const record = await db
        .prepare(readFileSql)
        .bind(id, owner, company, now, maxBytes)
        .first<FileRecord>();
      if (!record) return null;
      const chunks = await db
        .prepare(readChunksSql)
        .bind(id, owner, company, now, maxBytes)
        .all<SealedChunk>();
      return { record, chunks: chunks.results };
    },
    async removeWorkflow(workflow, owner, company) {
      await db.batch([
        db.prepare(removeChunksSql).bind(workflow, owner, company),
        db.prepare(removeFilesSql).bind(workflow, owner, company),
      ]);
    },
    async cleanup(now) {
      await db.batch([
        db.prepare(cleanupChunksSql).bind(now),
        db.prepare(cleanupFilesSql).bind(now),
      ]);
    },
  };
}
