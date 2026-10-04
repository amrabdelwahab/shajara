CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scale TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'philosophy',
  philosophy TEXT NOT NULL DEFAULT '',
  oneline TEXT NOT NULL DEFAULT '',
  director TEXT,
  format TEXT NOT NULL DEFAULT '',
  production TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '[]',
  date TEXT NOT NULL DEFAULT '',
  proposal TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_space ON projects (space_id, created_at);
CREATE TABLE IF NOT EXISTS project_tracks (
  project_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, track_id)
);
CREATE INDEX IF NOT EXISTS project_tracks_track ON project_tracks (track_id);
CREATE TABLE IF NOT EXISTS project_votes (
  project_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  want TEXT NOT NULL DEFAULT '',
  director_ok TEXT NOT NULL DEFAULT '',
  needs TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, member_id)
);
