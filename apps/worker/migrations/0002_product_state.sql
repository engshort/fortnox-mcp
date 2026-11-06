CREATE TABLE IF NOT EXISTS product_state (
  space TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (space, id)
);
