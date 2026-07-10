import { MONTH_NAMES } from './calendar.js';

function getReleaseDay(dateStr) {
  const match = dateStr.match(/\d+/);
  return match ? parseInt(match[0], 10) : 999;
}

/**
 * Sorts albums chronologically: year, then month, then day.
 */
export function compareByReleaseDate(a, b) {
  if (a.year !== b.year) return a.year - b.year;

  const aMonthIdx = MONTH_NAMES.findIndex(m => a.date.includes(m));
  const bMonthIdx = MONTH_NAMES.findIndex(m => b.date.includes(m));
  if (aMonthIdx !== bMonthIdx) return aMonthIdx - bMonthIdx;

  return getReleaseDay(a.date) - getReleaseDay(b.date);
}

/**
 * Builds a lookup of artist name (lowercased) -> 1-based rank from Spotify's
 * long-term top-artists list. Artists absent from the source list are simply
 * absent from the map — callers treat that as "unranked".
 */
export function buildTopArtistRankMap(topArtists) {
  const rankMap = new Map();
  for (const artist of topArtists) {
    rankMap.set(artist.name.toLowerCase(), artist.rank);
  }
  return rankMap;
}

/**
 * Picks up to 10 albums to surface as suggestions, from a list the caller
 * has already filtered down to followed artists.
 *
 * - 10 or fewer: all of them, soonest release first. No padding.
 * - More than 10: artists with a known top-artist rank come first (best
 *   rank first), then unranked artists fill remaining slots by soonest
 *   release, until 10 total.
 */
export function buildSuggestions(followedAlbums, topArtistRankMap) {
  if (followedAlbums.length <= 10) {
    return [...followedAlbums].sort(compareByReleaseDate);
  }

  const ranked = [];
  const unranked = [];
  for (const album of followedAlbums) {
    const rank = topArtistRankMap.get(album.artist.toLowerCase());
    if (rank !== undefined) {
      ranked.push({ album, rank });
    } else {
      unranked.push(album);
    }
  }

  ranked.sort((a, b) => a.rank - b.rank);
  unranked.sort(compareByReleaseDate);

  return [...ranked.map(r => r.album), ...unranked].slice(0, 10);
}

/**
 * Sorts every album alphabetically by artist name for the full browse list.
 */
export function sortAlphabeticallyByArtist(albums) {
  return [...albums].sort((a, b) => {
    const artistCompare = a.artist.localeCompare(b.artist);
    if (artistCompare !== 0) return artistCompare;
    const albumCompare = a.album.localeCompare(b.album);
    if (albumCompare !== 0) return albumCompare;
    return compareByReleaseDate(a, b);
  });
}
