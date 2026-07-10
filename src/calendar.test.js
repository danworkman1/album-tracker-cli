import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseWikiDate, MONTH_NAMES, albumEventContent, generateICS } from './calendar.js';

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

test('generateICS writes one VEVENT per album using each album\'s own year', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ics-'));
  const outputPath = path.join(dir, 'albums.ics');

  generateICS([
    { artist: 'A', album: 'One', date: 'December 30', year: 2026 },
    { artist: 'B', album: 'Two', date: 'January 2', year: 2027 },
    { artist: 'C', album: 'Skipped', date: 'TBA', year: 2027 }
  ], outputPath);

  const ics = fs.readFileSync(outputPath, 'utf-8');
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261230'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20270102'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
});
