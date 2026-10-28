-- Sets: something you play. A cast (members of the space or guests from outside) and tracks in running order.
-- Each track in a set is its own version: a full track (sections, line-up, recordings) with set_id, and version_of
-- pointing at the track it started from (NULL when it was written for the set). Versions don't show in the Tracks list.
-- A share token publishes a read-only send-out of the set.
CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  share TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sets_space ON sets (space_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS sets_share ON sets (share);
CREATE TABLE IF NOT EXISTS set_people (
  set_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (set_id, member_id)
);
CREATE TABLE IF NOT EXISTS set_tracks (
  set_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (set_id, track_id)
);
ALTER TABLE tracks ADD COLUMN set_id TEXT;
ALTER TABLE tracks ADD COLUMN version_of TEXT;
-- What a person plays in a section ("3.am melody, unison"), next to the instrument they play it on.
ALTER TABLE holders ADD COLUMN part TEXT NOT NULL DEFAULT '';
-- Cues into a section: [{text, from}], from = a member id or 'production'. weight = how long it feels, for the set view.
ALTER TABLE sections ADD COLUMN cues TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sections ADD COLUMN weight REAL;
