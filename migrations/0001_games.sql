-- Apply through the hosting migration workflow, never per request.
CREATE TABLE IF NOT EXISTS games (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_created_at ON games(created_at);
