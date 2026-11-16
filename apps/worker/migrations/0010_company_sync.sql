/* Bounded metadata only; no financial payloads or provider credentials. */
CREATE TABLE IF NOT EXISTS sync_heads (
  owner TEXT NOT NULL, company TEXT NOT NULL, generation INTEGER NOT NULL,
  epoch TEXT NOT NULL, tail INTEGER NOT NULL DEFAULT 0, floor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner, company)
);
CREATE TABLE IF NOT EXISTS sync_events (
  owner TEXT NOT NULL, company TEXT NOT NULL, sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL, received INTEGER NOT NULL, event TEXT NOT NULL CHECK(length(event)<=2048),
  PRIMARY KEY(owner, company, sequence), UNIQUE(owner, company, event_id)
);
CREATE INDEX IF NOT EXISTS sync_events_retention ON sync_events(received);
CREATE TABLE IF NOT EXISTS sync_offsets (
  integration TEXT NOT NULL, topic TEXT NOT NULL, offset TEXT NOT NULL,
  received INTEGER NOT NULL, PRIMARY KEY(integration, topic)
);
