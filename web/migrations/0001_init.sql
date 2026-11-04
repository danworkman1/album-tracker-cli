CREATE TABLE albums (
  id TEXT PRIMARY KEY,            -- md5 hex; also the Google event id
  artist TEXT NOT NULL,
  artist_lower TEXT NOT NULL,
  album TEXT NOT NULL,
  release_date TEXT NOT NULL,     -- YYYY-MM-DD
  genre TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  first_seen_at INTEGER NOT NULL, -- epoch ms
  last_seen_at INTEGER NOT NULL,  -- epoch ms
  added_at INTEGER                -- epoch ms, NULL until in the calendar
);
CREATE INDEX albums_release_date ON albums (release_date);
CREATE TABLE followed_artists (name_lower TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE tokens (provider TEXT PRIMARY KEY, refresh_token_enc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
