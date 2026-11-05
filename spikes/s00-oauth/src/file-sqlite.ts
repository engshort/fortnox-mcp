import type { DatabaseSync } from "node:sqlite";
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
import type { FileRecord, FileStore, SealedChunk } from "./files.js";

export function sqliteFileStore(db: DatabaseSync): FileStore {
  const transaction = (work: () => void) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return {
    async put(record, chunks, now) {
      let inserted = false;
      transaction(() => {
        db.prepare(cleanupChunksSql).run(now);
        db.prepare(cleanupFilesSql).run(now);
        inserted =
          db
            .prepare(insertFileSql)
            .run(...fileValues(record), record.owner, now).changes === 1;
        if (inserted)
          for (const chunk of chunks)
            db.prepare(insertChunkSql).run(...chunkValues(record, chunk));
      });
      return inserted;
    },
    async get(id, owner, company, now) {
      const record = db.prepare(readFileSql).get(id, owner, company, now) as
        | FileRecord
        | undefined;
      if (!record) return null;
      const chunks = db
        .prepare(readChunksSql)
        .all(id, owner, company, now) as unknown as SealedChunk[];
      return { record, chunks };
    },
    async removeWorkflow(workflow, owner, company) {
      transaction(() => {
        db.prepare(removeChunksSql).run(workflow, owner, company);
        db.prepare(removeFilesSql).run(workflow, owner, company);
      });
    },
    async cleanup(now) {
      transaction(() => {
        db.prepare(cleanupChunksSql).run(now);
        db.prepare(cleanupFilesSql).run(now);
      });
    },
  };
}
