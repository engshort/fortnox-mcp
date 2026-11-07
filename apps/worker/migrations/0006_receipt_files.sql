-- Bounded temporary encrypted files, separate from connection snapshots.
CREATE TABLE IF NOT EXISTS receipt_files (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, client TEXT NOT NULL,
 company TEXT NOT NULL, workflow TEXT NOT NULL,
 generation INTEGER NOT NULL, policy INTEGER NOT NULL,
 mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 1048576),
 hash TEXT NOT NULL, expires INTEGER NOT NULL, chunks INTEGER NOT NULL CHECK(chunks BETWEEN 1 AND 32)
);
CREATE INDEX IF NOT EXISTS receipt_files_owner_expiry ON receipt_files(owner,expires);
CREATE TABLE IF NOT EXISTS receipt_chunks (
 file_id TEXT NOT NULL REFERENCES receipt_files(id) ON DELETE CASCADE,
 idx INTEGER NOT NULL, key TEXT NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(file_id,idx)
);
-- Advertise the optional scope; existing grants and client scopes stay unchanged.
UPDATE oauthResource
SET allowedScopes = json_insert(allowedScopes, '$[#]', 'mcp:files')
WHERE substr(identifier, -4) = '/mcp'
  AND json_valid(allowedScopes) AND json_type(allowedScopes) = 'array'
  AND json_array_length(allowedScopes) IN (2,3)
  AND (SELECT count(DISTINCT value) FROM json_each(allowedScopes)
       WHERE value IN ('mcp:read', 'offline_access')) = 2
  AND NOT EXISTS (SELECT 1 FROM json_each(allowedScopes) WHERE value NOT IN ('mcp:read','offline_access','mcp:write'));
