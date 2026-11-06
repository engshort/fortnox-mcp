import { type FileRecord, fileLimits, type SealedChunk } from "./files.js";

export const fileSchema = `CREATE TABLE IF NOT EXISTS s00_files (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, company TEXT NOT NULL,
 workflow TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
 hash TEXT NOT NULL, expires INTEGER NOT NULL, chunks INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS s00_files_expiry ON s00_files(expires);
CREATE TABLE IF NOT EXISTS s00_file_chunks (
 file_id TEXT NOT NULL REFERENCES s00_files(id) ON DELETE CASCADE,
 idx INTEGER NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(file_id, idx)
)`;
export const insertFileSql = `INSERT INTO s00_files (id,owner,company,workflow,mime,bytes,hash,expires,chunks)
 SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM s00_files WHERE owner=? AND expires>?) < ${fileLimits.activeFiles}`;
export const fileValues = (r: FileRecord) =>
  [
    r.id,
    r.owner,
    r.company,
    r.workflow,
    r.mime,
    r.bytes,
    r.hash,
    r.expires,
    r.chunks,
  ] as const;
export const insertChunkSql = `INSERT INTO s00_file_chunks (file_id,idx,iv,data)
 SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM s00_files WHERE id=? AND owner=? AND company=? AND workflow=?)`;
export const chunkValues = (r: FileRecord, c: SealedChunk) =>
  [r.id, c.index, c.iv, c.data, r.id, r.owner, r.company, r.workflow] as const;
export const readFileSql =
  "SELECT * FROM s00_files WHERE id=? AND owner=? AND company=? AND expires>?";
export const readChunksSql = `SELECT idx AS 'index',iv,data FROM s00_file_chunks WHERE file_id IN
 (SELECT id FROM s00_files WHERE id=? AND owner=? AND company=? AND expires>?) ORDER BY idx`;
// Explicit chunk deletion does not depend on connection-local foreign-key PRAGMA.
export const cleanupChunksSql =
  "DELETE FROM s00_file_chunks WHERE file_id IN (SELECT id FROM s00_files WHERE expires<=?)";
export const cleanupFilesSql = "DELETE FROM s00_files WHERE expires<=?";
export const removeChunksSql =
  "DELETE FROM s00_file_chunks WHERE file_id IN (SELECT id FROM s00_files WHERE workflow=? AND owner=? AND company=?)";
export const removeFilesSql =
  "DELETE FROM s00_files WHERE workflow=? AND owner=? AND company=?";
