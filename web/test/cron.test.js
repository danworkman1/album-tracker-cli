import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { runScheduled, runSpotifySync } from '../src/cron.js';
import worker from '../src/index.js';
import { getMeta, hasRefreshToken, saveRefreshToken } from '../src/store.js';
import { todayInZone, windowMonths } from '../src/window.js';
import {
  SPOTIFY_TOKEN_URL,
  followingPage,
  htmlPage,
  json,
  monthTable,
  stubFetch,
  stubProvider,
  testEnv
} from './helpers.js';

const followedNames = () => env.DB.prepare('SELECT name FROM followed_artists ORDER BY name').all().then((r) => r.results.map((x) => x.name));
const albumArtists = () => env.DB.prepare('SELECT artist FROM albums ORDER BY artist').all().then((r) => r.results.map((x) => x.artist));

test('the Spotify sync does nothing when Spotify is not connected', async () => {
  const calls = stubFetch(() => json({}));
  await runSpotifySync(testEnv());
  expect(calls).toHaveLength(0);
});

test('the Spotify sync syncs followed artists and clears any old error', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('spotify_error', 'old problem')").run();
  stubProvider(SPOTIFY_TOKEN_URL, () => followingPage(['Tool', 'Abba']));

  await runSpotifySync(testEnv());

  expect(await followedNames()).toEqual(['Abba', 'Tool']);
  expect(await getMeta(env.DB, 'spotify_error')).toBe('');
});

test('the Spotify sync records an expired authorisation instead of throwing', async () => {
  await saveRefreshToken(env, 'spotify', 'dead');
  stubFetch(() => json({ error: 'invalid_grant' }, 400));

  await runSpotifySync(testEnv());

  expect(await getMeta(env.DB, 'spotify_error')).toBe('Spotify authorisation expired — reconnect');
  expect(await hasRefreshToken(env, 'spotify')).toBe(false);
});

test('the Spotify sync records any other failure instead of throwing', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  stubProvider(SPOTIFY_TOKEN_URL, () => new Response('down', { status: 500 }));

  await runSpotifySync(testEnv());

  expect(await getMeta(env.DB, 'spotify_error')).toContain('Spotify sync failed: Failed to fetch followed artists');
});

const wikipediaPage = () => {
  const [first, second] = windowMonths(todayInZone(env.TIMEZONE));
  return htmlPage(
    monthTable(first.monthName, first.year, [[`${first.monthName} 6`, 'Tool', 'New LP']]),
    monthTable(second.monthName, second.year, [[`${second.monthName} 3`, 'Abba', 'Voyage']])
  );
};

test('the daily run refreshes the album window', async () => {
  stubFetch(() => wikipediaPage());
  await runScheduled(testEnv());
  expect(await albumArtists()).toEqual(['Abba', 'Tool']);
});

test('the daily run also syncs Spotify when it is connected', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  stubProvider(SPOTIFY_TOKEN_URL, (url) => (url.includes('wikipedia.org') ? wikipediaPage() : followingPage(['Tool'])));

  await runScheduled(testEnv());

  expect(await albumArtists()).toEqual(['Abba', 'Tool']);
  expect(await followedNames()).toEqual(['Tool']);
});

test('a failing album refresh does not stop the Spotify sync', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await saveRefreshToken(env, 'spotify', 'r');
  stubProvider(SPOTIFY_TOKEN_URL, () => followingPage(['Tool']));

  // An invalid time zone makes the album refresh throw before it fetches anything.
  await runScheduled(testEnv({ TIMEZONE: 'Not/AZone' }));

  expect(await followedNames()).toEqual(['Tool']);
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

test('the worker scheduled handler runs the daily run via waitUntil', async () => {
  stubFetch(() => wikipediaPage());
  const pending = [];
  await worker.scheduled({}, testEnv(), { waitUntil: (p) => pending.push(p) });
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  expect(await albumArtists()).toEqual(['Abba', 'Tool']);
});
