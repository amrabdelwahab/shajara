CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS spaces_key ON spaces (key_hash);
INSERT OR IGNORE INTO spaces (id, name, key_hash, created_at) VALUES ('abba', '‘ala bab allah', NULL, 0);
ALTER TABLE members ADD COLUMN space_id TEXT NOT NULL DEFAULT 'abba';
ALTER TABLE members ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN space_id TEXT NOT NULL DEFAULT 'abba';
ALTER TABLE grooves ADD COLUMN space_id TEXT NOT NULL DEFAULT 'abba';
CREATE INDEX IF NOT EXISTS tracks_space ON tracks (space_id, updated_at);
