-- Short-lived encrypted analysis inputs. Never restore these as usable contexts.
CREATE TABLE IF NOT EXISTS analysis_contexts (
 id TEXT PRIMARY KEY, namespace TEXT NOT NULL UNIQUE,
 owner TEXT NOT NULL, company TEXT NOT NULL, expires INTEGER NOT NULL,
 ready INTEGER NOT NULL DEFAULT 0, lease TEXT NOT NULL DEFAULT '', busy_until INTEGER NOT NULL DEFAULT 0,
 manifest TEXT NOT NULL CHECK(length(manifest) <= 65536)
);
CREATE INDEX IF NOT EXISTS analysis_expiry ON analysis_contexts(expires);
CREATE TABLE IF NOT EXISTS analysis_parts (
 context_id TEXT NOT NULL REFERENCES analysis_contexts(id) ON DELETE CASCADE,
 name TEXT NOT NULL, ordinal INTEGER NOT NULL,
 ciphertext TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes > 0),
 PRIMARY KEY(context_id,name,ordinal)
);
