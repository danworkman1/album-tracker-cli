import fs from 'fs';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_INDEX = new Map(MONTH_NAMES.map((name, idx) => [name.toLowerCase(), idx]));

/**
 * Parses Wikipedia's date text (e.g. "January 1") and returns start/end
 * strings in both YYYYMMDD (ICS) and YYYY-MM-DD (Google/Graph) formats.
 * @param {string} dateStr - Date string from scraper
 * @param {number} year - Release year
 * @returns {{start: string, end: string, startISO: string, endISO: string}|null}
 */
export function parseWikiDate(dateStr, year) {
  if (!dateStr) return null;

  // Wikipedia date headers can contain references or extra text, so we clean it up
  const match = dateStr.match(/([A-Za-z]+)\s+(\d+)/);
  if (!match) return null;

  const monthIndex = MONTH_INDEX.get(match[1].toLowerCase());
  const day = parseInt(match[2], 10);
  if (monthIndex === undefined || isNaN(day)) return null;

  const startDate = new Date(year, monthIndex, day);
  // All-day events require the end date to be the day after (exclusive)
  const endDate = new Date(year, monthIndex, day + 1);

  const parts = (date) => [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ];

  return {
    start: parts(startDate).join(''),
    end: parts(endDate).join(''),
    startISO: parts(startDate).join('-'),
    endISO: parts(endDate).join('-')
  };
}

/**
 * Formats a single event to iCalendar string format.
 * @param {Object} event - Event details
 * @param {string} event.start - YYYYMMDD start
 * @param {string} event.end - YYYYMMDD end
 * @param {string} event.artist - Artist name
 * @param {string} event.album - Album name
 * @param {string} event.genre - Genre
 * @param {string} event.label - Record label
 * @param {string} timestamp - DTSTAMP value
 * @returns {string}
 */
function formatEvent({ start, end, artist, album, genre, label }, timestamp) {
  const sanitize = (str) => str.replace(/[^a-zA-Z0-9]/g, '');
  const uid = `${sanitize(artist)}-${sanitize(album)}-${start}@spotify-album-tracker`;
  const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${album}`)}`;

  const description = [
    `Artist: ${artist}`,
    `Album: ${album}`,
    genre ? `Genre: ${genre}` : '',
    label ? `Label: ${label}` : '',
    `Spotify Search: ${spotifySearchUrl}`
  ].filter(Boolean).join('\\n');

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${timestamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:Album Drop: ${artist} - ${album}`,
    `DESCRIPTION:${description}`,
    `URL:${spotifySearchUrl}`,
    'END:VEVENT'
  ].join('\r\n');
}

/**
 * Generates an .ics file from selected albums.
 * @param {Array} selectedAlbums - Selected album objects
 * @param {number} year - Release year
 * @param {string} outputPath - Output file path
 */
export function generateICS(selectedAlbums, year, outputPath) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const events = selectedAlbums
    .map(album => {
      const dates = parseWikiDate(album.date, year);
      if (!dates) return null;
      return formatEvent({ ...album, start: dates.start, end: dates.end }, timestamp);
    })
    .filter(Boolean);

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Spotify Album Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    events.join('\r\n'),
    'END:VCALENDAR'
  ].join('\r\n');

  fs.writeFileSync(outputPath, icsContent, 'utf-8');
}
