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
  genre TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  meter_n INTEGER NOT NULL DEFAULT 4,
  meter_sub INTEGER NOT NULL DEFAULT 1,
  maqam TEXT,
  tonic TEXT,
  tempo INTEGER,
  energy INTEGER,
  moves TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS holders (
  section_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  member_id TEXT NOT NULL,
  instrument TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (section_id, layer, member_id)
);

CREATE TABLE IF NOT EXISTS beats (
  section_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  pattern TEXT NOT NULL DEFAULT '',
  sub INTEGER NOT NULL DEFAULT 2,
  bar INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, layer)
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  section_id TEXT,
  layer TEXT NOT NULL,
  author_id TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  audio_id TEXT,
  audio_mime TEXT,
  duration REAL,
  starred INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ideas_track ON ideas (track_id, created_at);
CREATE INDEX IF NOT EXISTS sections_track ON sections (track_id, position);
CREATE TABLE IF NOT EXISTS grooves (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  sub INTEGER NOT NULL DEFAULT 2,
  bar INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
