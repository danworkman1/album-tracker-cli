import { parseWikiDate } from '../../src/calendar.js';
import { getUpcomingAlbums } from '../../src/scraper.js';
import { setMeta } from './store.js';
import { monthBounds, todayInZone, windowMonths } from './window.js';

const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

/**
 * Same id the CLI hashes for Google event ids, so albums the CLI already added
 * show up here as duplicates rather than errors.
 */
export async function albumId(artist, album, releaseDate) {
  const source = `${artist.toLowerCase()}-${album.toLowerCase()}-${releaseDate}`;
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Scrapes the current and next month into D1. A month that fails or comes back
 * empty is left alone (never deleted) and reported as a warning, because an
 * empty month almost always means Wikipedia's layout changed.
 */
export async function refreshAlbums(env, { now = new Date(), fetchMonth = getUpcomingAlbums } = {}) {
  const nowMs = now.getTime();
  const today = todayInZone(env.TIMEZONE, now);
  const warnings = [];
  let upserted = 0;

  const upsert = env.DB.prepare(
    `INSERT INTO albums (id, artist, artist_lower, album, release_date, genre, label, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET genre = excluded.genre, label = excluded.label, last_seen_at = excluded.last_seen_at`
  );

  for (const { monthName, year } of windowMonths(today)) {
    let rows;
    try {
      rows = await fetchMonth(monthName, year);
    } catch (err) {
      warnings.push(`Could not load ${monthName} ${year}: ${err.message}`);
      continue;
    }

    const releases = [];
    for (const r of rows) {
      const dates = parseWikiDate(r.date, year);
      if (dates) releases.push({ ...r, releaseDate: dates.startISO });
    }

    if (releases.length === 0) {
      warnings.push(`No albums found for ${monthName} ${year} — Wikipedia's layout may have changed.`);
      continue;
    }

    const statements = [];
    for (const r of releases) {
      const id = await albumId(r.artist, r.album, r.releaseDate);
      statements.push(
        upsert.bind(id, r.artist, r.artist.toLowerCase(), r.album, r.releaseDate, r.genre, r.label, nowMs, nowMs)
      );
    }
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
    }
    upserted += releases.length;

    // Anything in this month that Wikipedia no longer lists (a release that
    // moved date, say) and that isn't in the calendar yet is stale.
    const { from, to } = monthBounds(monthName, year);
    await env.DB.prepare(
      'DELETE FROM albums WHERE release_date >= ? AND release_date < ? AND added_at IS NULL AND last_seen_at < ?'
    )
      .bind(from, to, nowMs)
      .run();
  }

  await setMeta(env.DB, 'albums_warnings', JSON.stringify(warnings));
  await setMeta(env.DB, 'albums_synced_at', String(nowMs));
  return { upserted, warnings };
}

/** Upcoming releases for the page, soonest first. */
export async function listReleases(db, { today, nowMs }) {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.artist, a.album, a.release_date, a.genre, a.label, a.first_seen_at, a.added_at,
              f.name_lower IS NOT NULL AS followed
       FROM albums a
       LEFT JOIN followed_artists f ON f.name_lower = a.artist_lower
       WHERE a.release_date >= ?
       ORDER BY a.release_date, a.artist_lower, a.album`
    )
    .bind(today)
    .all();

  return results.map((r) => ({
    id: r.id,
    artist: r.artist,
    album: r.album,
    releaseDate: r.release_date,
    genre: r.genre,
    label: r.label,
    followed: Boolean(r.followed),
    isNew: r.first_seen_at > nowMs - NEW_FOR_MS,
    added: r.added_at !== null
  }));
}
