import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareByReleaseDate,
  buildTopArtistRankMap,
  buildSuggestions,
  sortAlphabeticallyByArtist
} from './suggestions.js';

function album(overrides) {
  return {
    artist: 'Artist',
    album: 'Album',
    date: 'January 1',
    isFollowed: false,
    year: 2026,
    ...overrides
  };
}

test('compareByReleaseDate sorts by year, then month, then day', () => {
  const albums = [
    album({ artist: 'C', date: 'March 1', year: 2026 }),
    album({ artist: 'A', date: 'January 15', year: 2026 }),
    album({ artist: 'B', date: 'January 2', year: 2025 })
  ];

  const sorted = [...albums].sort(compareByReleaseDate);

  assert.deepEqual(sorted.map(a => a.artist), ['B', 'A', 'C']);
});

test('buildTopArtistRankMap lowercases artist names and preserves rank', () => {
  const rankMap = buildTopArtistRankMap([
    { name: 'Radiohead', rank: 1 },
    { name: 'Björk', rank: 2 }
  ]);

  assert.equal(rankMap.get('radiohead'), 1);
  assert.equal(rankMap.get('björk'), 2);
  assert.equal(rankMap.size, 2);
});

test('buildSuggestions returns all followed albums sorted by release date when 10 or fewer', () => {
  const followedAlbums = [
    album({ artist: 'Late', date: 'January 20' }),
    album({ artist: 'Early', date: 'January 5' })
  ];

  const suggestions = buildSuggestions(followedAlbums, new Map());

  assert.deepEqual(suggestions.map(a => a.artist), ['Early', 'Late']);
});

test('buildSuggestions does not pad when there are fewer than 10 followed albums', () => {
  const followedAlbums = [album({ artist: 'Only One', date: 'January 5' })];

  const suggestions = buildSuggestions(followedAlbums, new Map());

  assert.equal(suggestions.length, 1);
});

test('buildSuggestions ranks by top-artist position before falling back to release date, capped at 10', () => {
  const followedAlbums = [
    album({ artist: 'Unranked A', date: 'January 1' }),
    album({ artist: 'Unranked B', date: 'January 2' }),
    album({ artist: 'Unranked C', date: 'January 3' }),
    album({ artist: 'Unranked D', date: 'January 4' }),
    album({ artist: 'Unranked E', date: 'January 5' }),
    album({ artist: 'Unranked F', date: 'January 6' }),
    album({ artist: 'Unranked G', date: 'January 7' }),
    album({ artist: 'Ranked Low', date: 'January 8' }),
    album({ artist: 'Ranked High', date: 'January 9' }),
    album({ artist: 'Unranked H', date: 'January 10' }),
    album({ artist: 'Unranked I', date: 'January 11' })
  ];
  const topArtistRankMap = buildTopArtistRankMap([
    { name: 'Ranked Low', rank: 50 },
    { name: 'Ranked High', rank: 1 }
  ]);

  const suggestions = buildSuggestions(followedAlbums, topArtistRankMap);

  assert.equal(suggestions.length, 10);
  assert.deepEqual(suggestions.slice(0, 2).map(a => a.artist), ['Ranked High', 'Ranked Low']);
  assert.deepEqual(
    suggestions.slice(2).map(a => a.artist),
    ['Unranked A', 'Unranked B', 'Unranked C', 'Unranked D', 'Unranked E', 'Unranked F', 'Unranked G', 'Unranked H']
  );
});

test('sortAlphabeticallyByArtist sorts by artist name, then tiebreaks by album title', () => {
  const albums = [
    album({ artist: 'Radiohead', album: 'Zzz' }),
    album({ artist: 'ABBA', album: 'Only Album' }),
    album({ artist: 'Radiohead', album: 'Aaa' })
  ];

  const sorted = sortAlphabeticallyByArtist(albums);

  assert.deepEqual(
    sorted.map(a => `${a.artist}-${a.album}`),
    ['ABBA-Only Album', 'Radiohead-Aaa', 'Radiohead-Zzz']
  );
});

test('sortAlphabeticallyByArtist is case-insensitive on artist name', () => {
  const albums = [
    album({ artist: 'the National', album: 'Zzz' }),
    album({ artist: 'beyoncé', album: 'Bbb' }),
    album({ artist: 'Beyoncé', album: 'Aaa' })
  ];

  const sorted = sortAlphabeticallyByArtist(albums);

  assert.deepEqual(
    sorted.map(a => `${a.artist}-${a.album}`),
    ['beyoncé-Bbb', 'Beyoncé-Aaa', 'the National-Zzz']
  );
});
