import { env } from 'cloudflare:workers';
import { vi } from 'vitest';

/**
 * A plain env for handler tests, with a stub ASSETS binding. Pass `extra` to
 * override or add vars (e.g. DEV_BYPASS_ACCESS).
 */
export function testEnv(extra = {}) {
  return {
    DB: env.DB,
    TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
    TIMEZONE: env.TIMEZONE,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID,
    GOOGLE_CALENDAR_ID: env.GOOGLE_CALENDAR_ID,
    ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN,
    ACCESS_AUD: env.ACCESS_AUD,
    ASSETS: { fetch: async () => new Response('asset') },
    ...extra
  };
}

/** One Wikipedia month table in the shape src/scraper.js parses. rows: [date, artist, album, genre, label][] */
export function monthTable(monthName, year, rows) {
  const body = rows
    .map(
      ([date, artist, album, genre = '', label = '']) =>
        `<tr><th scope="row">${date}</th><td>${artist}</td><td>${album}</td><td>${genre}</td><td>${label}</td><td>[1]</td></tr>`
    )
    .join('');
  return (
    `<table class="wikitable"><caption>List of albums released in ${monthName} ${year}</caption><tbody>` +
    `<tr><th scope="col">Release date</th><th scope="col">Artist</th><th scope="col">Album</th><th scope="col">Genre</th><th scope="col">Label</th><th scope="col">Ref.</th></tr>` +
    `${body}</tbody></table>`
  );
}

export const htmlPage = (...tables) => new Response(`<html><body>${tables.join('')}</body></html>`);

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Replaces global fetch for one test. `handler(url, init)` returns a Response;
 * every call is recorded as { url, init, body } (body is the form/JSON body
 * parsed to an object when there is one). Restored by setup.js after each test.
 */
export function stubFetch(handler) {
  const calls = [];
  vi.stubGlobal('fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    let body = null;
    if (typeof init.body === 'string') {
      body = init.body.startsWith('{') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body));
    } else if (init.body instanceof URLSearchParams) {
      body = Object.fromEntries(init.body);
    }
    calls.push({ url, init, body });
    return handler(url, init);
  });
  return calls;
}

// Provider endpoints as literals, so tests check the code against them rather
// than against the constants the code itself defines.
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Stubs fetch for a provider: its token endpoint always succeeds, everything else goes to `apiResponse(url, init)`. */
export const stubProvider = (tokenUrl, apiResponse) =>
  stubFetch((url, init) => (url === tokenUrl ? json({ access_token: 'at', expires_in: 3600 }) : apiResponse(url, init)));

/** One page of Spotify's /me/following response. */
export const followingPage = (names, after = null, next = null) =>
  json({ artists: { items: names.map((name, i) => ({ name, id: `${name}-${i}` })), next, cursors: { after } } });

/** The md5 of "tool-new lp-2026-11-06": the id (and Google event id) of the album seedAlbum inserts. */
export const ALBUM_ID = '3022de89cdaba1b64b5366b86565d6d3';

/** Inserts the one album handler tests share: Tool, "New LP". */
export const seedAlbum = (releaseDate = '2099-01-01') =>
  env.DB.prepare(
    `INSERT INTO albums (id, artist, artist_lower, album, release_date, genre, label, first_seen_at, last_seen_at)
     VALUES (?, 'Tool', 'tool', 'New LP', ?, 'Prog', 'RCA', 1, 1)`
  )
    .bind(ALBUM_ID, releaseDate)
    .run();
