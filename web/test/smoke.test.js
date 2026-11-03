import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { parseWikiDate } from '../../src/calendar.js';
import { getUpcomingAlbums } from '../../src/scraper.js';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

test('calendar.js helpers load in workerd', () => {
  expect(parseWikiDate('November 6', 2026).startISO).toBe('2026-11-06');
});

test('scraper.js (and cheerio) load in workerd', () => {
  expect(typeof getUpcomingAlbums).toBe('function');
});

test('WebCrypto supports MD5 and matches the CLI event id', async () => {
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode('tool-new lp-2026-11-06'));
  expect(hex(digest)).toBe('3022de89cdaba1b64b5366b86565d6d3');
});

test('the migration is applied to the test D1 database', async () => {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM albums').first();
  expect(row).toEqual({ n: 0 });
});
