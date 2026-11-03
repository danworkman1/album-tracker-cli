import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { albumId, listReleases, refreshAlbums } from '../src/albums.js';
import { getMeta } from '../src/store.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW1 = new Date('2026-11-01T00:00:00Z');
const NOW2 = new Date('2026-11-02T00:00:00Z');

const row = (date, artist, album, extra = {}) => ({ date, artist, album, genre: '', label: '', ...extra });

// fetchMonth stub: month name -> rows (or an Error to throw).
const stub = (byMonth) => async (monthName) => {
  const v = byMonth[monthName] ?? [];
  if (v instanceof Error) throw v;
  return v;
};

const all = () => env.DB.prepare('SELECT * FROM albums ORDER BY release_date, artist').all().then((r) => r.results);

test('albumId is the md5 the CLI uses for event ids', async () => {
  expect(await albumId('Tool', 'New LP', '2026-11-06')).toBe('3022de89cdaba1b64b5366b86565d6d3');
});

test('refresh inserts rows with ISO dates and timestamps', async () => {
  const fetchMonth = stub({ November: [row('November 6', 'Tool', 'New LP', { genre: 'Prog', label: 'RCA' })] });
  const result = await refreshAlbums(env, { now: NOW1, fetchMonth });

  const rows = await all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: '3022de89cdaba1b64b5366b86565d6d3',
    artist: 'Tool',
    artist_lower: 'tool',
    album: 'New LP',
    release_date: '2026-11-06',
    genre: 'Prog',
    label: 'RCA',
    first_seen_at: NOW1.getTime(),
    last_seen_at: NOW1.getTime(),
    added_at: null
  });
  expect(result.upserted).toBe(1);
  // December returned nothing, so it is flagged.
  expect(result.warnings).toEqual(["No albums found for December 2026 — Wikipedia's layout may have changed."]);
});

test('a second refresh keeps first_seen_at and added_at but updates genre, label and last_seen_at', async () => {
  const first = stub({ November: [row('November 6', 'Tool', 'New LP')], December: [row('December 1', 'X', 'Y')] });
  await refreshAlbums(env, { now: NOW1, fetchMonth: first });
  await env.DB.prepare('UPDATE albums SET added_at = 123 WHERE artist = ?').bind('Tool').run();

  const second = stub({
    November: [row('November 6', 'Tool', 'New LP', { genre: 'Prog', label: 'RCA' })],
    December: [row('December 1', 'X', 'Y')]
  });
  await refreshAlbums(env, { now: NOW2, fetchMonth: second });

  const tool = (await all()).find((r) => r.artist === 'Tool');
  expect(tool).toMatchObject({
    first_seen_at: NOW1.getTime(),
    last_seen_at: NOW2.getTime(),
    added_at: 123,
    genre: 'Prog',
    label: 'RCA'
  });
});

test('a month that scrapes as zero albums keeps its rows and records a warning', async () => {
  const good = stub({ November: [row('November 6', 'Tool', 'New LP')], December: [row('December 1', 'X', 'Y')] });
  await refreshAlbums(env, { now: NOW1, fetchMonth: good });

  const broken = stub({ November: [], December: [row('December 1', 'X', 'Y')] });
  const result = await refreshAlbums(env, { now: NOW2, fetchMonth: broken });

  expect(await all()).toHaveLength(2);
  const warning = "No albums found for November 2026 — Wikipedia's layout may have changed.";
  expect(result.warnings).toEqual([warning]);
  expect(JSON.parse(await getMeta(env.DB, 'albums_warnings'))).toEqual([warning]);
});

test('a month that throws is reported while the other month still loads', async () => {
  const fetchMonth = stub({ November: new Error('boom'), December: [row('December 1', 'X', 'Y')] });
  const result = await refreshAlbums(env, { now: NOW1, fetchMonth });

  expect(result.warnings).toEqual(['Could not load November 2026: boom']);
  expect((await all()).map((r) => r.artist)).toEqual(['X']);
});

test('a release that moves date replaces its old unadded row', async () => {
  await refreshAlbums(env, {
    now: NOW1,
    fetchMonth: stub({ November: [row('November 6', 'Tool', 'New LP')], December: [row('December 1', 'X', 'Y')] })
  });
  await refreshAlbums(env, {
    now: NOW2,
    fetchMonth: stub({ November: [row('November 13', 'Tool', 'New LP')], December: [row('December 1', 'X', 'Y')] })
  });

  const tool = (await all()).filter((r) => r.artist === 'Tool');
  expect(tool.map((r) => r.release_date)).toEqual(['2026-11-13']);
});

test('a moved release keeps its old row when that one was already added', async () => {
  await refreshAlbums(env, {
    now: NOW1,
    fetchMonth: stub({ November: [row('November 6', 'Tool', 'New LP')], December: [row('December 1', 'X', 'Y')] })
  });
  await env.DB.prepare('UPDATE albums SET added_at = 5 WHERE artist = ?').bind('Tool').run();
  await refreshAlbums(env, {
    now: NOW2,
    fetchMonth: stub({ November: [row('November 13', 'Tool', 'New LP')], December: [row('December 1', 'X', 'Y')] })
  });

  const tool = (await all()).filter((r) => r.artist === 'Tool');
  expect(tool.map((r) => r.release_date)).toEqual(['2026-11-06', '2026-11-13']);
});

test('rows without a parseable date are skipped', async () => {
  const fetchMonth = stub({
    November: [row('November (Unknown Date)', 'Ghost', 'Nope'), row('November 6', 'Tool', 'New LP')],
    December: [row('December 1', 'X', 'Y')]
  });
  await refreshAlbums(env, { now: NOW1, fetchMonth });
  expect((await all()).map((r) => r.artist)).toEqual(['Tool', 'X']);
});

test('refresh records when it last ran', async () => {
  await refreshAlbums(env, { now: NOW1, fetchMonth: stub({}) });
  expect(await getMeta(env.DB, 'albums_synced_at')).toBe(String(NOW1.getTime()));
});

test('refresh uses the configured timezone for the window', async () => {
  // 14:30 UTC on 31 Oct is already 1 Nov in Sydney, so the window is Nov + Dec.
  const months = [];
  const fetchMonth = async (monthName, year) => {
    months.push(`${monthName} ${year}`);
    return [];
  };
  await refreshAlbums(env, { now: new Date('2026-10-31T14:30:00Z'), fetchMonth });
  expect(months).toEqual(['November 2026', 'December 2026']);
});

const seed = (artist, album, date, firstSeen, addedAt = null) =>
  env.DB.prepare(
    `INSERT INTO albums (id, artist, artist_lower, album, release_date, first_seen_at, last_seen_at, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(`${artist}-${album}`, artist, artist.toLowerCase(), album, date, firstSeen, firstSeen, addedAt)
    .run();

test('listReleases returns upcoming rows in order with real booleans', async () => {
  const nowMs = NOW2.getTime();
  await env.DB.prepare("INSERT INTO followed_artists (name_lower, name) VALUES ('tool', 'Tool')").run();
  await seed('Zed', 'Late', '2026-11-20', nowMs - 30 * DAY);
  await seed('Tool', 'New LP', '2026-11-06', nowMs - 1 * DAY, nowMs);
  await seed('Abba', 'Same Day', '2026-11-06', nowMs - 30 * DAY);
  await seed('Old', 'Past', '2026-10-30', nowMs - 30 * DAY);

  const releases = await listReleases(env.DB, { today: '2026-11-02', nowMs });

  expect(releases.map((r) => r.artist)).toEqual(['Abba', 'Tool', 'Zed']);
  expect(releases.find((r) => r.artist === 'Tool')).toEqual({
    id: 'Tool-New LP',
    artist: 'Tool',
    album: 'New LP',
    releaseDate: '2026-11-06',
    genre: '',
    label: '',
    followed: true,
    isNew: true,
    added: true
  });
  const abba = releases.find((r) => r.artist === 'Abba');
  expect(abba.followed).toBe(false);
  expect(abba.isNew).toBe(false);
  expect(abba.added).toBe(false);
});
