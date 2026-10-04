CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT,
  logo_v INTEGER,
  genres TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS spaces_key ON spaces (key_hash);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instruments TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  space_id TEXT NOT NULL DEFAULT 'abba',
  guest INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0,
  person_id TEXT
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  maqam TEXT NOT NULL DEFAULT '',
  tonic TEXT NOT NULL DEFAULT '',
  tempo INTEGER,
  genre TEXT NOT NULL DEFAULT '',
  chords TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  space_id TEXT NOT NULL DEFAULT 'abba'
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
  chords TEXT,
  bars INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS holders (
  section_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  member_id TEXT NOT NULL,
  instrument TEXT NOT NULL DEFAULT '',
  sound_ids TEXT NOT NULL DEFAULT '',
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
  sound_id TEXT,
  shelf_id TEXT,
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
  created_at INTEGER NOT NULL,
  space_id TEXT NOT NULL DEFAULT 'abba'
);
-- member_id holds the person id (members.person_id, or the member's own id), so instruments travel across spaces.
CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS instruments_member ON instruments (member_id, position);
CREATE TABLE IF NOT EXISTS sounds (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  audio_id TEXT,
  audio_mime TEXT,
  duration REAL,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sounds_instrument ON sounds (instrument_id, position);
CREATE TABLE IF NOT EXISTS shelf (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  audio_id TEXT,
  audio_mime TEXT,
  duration REAL,
  data TEXT NOT NULL DEFAULT '',
  sound_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shelf_person ON shelf (person_id, created_at);
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
