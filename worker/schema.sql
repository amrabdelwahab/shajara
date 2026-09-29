CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instruments TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  maqam TEXT NOT NULL DEFAULT '',
  tonic TEXT NOT NULL DEFAULT '',
  tempo INTEGER,
  meter TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS holders (
  track_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  member_id TEXT NOT NULL,
  instrument TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (track_id, layer, member_id)
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  author_id TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  audio_id TEXT,
  audio_mime TEXT,
  duration REAL,
  starred INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ideas_track ON ideas (track_id, created_at);
