import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { handleRequest } from '../src/routes.js';
import { getMeta, hasRefreshToken, loadRefreshToken, saveRefreshToken, setMeta } from '../src/store.js';
import { todayInZone, windowMonths } from '../src/window.js';
import { htmlPage, json, monthTable, stubFetch, testEnv } from './helpers.js';

const ORIGIN = 'https://app.test';
const ID = '3022de89cdaba1b64b5366b86565d6d3';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';

const send = (method, path, { origin = ORIGIN, headers = {}, e = testEnv() } = {}) =>
  handleRequest(new Request(ORIGIN + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...headers } }), e);
const get = (path, opts) => send('GET', path, { origin: null, ...opts });
const post = (path, opts) => send('POST', path, opts);

const seedAlbum = (releaseDate = '2099-01-01') =>
  env.DB.prepare(
    `INSERT INTO albums (id, artist, artist_lower, album, release_date, genre, label, first_seen_at, last_seen_at)
     VALUES (?, 'Tool', 'tool', 'New LP', ?, 'Prog', 'RCA', 1, 1)`
  )
    .bind(ID, releaseDate)
    .run();

test('state is empty and disconnected on a fresh database', async () => {
  const res = await get('/api/state');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    google: { connected: false },
    spotify: { connected: false },
    albumsSyncedAt: null,
    spotifySyncedAt: null,
    warnings: [],
    releases: []
  });
});

test('state reports connections, sync times, warnings and releases', async () => {
  await seedAlbum();
  await env.DB.prepare("INSERT INTO followed_artists (name_lower, name) VALUES ('tool', 'Tool')").run();
  await saveRefreshToken(env, 'google', 'g');
  await setMeta(env.DB, 'albums_synced_at', '1700000000000');
  await setMeta(env.DB, 'spotify_synced_at', '1700000001000');
  await setMeta(env.DB, 'albums_warnings', JSON.stringify(['albums warning']));
  await setMeta(env.DB, 'spotify_error', 'spotify went wrong');

  const body = await (await get('/api/state')).json();

  expect(body.google).toEqual({ connected: true });
  expect(body.spotify).toEqual({ connected: false });
  expect(body.albumsSyncedAt).toBe(1700000000000);
  expect(body.spotifySyncedAt).toBe(1700000001000);
  expect(body.warnings).toEqual(['albums warning', 'spotify went wrong']);
  expect(body.releases).toEqual([
    {
      id: ID,
      artist: 'Tool',
      album: 'New LP',
      releaseDate: '2099-01-01',
      genre: 'Prog',
      label: 'RCA',
      followed: true,
      isNew: false,
      added: false
    }
  ]);
});

test('POSTs without our own Origin are refused and do nothing', async () => {
  const calls = stubFetch(() => json({}));
  for (const origin of [null, 'https://evil.example']) {
    const res = await post('/api/spotify/sync', { origin });
    expect(res.status).toBe(403);
  }
  expect(calls).toHaveLength(0);
});

test('a POST with our Origin gets through to the handler', async () => {
  const res = await post('/api/spotify/sync');
  // Spotify isn't connected, so the handler runs and asks for a connection.
  expect(res.status).toBe(401);
});

test('add: an unknown album is a 404', async () => {
  const res = await post('/api/albums/nope/add');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

test('add: without a Google connection the page is told to reconnect', async () => {
  await seedAlbum();
  const res = await post(`/api/albums/${ID}/add`);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'reauth_required', provider: 'google' });
});

test('add: a revoked Google token gives reauth_required and removes the token', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'dead');
  stubFetch(() => json({ error: 'invalid_grant' }, 400));

  const res = await post(`/api/albums/${ID}/add`);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'reauth_required', provider: 'google' });
  expect(await hasRefreshToken(env, 'google')).toBe(false);
});

test('add: success marks the album added in state', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'r');
  stubFetch((url) => (url === GOOGLE_TOKEN ? json({ access_token: 'at', expires_in: 3600 }) : json({ id: ID })));

  const res = await post(`/api/albums/${ID}/add`);
  expect(await res.json()).toEqual({ status: 'success' });

  const state = await (await get('/api/state')).json();
  expect(state.releases[0].added).toBe(true);
});

test('add: Google 409 is a duplicate, still shown as added', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'r');
  stubFetch((url) => (url === GOOGLE_TOKEN ? json({ access_token: 'at', expires_in: 3600 }) : new Response('exists', { status: 409 })));

  expect(await (await post(`/api/albums/${ID}/add`)).json()).toEqual({ status: 'duplicate' });
  expect((await (await get('/api/state')).json()).releases[0].added).toBe(true);
});

test('add: any other Google failure is a 500 and the album stays unadded', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'r');
  stubFetch((url) => (url === GOOGLE_TOKEN ? json({ access_token: 'at', expires_in: 3600 }) : new Response('nope', { status: 500 })));

  const res = await post(`/api/albums/${ID}/add`);
  expect(res.status).toBe(500);
  expect((await res.json()).error).toContain('Google Calendar API Error');
  expect((await (await get('/api/state')).json()).releases[0].added).toBe(false);
});

const followingPage = (names) => json({ artists: { items: names.map((name) => ({ name, id: name })), next: null, cursors: { after: null } } });

test('spotify sync returns the count and stores the artists', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  stubFetch((url) => (url === SPOTIFY_TOKEN ? json({ access_token: 'at', expires_in: 3600 }) : followingPage(['Tool', 'Abba'])));

  const res = await post('/api/spotify/sync');
  expect(await res.json()).toEqual({ count: 2 });
  const { results } = await env.DB.prepare('SELECT name FROM followed_artists ORDER BY name').all();
  expect(results.map((r) => r.name)).toEqual(['Abba', 'Tool']);
});

test('spotify sync with a revoked token is a 401 and removes the token', async () => {
  await saveRefreshToken(env, 'spotify', 'dead');
  stubFetch(() => json({ error: 'invalid_grant' }, 400));

  const res = await post('/api/spotify/sync');
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'reauth_required', provider: 'spotify' });
  expect(await loadRefreshToken(env, 'spotify')).toBeNull();
});

test('spotify sync failure is recorded for the page to show', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  stubFetch((url) => (url === SPOTIFY_TOKEN ? json({ access_token: 'at', expires_in: 3600 }) : new Response('down', { status: 500 })));

  const res = await post('/api/spotify/sync');
  expect(res.status).toBe(500);
  expect(await getMeta(env.DB, 'spotify_error')).toContain('Spotify sync failed: Failed to fetch followed artists');
});

test('albums refresh scrapes the window and reports the result', async () => {
  const [first, second] = windowMonths(todayInZone(env.TIMEZONE));
  const page = () =>
    htmlPage(
      monthTable(first.monthName, first.year, [[`${first.monthName} 6`, 'Tool', 'New LP', 'Prog', 'RCA']]),
      monthTable(second.monthName, second.year, [[`${second.monthName} 3`, 'Abba', 'Voyage']])
    );
  stubFetch(() => page());

  const res = await post('/api/albums/refresh');
  expect(await res.json()).toEqual({ upserted: 2, warnings: [] });
  const { results } = await env.DB.prepare('SELECT artist FROM albums ORDER BY artist').all();
  expect(results.map((r) => r.artist)).toEqual(['Abba', 'Tool']);
});

const cookiesOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]);
const cookieValue = (res, name) => cookiesOf(res).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

test('google start redirects to Google with a state that matches the cookie', async () => {
  const res = await get('/auth/google/start');
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location'));
  expect(location.origin).toBe('https://accounts.google.com');
  expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`);
  const state = location.searchParams.get('state');
  expect(state.length).toBeGreaterThan(10);
  expect(cookieValue(res, 'oauth_state')).toBe(state);
  expect(res.headers.getSetCookie()[0]).toContain('Secure');
});

test('the state cookie is not Secure on plain http (local dev)', async () => {
  const res = await handleRequest(new Request('http://127.0.0.1:8787/auth/google/start'), testEnv());
  expect(res.headers.getSetCookie()[0]).not.toContain('Secure');
  expect(new URL(res.headers.get('Location')).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8787/auth/google/callback');
});

test('google callback with the wrong state stores nothing', async () => {
  const res = await get('/auth/google/callback?code=c&state=forged', { headers: { Cookie: 'oauth_state=real' } });
  expect(res.status).toBe(400);
  expect(await hasRefreshToken(env, 'google')).toBe(false);
});

test('google callback with no state cookie is refused', async () => {
  const res = await get('/auth/google/callback?code=c&state=anything');
  expect(res.status).toBe(400);
});

test('google callback with an error from Google is refused', async () => {
  const res = await get('/auth/google/callback?error=access_denied&state=s', { headers: { Cookie: 'oauth_state=s' } });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('access_denied');
});

test('google callback with the right state saves the token and goes home', async () => {
  stubFetch(() => json({ access_token: 'a', refresh_token: 'google-refresh', expires_in: 3600 }));
  const res = await get('/auth/google/callback?code=c&state=s1', { headers: { Cookie: 'oauth_state=s1' } });

  expect(res.status).toBe(302);
  expect(res.headers.get('Location')).toBe('/?connected=google');
  expect(await loadRefreshToken(env, 'google')).toBe('google-refresh');
  // The one-time cookie is cleared.
  expect(res.headers.getSetCookie().some((c) => c.startsWith('oauth_state=') && c.includes('Max-Age=0'))).toBe(true);
});

test('spotify start sets state and PKCE verifier cookies and sends a challenge', async () => {
  const res = await get('/auth/spotify/start');
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location'));
  expect(location.origin).toBe('https://accounts.spotify.com');
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(location.searchParams.get('code_challenge').length).toBeGreaterThan(20);
  expect(cookieValue(res, 'oauth_state')).toBe(location.searchParams.get('state'));
  expect(cookieValue(res, 'oauth_verifier').length).toBeGreaterThan(20);
});

test('spotify callback sends the verifier from the cookie', async () => {
  const calls = stubFetch(() => json({ access_token: 'a', refresh_token: 'spotify-refresh', expires_in: 3600 }));
  const res = await get('/auth/spotify/callback?code=c&state=s2', {
    headers: { Cookie: 'oauth_state=s2; oauth_verifier=the-verifier' }
  });

  expect(res.headers.get('Location')).toBe('/?connected=spotify');
  expect(calls[0].body.code_verifier).toBe('the-verifier');
  expect(await loadRefreshToken(env, 'spotify')).toBe('spotify-refresh');
});

test('a failed code exchange shows a readable error, not a stack trace', async () => {
  stubFetch(() => json({ error: 'invalid_request' }, 400));
  const res = await get('/auth/google/callback?code=c&state=s', { headers: { Cookie: 'oauth_state=s' } });
  expect(res.status).toBe(500);
  expect(await res.text()).toContain('Google sign-in failed');
});

test('anything else is served from the static assets', async () => {
  const res = await get('/app.js', { e: testEnv({ ASSETS: { fetch: async () => new Response('from assets') } }) });
  expect(await res.text()).toBe('from assets');
});
