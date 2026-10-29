-- Small jobs that come up around a set ("I'll fix the levels", "install that sound"): who does it, done or not.
CREATE TABLE IF NOT EXISTS set_tasks (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  member_id TEXT,
  by TEXT,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS set_tasks_set ON set_tasks (set_id, done, created_at);
