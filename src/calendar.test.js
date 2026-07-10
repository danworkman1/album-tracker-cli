import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiDate, MONTH_NAMES, albumEventContent } from './calendar.js';

test('MONTH_NAMES is the single January-first month list', () => {
  assert.equal(MONTH_NAMES.length, 12);
  assert.equal(MONTH_NAMES[0], 'January');
  assert.equal(MONTH_NAMES[11], 'December');
});

test('parseWikiDate returns compact and ISO dates with an exclusive end', () => {
  assert.deepEqual(parseWikiDate('January 31', 2026), {
    start: '20260131',
    end: '20260201',
    startISO: '2026-01-31',
    endISO: '2026-02-01'
  });
});

test('parseWikiDate returns null for unparseable input', () => {
  assert.equal(parseWikiDate('TBA', 2026), null);
  assert.equal(parseWikiDate('', 2026), null);
  assert.equal(parseWikiDate('Notamonth 5', 2026), null);
});

test('albumEventContent builds summary, search URL and description lines', () => {
  const content = albumEventContent({ artist: 'Tool', album: 'New LP', genre: 'Prog', label: 'RCA' });

  assert.equal(content.summary, 'Album Drop: Tool - New LP');
  assert.equal(content.spotifySearchUrl, 'https://open.spotify.com/search/Tool%20New%20LP');
  assert.deepEqual(content.descriptionLines, [
    'Artist: Tool',
    'Album: New LP',
    'Genre: Prog',
    'Label: RCA',
    'Spotify Search: https://open.spotify.com/search/Tool%20New%20LP'
  ]);
});

test('albumEventContent omits missing genre and label', () => {
  const content = albumEventContent({ artist: 'Tool', album: 'New LP' });

  assert.deepEqual(content.descriptionLines, [
    'Artist: Tool',
    'Album: New LP',
    'Spotify Search: https://open.spotify.com/search/Tool%20New%20LP'
  ]);
});
