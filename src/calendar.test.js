import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiDate, MONTH_NAMES } from './calendar.js';

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
