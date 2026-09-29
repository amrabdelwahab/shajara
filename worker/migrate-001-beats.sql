CREATE TABLE IF NOT EXISTS beats (
  track_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  pattern TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (track_id, layer)
);
ALTER TABLE tracks DROP COLUMN meter;
