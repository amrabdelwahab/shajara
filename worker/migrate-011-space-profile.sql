ALTER TABLE spaces ADD COLUMN genres TEXT;
ALTER TABLE members ADD COLUMN ready INTEGER NOT NULL DEFAULT 0;
UPDATE spaces SET genres = '["The underground band sound","Ambient + jazz","Motseklat rock","Electrosha3by","Techno / House","West African","Cinematic","Classical sha3by"]' WHERE id = 'abba';
