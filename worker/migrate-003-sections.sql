CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  meter_n INTEGER NOT NULL DEFAULT 4,
  meter_sub INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

INSERT INTO sections (id, track_id, name, position, created_at)
  SELECT lower(hex(randomblob(8))), id, 'Main', 0, created_at FROM tracks;

CREATE TABLE holders_new (
  section_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  member_id TEXT NOT NULL,
  instrument TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (section_id, layer, member_id)
);
INSERT INTO holders_new (section_id, layer, member_id, instrument)
  SELECT s.id, h.layer, h.member_id, h.instrument FROM holders h JOIN sections s ON s.track_id = h.track_id;
DROP TABLE holders;
ALTER TABLE holders_new RENAME TO holders;

CREATE TABLE beats_new (
  section_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  pattern TEXT NOT NULL DEFAULT '',
  sub INTEGER NOT NULL DEFAULT 2,
  bar INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, layer)
);
INSERT INTO beats_new (section_id, layer, name, pattern, sub, bar)
  SELECT s.id, b.layer, b.name, b.pattern, b.sub, b.bar FROM beats b JOIN sections s ON s.track_id = b.track_id;
DROP TABLE beats;
ALTER TABLE beats_new RENAME TO beats;

ALTER TABLE ideas ADD COLUMN section_id TEXT;
UPDATE ideas SET section_id = (SELECT id FROM sections WHERE sections.track_id = ideas.track_id);

CREATE INDEX IF NOT EXISTS sections_track ON sections (track_id, position);
