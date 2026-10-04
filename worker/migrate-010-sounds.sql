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
ALTER TABLE holders ADD COLUMN sound_ids TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN sound_id TEXT;
