import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { addAlbumToCalendar, buildEventBody, exchangeGoogleCode, googleAuthUrl } from '../src/google.js';
import { loadRefreshToken, saveRefreshToken } from '../src/store.js';
import { ALBUM_ID as ID, GOOGLE_TOKEN_URL as TOKEN_URL, json, seedAlbum, stubFetch, stubProvider } from './helpers.js';

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

const addedAt = () => env.DB.prepare('SELECT added_at FROM albums WHERE id = ?').bind(ID).first().then((r) => r.added_at);

// The events endpoint answers with `eventsResponse`.
const stubGoogle = (eventsResponse) => stubProvider(TOKEN_URL, eventsResponse);

test('googleAuthUrl asks for calendar.events with offline access and forced consent', () => {
  const url = new URL(googleAuthUrl(env, { redirectUri: 'https://x.test/auth/google/callback', state: 'st' }));
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'test-google-client',
    redirect_uri: 'https://x.test/auth/google/callback',
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
    state: 'st'
  });
});

test('buildEventBody matches the CLI event shape', () => {
  const body = buildEventBody(
    { id: ID, artist: 'Tool', album: 'New LP', genre: 'Prog', label: 'RCA', releaseDate: '2026-11-06' },
    'Australia/Sydney'
  );
  expect(body.id).toBe(ID);
  expect(body.summary).toBe('Album Drop: Tool - New LP');
  expect(body.start).toEqual({ dateTime: '2026-11-06T09:00:00', timeZone: 'Australia/Sydney' });
  expect(body.end).toEqual({ dateTime: '2026-11-06T09:15:00', timeZone: 'Australia/Sydney' });
  expect(body.transparency).toBe('transparent');
  expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
  expect(body.source).toEqual({ title: 'Spotify Search', url: 'https://open.spotify.com/search/Tool%20New%20LP' });
  expect(body.description).toContain('Genre: Prog');
  expect(body.description).toContain('Label: RCA');
});

test('adding an album creates the event and marks it added', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'r');
  const calls = stubGoogle(() => json({ id: ID }));

  expect(await addAlbumToCalendar(env, ID)).toEqual({ status: 'success' });

  const post = calls.find((c) => c.url === EVENTS_URL);
  expect(post.init.method).toBe('POST');
  expect(post.init.headers.Authorization).toBe('Bearer at');
  expect(post.body.id).toBe(ID);
  expect(post.body.start.timeZone).toBe('Australia/Sydney');
  expect(await addedAt()).toBeGreaterThan(0);
});

test('a 409 from Google counts as already added', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'r');
  stubGoogle(() => new Response('exists', { status: 409 }));

  expect(await addAlbumToCalendar(env, ID)).toEqual({ status: 'duplicate' });
  expect(await addedAt()).toBeGreaterThan(0);
});

test('adding twice keeps the first added_at', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'r');
  stubGoogle(() => json({ id: ID }));
  await addAlbumToCalendar(env, ID);
  await env.DB.prepare('UPDATE albums SET added_at = 111 WHERE id = ?').bind(ID).run();

  stubGoogle(() => new Response('exists', { status: 409 }));
  await addAlbumToCalendar(env, ID);

  expect(await addedAt()).toBe(111);
});

test('a Google error is thrown and the album is not marked added', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'r');
  stubGoogle(() => new Response('server blew up', { status: 500 }));

  await expect(addAlbumToCalendar(env, ID)).rejects.toThrow(/Google Calendar API Error: server blew up/);
  expect(await addedAt()).toBeNull();
});

test('an unknown album id is not_found', async () => {
  const err = await addAlbumToCalendar(env, 'nope').catch((e) => e);
  expect(err.code).toBe('not_found');
});

test('a revoked Google token asks for reauth and is deleted', async () => {
  await seedAlbum();
  await saveRefreshToken(env, 'google', 'dead');
  stubFetch(() => json({ error: 'invalid_grant' }, 400));

  const err = await addAlbumToCalendar(env, ID).catch((e) => e);
  expect(err.code).toBe('reauth_required');
  expect(err.provider).toBe('google');
  expect(await loadRefreshToken(env, 'google')).toBeNull();
  expect(await addedAt()).toBeNull();
});

test('exchangeGoogleCode stores the refresh token it is given', async () => {
  const calls = stubFetch(() => json({ access_token: 'a', refresh_token: 'new-refresh', expires_in: 3600 }));
  await exchangeGoogleCode(env, { code: 'c', redirectUri: 'https://x.test/cb' });

  expect(calls[0].url).toBe(TOKEN_URL);
  expect(calls[0].body).toEqual({
    grant_type: 'authorization_code',
    code: 'c',
    redirect_uri: 'https://x.test/cb',
    client_id: 'test-google-client',
    client_secret: 'test-google-pw'
  });
  expect(await loadRefreshToken(env, 'google')).toBe('new-refresh');
});

test('exchangeGoogleCode keeps the old token when Google returns no new one', async () => {
  await saveRefreshToken(env, 'google', 'old-refresh');
  stubFetch(() => json({ access_token: 'a', expires_in: 3600 }));
  await exchangeGoogleCode(env, { code: 'c', redirectUri: 'https://x.test/cb' });
  expect(await loadRefreshToken(env, 'google')).toBe('old-refresh');
});

test('exchangeGoogleCode fails when there is no refresh token anywhere', async () => {
  stubFetch(() => json({ access_token: 'a', expires_in: 3600 }));
  await expect(exchangeGoogleCode(env, { code: 'c', redirectUri: 'https://x.test/cb' })).rejects.toThrow(
    'Google did not return a refresh token'
  );
});
