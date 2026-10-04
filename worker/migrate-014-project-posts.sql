CREATE TABLE IF NOT EXISTS project_posts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  member_id TEXT,
  kind TEXT NOT NULL DEFAULT 'opinion',
  body TEXT NOT NULL DEFAULT '',
  reply_to TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS project_posts_project ON project_posts (project_id, created_at);
