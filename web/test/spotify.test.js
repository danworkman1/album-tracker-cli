import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { exchangeSpotifyCode, spotifyAuthUrl, syncFollowedArtists } from '../src/spotify.js';
import { getMeta, loadRefreshToken, saveRefreshToken } from '../src/store.js';
import { SPOTIFY_TOKEN_URL as TOKEN_URL, followingPage, json, stubFetch, stubProvider } from './helpers.js';

const followed = () => env.DB.prepare('SELECT * FROM followed_artists ORDER BY name_lower').all().then((r) => r.results);

test('spotifyAuthUrl asks for follow-read with PKCE and the given state', () => {
  const url = new URL(spotifyAuthUrl(env, { redirectUri: 'https://x.test/auth/spotify/callback', state: 'st', challenge: 'ch' }));
  expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'test-spotify-client',
    response_type: 'code',
    redirect_uri: 'https://x.test/auth/spotify/callback',
    scope: 'user-follow-read',
    state: 'st',
    code_challenge_method: 'S256',
    code_challenge: 'ch'
  });
});

test('exchangeSpotifyCode sends the PKCE verifier and stores the refresh token', async () => {
  const calls = stubFetch(() => json({ access_token: 'a', refresh_token: 'spotify-refresh', expires_in: 3600 }));
  await exchangeSpotifyCode(env, { code: 'c', redirectUri: 'https://x.test/cb', verifier: 'v' });

  expect(calls[0].url).toBe(TOKEN_URL);
  expect(calls[0].body).toEqual({
    grant_type: 'authorization_code',
    code: 'c',
    redirect_uri: 'https://x.test/cb',
    code_verifier: 'v',
    client_id: 'test-spotify-client'
  });
  expect(await loadRefreshToken(env, 'spotify')).toBe('spotify-refresh');
});

test('sync follows the cursor across pages and fills the table', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  const calls = stubProvider(TOKEN_URL, (url) => {
    const after = new URL(url).searchParams.get('after');
    if (after === null) return followingPage(['Tool', 'Björk'], 'c1', 'next-1');
    if (after === 'c1') return followingPage(['Abba'], 'c2', 'next-2');
    return followingPage(['Zed']);
  });

  const count = await syncFollowedArtists(env);

  expect(count).toBe(4);
  expect((await followed()).map((r) => [r.name_lower, r.name])).toEqual([
    ['abba', 'Abba'],
    ['björk', 'Björk'],
    ['tool', 'Tool'],
    ['zed', 'Zed']
  ]);
  const api = calls.filter((c) => c.url.startsWith('https://api.spotify.com/'));
  expect(api).toHaveLength(3);
  expect(new URL(api[0].url).searchParams.get('type')).toBe('artist');
  expect(new URL(api[0].url).searchParams.get('limit')).toBe('50');
  expect(api[0].init.headers.Authorization).toBe('Bearer at');
  expect(await getMeta(env.DB, 'spotify_error')).toBe('');
  expect(Number(await getMeta(env.DB, 'spotify_synced_at'))).toBeGreaterThan(0);
});

test('sync copes with artists that share a name and with more than 50 artists', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  const names = Array.from({ length: 120 }, (_, i) => `Artist ${i}`);
  names.push('NIRVANA', 'Nirvana');
  stubProvider(TOKEN_URL, () => followingPage(names));

  await syncFollowedArtists(env);

  const rows = await followed();
  expect(rows).toHaveLength(121);
  expect(rows.filter((r) => r.name_lower === 'nirvana')).toHaveLength(1);
});

test('a failed page leaves the existing followed artists alone', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  await env.DB.prepare("INSERT INTO followed_artists (name_lower, name) VALUES ('keep', 'Keep')").run();
  stubProvider(TOKEN_URL, (url) =>
    new URL(url).searchParams.get('after') === null
      ? followingPage(['New'], 'c1', 'next')
      : new Response('boom', { status: 500 })
  );

  await expect(syncFollowedArtists(env)).rejects.toThrow(/Failed to fetch followed artists/);
  expect((await followed()).map((r) => r.name)).toEqual(['Keep']);
});

test('a failed sync records a message for the page to show', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  stubProvider(TOKEN_URL, () => new Response('down', { status: 500 }));

  await expect(syncFollowedArtists(env)).rejects.toThrow();
  expect(await getMeta(env.DB, 'spotify_error')).toContain('Spotify sync failed: Failed to fetch followed artists');
});

test('a dead token is not recorded as a sync failure', async () => {
  await saveRefreshToken(env, 'spotify', 'dead');
  stubFetch(() => json({ error: 'invalid_grant' }, 400));

  await expect(syncFollowedArtists(env)).rejects.toMatchObject({ code: 'reauth_required' });
  // "Not connected" already says it; a failure banner on top would be noise.
  expect(await getMeta(env.DB, 'spotify_error')).toBeNull();
});

test('sync replaces the old followed list', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  await env.DB.prepare("INSERT INTO followed_artists (name_lower, name) VALUES ('gone', 'Gone')").run();
  stubProvider(TOKEN_URL, () => followingPage(['Fresh']));

  await syncFollowedArtists(env);
  expect((await followed()).map((r) => r.name)).toEqual(['Fresh']);
});
