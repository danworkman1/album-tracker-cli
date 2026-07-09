import fs from 'fs';
import path from 'path';

/**
 * Parses Wikipedia's date text (e.g. "January 1") and returns start and end strings in YYYYMMDD format.
 * @param {string} dateStr - Date string from scraper
 * @param {number} year - Release year
 * @returns {{start: string, end: string}|null}
 */
export function parseWikiDate(dateStr, year) {
  if (!dateStr) return null;
  
  // Extract month and day (e.g., "January 1" or "January 15")
  // Wikipedia date headers can contain references or extra text, so we clean it up
  const match = dateStr.match(/([A-Za-z]+)\s+(\d+)/);
  if (!match) return null;

  const monthName = match[1];
  const day = parseInt(match[2], 10);
  
  const monthMap = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };
  
  const monthIndex = monthMap[monthName.toLowerCase()];
  if (monthIndex === undefined || isNaN(day)) return null;

  const startDate = new Date(year, monthIndex, day);
  // All-day events in ICS require the end date to be the day after (exclusive)
  const endDate = new Date(year, monthIndex, day + 1);

  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  };

  return {
    start: formatDate(startDate),
    end: formatDate(endDate)
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
