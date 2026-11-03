import { expect, test } from 'vitest';
import { getUpcomingAlbums } from '../../src/scraper.js';
import { htmlPage, monthTable, stubFetch } from './helpers.js';

const BASE_2026 = 'https://en.wikipedia.org/wiki/List_of_2026_albums';
const JAN_JUN_2026 = `${BASE_2026}_(January%E2%80%93June)`;
const JUL_DEC_2026 = `${BASE_2026}_(July%E2%80%93December)`;
const BASE_2025 = 'https://en.wikipedia.org/wiki/List_of_2025_albums';

const notFound = () => new Response('missing', { status: 404 });

// Serves `pages` (url -> table HTML array) and 404s everything else.
const serve = (pages) =>
  stubFetch((url) => (pages[url] ? htmlPage(...pages[url]) : notFound()));

const stubPage = htmlPage(); // a Wikipedia page with no tables, like the 2026 stub

test('a July–December month fetches only the July–December page', async () => {
  const calls = serve({
    [BASE_2026]: [],
    [JAN_JUN_2026]: [monthTable('March', 2026, [['March 6', 'Wrong', 'Page']])],
    [JUL_DEC_2026]: [monthTable('November', 2026, [['November 6', 'Tool', 'New LP', 'Prog', 'RCA']])]
  });

  const albums = await getUpcomingAlbums('November', 2026);

  expect(calls.map((c) => c.url)).toEqual([JUL_DEC_2026]);
  expect(albums).toEqual([{ date: 'November 6', artist: 'Tool', album: 'New LP', genre: 'Prog', label: 'RCA' }]);
});

test('a January–June month fetches only the January–June page', async () => {
  const calls = serve({
    [JAN_JUN_2026]: [monthTable('March', 2026, [['March 6', 'Tool', 'New LP']])],
    [JUL_DEC_2026]: [monthTable('November', 2026, [['November 6', 'Wrong', 'Page']])]
  });

  const albums = await getUpcomingAlbums('March', 2026);

  expect(calls.map((c) => c.url)).toEqual([JAN_JUN_2026]);
  expect(albums.map((a) => a.artist)).toEqual(['Tool']);
});

test('a year that is not split falls back to the plain page', async () => {
  const calls = serve({
    [BASE_2025]: [monthTable('October', 2025, [['October 3', 'Abba', 'Voyage']])]
  });

  const albums = await getUpcomingAlbums('October', 2025);

  expect(calls.map((c) => c.url)).toEqual([`${BASE_2025}_(July%E2%80%93December)`, BASE_2025]);
  expect(albums.map((a) => a.artist)).toEqual(['Abba']);
});

test('falls back to the plain page when the expected half-year page lacks the month', async () => {
  const calls = stubFetch((url) => {
    if (url === JUL_DEC_2026) return stubPage.clone();
    if (url === BASE_2026) return htmlPage(monthTable('November', 2026, [['November 6', 'Tool', 'New LP']]));
    return notFound();
  });

  const albums = await getUpcomingAlbums('November', 2026);

  expect(calls.map((c) => c.url)).toEqual([JUL_DEC_2026, BASE_2026]);
  expect(albums.map((a) => a.artist)).toEqual(['Tool']);
});

test('returns nothing, after trying every page, when no page has the month', async () => {
  const calls = serve({});
  expect(await getUpcomingAlbums('November', 2026)).toEqual([]);
  expect(calls.map((c) => c.url)).toEqual([JUL_DEC_2026, BASE_2026, JAN_JUN_2026]);
});

test('a server error from Wikipedia is thrown, not treated as an empty month', async () => {
  stubFetch(() => new Response('down', { status: 500, statusText: 'Internal Server Error' }));
  await expect(getUpcomingAlbums('November', 2026)).rejects.toThrow(/Failed to fetch Wikipedia page/);
});
