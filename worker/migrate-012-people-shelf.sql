ALTER TABLE members ADD COLUMN person_id TEXT;
ALTER TABLE ideas ADD COLUMN shelf_id TEXT;
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
UPDATE members SET person_id = 'marwan' WHERE id = 'gh-marwan' AND EXISTS (SELECT 1 FROM members WHERE id = 'marwan');
UPDATE instruments SET member_id = 'marwan' WHERE member_id = 'gh-marwan' AND EXISTS (SELECT 1 FROM members WHERE id = 'marwan');
