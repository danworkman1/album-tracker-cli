import * as cheerio from 'cheerio';

/**
 * Scrapes Wikipedia for albums released in a specific month and year.
 * @param {string} monthName - E.g. "January", "February", etc.
 * @param {number} year - E.g. 2026
 * @returns {Promise<Array>} - Array of album objects: { date, artist, album, genre, label }
 */
export async function getUpcomingAlbums(monthName, year) {
  // Wikipedia splits busy years into half-year pages and turns the plain
  // "List of YYYY albums" page into a stub with no tables (2026 did this).
  // Try the plain page first, then the split pages, and use the first one
  // that has the month's table.
  const urls = [
    `https://en.wikipedia.org/wiki/List_of_${year}_albums`,
    `https://en.wikipedia.org/wiki/List_of_${year}_albums_(January%E2%80%93June)`,
    `https://en.wikipedia.org/wiki/List_of_${year}_albums_(July%E2%80%93December)`
  ];

  let $ = null;
  let targetTable = null;

  for (const url of urls) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SpotifyAlbumTrackerCLI/1.0 (danielworkman@example.com)'
      }
    });

    // A missing split page just means this year isn't split that way.
    if (response.status === 404) continue;
    if (!response.ok) {
      throw new Error(`Failed to fetch Wikipedia page: ${response.statusText}`);
    }

    $ = cheerio.load(await response.text());

    // Find the table whose caption contains the target month and year
    // E.g. "List of albums released in January 2026"
    $('table.wikitable').each((index, element) => {
      const captionText = $(element).find('caption').text().trim();
      if (captionText.toLowerCase().includes(`${monthName.toLowerCase()} ${year}`)) {
        targetTable = element;
      }
    });

    if (targetTable) break;
  }

  if (!targetTable) {
    return [];
  }

  const albums = [];
  let activeDate = '';

  // Parse rows of the matching table
  $(targetTable).find('tbody tr').each((index, tr) => {
    const row = $(tr);
    
    // Check if it's a header row
    const isHeader = row.find('th[scope="col"]').length > 0;
    if (isHeader) return;

    // Check if this row defines a new date
    const dateHeader = row.find('th[scope="row"]');
    if (dateHeader.length > 0) {
      // Extract date text (remove newlines and references)
      activeDate = dateHeader.text().replace(/\n/g, ' ').trim();
      // Clean up the date (e.g. "January 1" from "January\n1")
      activeDate = activeDate.replace(/\s+/g, ' ');
      // Insert space between month and day if missing (e.g., "July3" -> "July 3")
      activeDate = activeDate.replace(/([a-zA-Z]+)(\d+)/g, '$1 $2');
    }

    const tds = row.find('td');
    if (tds.length >= 2) {
      const artist = $(tds[0]).text().trim();
      const album = $(tds[1]).text().trim();
      const genre = tds[2] ? $(tds[2]).text().trim() : '';
      const label = tds[3] ? $(tds[3]).text().trim() : '';

      // Skip invalid rows
      if (!artist || !album) return;

      albums.push({
        date: activeDate || `${monthName} (Unknown Date)`,
        artist,
        album,
        genre,
        label
      });
    }
  });

  return albums;
}
