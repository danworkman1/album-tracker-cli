import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { ALBUMS_CRON, SPOTIFY_CRON, runScheduled } from '../src/cron.js';
import worker from '../src/index.js';
import { getMeta, hasRefreshToken, saveRefreshToken } from '../src/store.js';
import { todayInZone, windowMonths } from '../src/window.js';
import { htmlPage, json, monthTable, stubFetch, testEnv } from './helpers.js';

const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';
const following = (names) => json({ artists: { items: names.map((name) => ({ name, id: name })), next: null, cursors: { after: null } } });
const followedNames = () => env.DB.prepare('SELECT name FROM followed_artists ORDER BY name').all().then((r) => r.results.map((x) => x.name));

test('the spotify cron does nothing when Spotify is not connected', async () => {
  const calls = stubFetch(() => json({}));
  await runScheduled(SPOTIFY_CRON, testEnv());
  expect(calls).toHaveLength(0);
});

test('the spotify cron syncs followed artists and clears any old error', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('spotify_error', 'old problem')").run();
  stubFetch((url) => (url === SPOTIFY_TOKEN ? json({ access_token: 'at', expires_in: 3600 }) : following(['Tool', 'Abba'])));

  await runScheduled(SPOTIFY_CRON, testEnv());

  expect(await followedNames()).toEqual(['Abba', 'Tool']);
  expect(await getMeta(env.DB, 'spotify_error')).toBe('');
});

test('the spotify cron records an expired authorisation instead of throwing', async () => {
  await saveRefreshToken(env, 'spotify', 'dead');
  stubFetch(() => json({ error: 'invalid_grant' }, 400));

  await runScheduled(SPOTIFY_CRON, testEnv());

  expect(await getMeta(env.DB, 'spotify_error')).toBe('Spotify authorization expired — reconnect');
  expect(await hasRefreshToken(env, 'spotify')).toBe(false);
});

test('the spotify cron records any other failure instead of throwing', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  stubFetch((url) => (url === SPOTIFY_TOKEN ? json({ access_token: 'at', expires_in: 3600 }) : new Response('down', { status: 500 })));

  await runScheduled(SPOTIFY_CRON, testEnv());

  expect(await getMeta(env.DB, 'spotify_error')).toContain('Spotify sync failed: Failed to fetch followed artists');
});

const stubWikipedia = () => {
  const [first, second] = windowMonths(todayInZone(env.TIMEZONE));
  stubFetch(() =>
    htmlPage(
      monthTable(first.monthName, first.year, [[`${first.monthName} 6`, 'Tool', 'New LP']]),
      monthTable(second.monthName, second.year, [[`${second.monthName} 3`, 'Abba', 'Voyage']])
    )
  );
};
const albumArtists = () => env.DB.prepare('SELECT artist FROM albums ORDER BY artist').all().then((r) => r.results.map((x) => x.artist));

test('the albums cron refreshes the album window', async () => {
  stubWikipedia();
  await runScheduled(ALBUMS_CRON, testEnv());
  expect(await albumArtists()).toEqual(['Abba', 'Tool']);
});

test('an unrecognised cron string falls back to the albums refresh', async () => {
  stubWikipedia();
  await runScheduled('* * * * *', testEnv());
  expect(await albumArtists()).toEqual(['Abba', 'Tool']);
});

test('the worker scheduled handler runs the matching job via waitUntil', async () => {
  stubWikipedia();
  const pending = [];
  await worker.scheduled({ cron: ALBUMS_CRON }, testEnv(), { waitUntil: (p) => pending.push(p) });
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  expect(await albumArtists()).toEqual(['Abba', 'Tool']);
});
