import prompts from 'prompts';
import path from 'path';
import fs from 'fs';
import { getUpcomingAlbums } from './scraper.js';
import { generateICS, parseWikiDate } from './calendar.js';
import { getCredentials, syncFollowedArtists } from './spotify.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

async function main() {
  console.log('=============================================');
  console.log('      Spotify Album Tracker CLI 🎵           ');
  console.log('=============================================\n');

  const creds = getCredentials();
  let followedArtists = creds.followedArtists || [];
  const isSpotifyConfigured = creds.clientId && creds.clientSecret;

  if (isSpotifyConfigured) {
    if (!creds.refreshToken) {
      console.log('Spotify credentials detected but you are not logged in.');
      console.log('Run `npm run login` to authenticate with Spotify to highlight followed artists.\n');
    } else {
      try {
        // Try refreshing and syncing followed artists to keep the cache fresh
        followedArtists = await syncFollowedArtists();
        console.log(`Synced followed artists. Found ${followedArtists.length} followed artists.\n`);
      } catch (err) {
        console.log(`⚠️  Could not sync Spotify followed artists: ${err.message}`);
        console.log('Using cached followed artists instead.\n');
      }
    }
  } else {
    console.log('💡 Tip: Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env');
    console.log('to automatically highlight and pre-select your followed artists!\n');
  }

  const followedSet = new Set(followedArtists.map(a => a.name.toLowerCase()));

  // Calculate current and next month
  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYear = now.getFullYear();

  const currentMonth = MONTH_NAMES[currentMonthIdx];
  const nextMonthIdx = (currentMonthIdx + 1) % 12;
  const nextMonthYear = currentMonthIdx === 11 ? currentYear + 1 : currentYear;
  const nextMonth = MONTH_NAMES[nextMonthIdx];

  console.log(`📅 Loading releases for ${currentMonth} ${currentYear} and ${nextMonth} ${nextMonthYear}...`);

  let currentAlbums = [];
  let nextAlbums = [];

  try {
    currentAlbums = await getUpcomingAlbums(currentMonth, currentYear);
    console.log(`✓ Fetched ${currentAlbums.length} albums for ${currentMonth}`);
  } catch (err) {
    console.error(`❌ Error fetching ${currentMonth} albums:`, err.message);
  }

  try {
    nextAlbums = await getUpcomingAlbums(nextMonth, nextMonthYear);
    console.log(`✓ Fetched ${nextAlbums.length} albums for ${nextMonth}`);
  } catch (err) {
    console.error(`❌ Error fetching ${nextMonth} albums:`, err.message);
  }

  const allAlbums = [...currentAlbums, ...nextAlbums];

  if (allAlbums.length === 0) {
    console.log('\nNo upcoming albums found. Exiting.');
    return;
  }

  // Cross-reference with followed artists and sort
  const enrichedAlbums = allAlbums.map(album => {
    const isFollowed = followedSet.has(album.artist.toLowerCase());
    return {
      ...album,
      isFollowed,
      // Keep track of release year for ICS generation
      year: album.date.toLowerCase().includes(currentMonth.toLowerCase()) ? currentYear : nextMonthYear
    };
  });

  // Sort: Followed artists first, then chronological order
  // Chronological sorting helper: parse day from "Month Day" (e.g. "July 15")
  const getDay = (dateStr) => {
    const m = dateStr.match(/\d+/);
    return m ? parseInt(m[0], 10) : 999;
  };

  enrichedAlbums.sort((a, b) => {
    if (a.isFollowed && !b.isFollowed) return -1;
    if (!a.isFollowed && b.isFollowed) return 1;
    
    // Sort by year first
    if (a.year !== b.year) return a.year - b.year;

    // Then sort by month order
    const aMonthIdx = MONTH_NAMES.findIndex(m => a.date.includes(m));
    const bMonthIdx = MONTH_NAMES.findIndex(m => b.date.includes(m));
    if (aMonthIdx !== bMonthIdx) return aMonthIdx - bMonthIdx;

    // Then sort by day
    return getDay(a.date) - getDay(b.date);
  });

  // Create choices for the terminal prompt
  const choices = enrichedAlbums.map(album => {
    const prefix = album.isFollowed ? '★ [Followed] ' : '';
    const title = `${prefix}${album.artist} - ${album.album} (${album.date})`;
    return {
      title,
      value: album,
      selected: album.isFollowed // Pre-select followed artists!
    };
  });

  console.log('\n--- INTERACTIVE SELECTION ---');
  console.log('Instructions:');
  console.log(' - Use UP / DOWN arrows to navigate');
  console.log(' - Press SPACE to select / deselect an album');
  console.log(' - Type letters to filter/search the list');
  console.log(' - Press ENTER to confirm and generate calendar');
  console.log('-----------------------------\n');

  const response = await prompts({
    type: 'autocompleteMultiselect',
    name: 'selectedAlbums',
    message: 'Select upcoming albums to add to calendar:',
    choices,
    min: 1,
    hint: '- Space to select. Type to filter. Enter to confirm.'
  });

  if (!response.selectedAlbums || response.selectedAlbums.length === 0) {
    console.log('\nNo albums selected. Exiting.');
    return;
  }

  const destinationPrompt = await prompts({
    type: 'select',
    name: 'destination',
    message: 'Select calendar destination:',
    choices: [
      { title: 'Local iCalendar file (.ics)', value: 'ics' },
      { title: 'Google Calendar (Sync Directly)', value: 'google' },
      { title: 'Outlook Calendar (Sync Directly)', value: 'outlook' }
    ]
  });

  if (!destinationPrompt.destination) {
    console.log('\nNo destination selected. Exiting.');
    return;
  }

  if (destinationPrompt.destination === 'ics') {
    const outputPath = path.resolve('albums.ics');
    console.log(`\nGenerating calendar with ${response.selectedAlbums.length} albums...`);

    try {
      // Generate the ICS file. Since albums can span two years (if run in December),
      // we use the stored year on each album object when formatting events.
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      
      const events = response.selectedAlbums.map(album => {
        const dates = parseWikiDate(album.date, album.year);
        if (!dates) return null;
        
        const sanitize = (str) => str.replace(/[^a-zA-Z0-9]/g, '');
        const uid = `${sanitize(album.artist)}-${sanitize(album.album)}-${dates.start}@spotify-album-tracker`;
        const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(`${album.artist} ${album.album}`)}`;

        const description = [
          `Artist: ${album.artist}`,
          `Album: ${album.album}`,
          album.genre ? `Genre: ${album.genre}` : '',
          album.label ? `Label: ${album.label}` : '',
          `Spotify Search: ${spotifySearchUrl}`
        ].filter(Boolean).join('\\n');

        return [
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${timestamp}`,
          `DTSTART;VALUE=DATE:${dates.start}`,
          `DTEND;VALUE=DATE:${dates.end}`,
          `SUMMARY:Album Drop: ${album.artist} - ${album.album}`,
          `DESCRIPTION:${description}`,
          `URL:${spotifySearchUrl}`,
          'END:VEVENT'
        ].join('\r\n');
      }).filter(Boolean);

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

      console.log(`\n🎉 Success! Calendar file created at:`);
      console.log(`👉 ${outputPath}`);
      console.log('\nHow to import into your calendar:');
      console.log(' - macOS: Double-click "albums.ics" to import into Apple Calendar.');
      console.log(' - Google Calendar: Go to Settings -> Import & export -> Select "albums.ics" and upload.');
    } catch (err) {
      console.error('❌ Failed to generate calendar:', err.message);
    }
  } else if (destinationPrompt.destination === 'google') {
    const { getGoogleCredentials, loginGoogle, getWritableCalendars, addGoogleCalendarEvent } = await import('./google-calendar.js');
    const googleCreds = getGoogleCredentials();
    const isGoogleConfigured = googleCreds.clientId && googleCreds.clientSecret;

    if (!isGoogleConfigured) {
      console.log('\n❌ Error: Google Calendar credentials not configured.');
      console.log('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.');
      console.log('Then run `pnpm run login-google` to authenticate.\n');
      return;
    }

    if (!googleCreds.refreshToken) {
      console.log('\nGoogle Calendar authentication is required.');
      try {
        await loginGoogle();
      } catch (err) {
        console.error('❌ Google Calendar authentication failed:', err.message);
        return;
      }
    }

    let calendars = [];
    try {
      calendars = await getWritableCalendars();
    } catch (err) {
      console.error('❌ Failed to fetch Google Calendars:', err.message);
      return;
    }

    if (calendars.length === 0) {
      console.log('\n❌ No writable calendars found in your Google Account.');
      return;
    }

    const calendarChoices = calendars.map(cal => ({
      title: `${cal.summary}${cal.primary ? ' (Primary)' : ''}`,
      value: cal.id
    }));

    const calendarPrompt = await prompts({
      type: 'select',
      name: 'calendarId',
      message: 'Select target Google Calendar:',
      choices: calendarChoices
    });

    if (!calendarPrompt.calendarId) {
      console.log('\nNo calendar selected. Exiting.');
      return;
    }

    const calendarId = calendarPrompt.calendarId;
    console.log(`\nAdding ${response.selectedAlbums.length} albums to Google Calendar...`);

    let successCount = 0;
    let duplicateCount = 0;
    let failCount = 0;

    for (const album of response.selectedAlbums) {
      try {
        const res = await addGoogleCalendarEvent(calendarId, album, album.year);
        if (res.status === 'success') {
          console.log(`✓ Added: ${album.artist} - ${album.album}`);
          successCount++;
        } else if (res.status === 'duplicate') {
          console.log(`- Already exists (skipped): ${album.artist} - ${album.album}`);
          duplicateCount++;
        }
      } catch (err) {
        console.error(`✗ Failed to add: ${album.artist} - ${album.album}:`, err.message);
        failCount++;
      }
    }

    console.log('\n=============================================');
    console.log('🎉 Google Calendar Sync Completed!');
    console.log(` - Successfully added: ${successCount}`);
    console.log(` - Already existed (skipped): ${duplicateCount}`);
    console.log(` - Failed: ${failCount}`);
    console.log('=============================================\n');
  } else if (destinationPrompt.destination === 'outlook') {
    const {
      getOutlookCredentials,
      loginOutlook,
      getWritableOutlookCalendars,
      addOutlookCalendarEvent
    } = await import('./outlook-calendar.js');
    const outlookCreds = getOutlookCredentials();
    const isOutlookConfigured = outlookCreds.clientId;

    if (!isOutlookConfigured) {
      console.log('\n❌ Error: Outlook Calendar credentials not configured.');
      console.log('Please set OUTLOOK_CLIENT_ID in your .env file.');
      console.log('Then run `pnpm run login-outlook` to authenticate.\n');
      return;
    }

    if (!outlookCreds.refreshToken) {
      console.log('\nOutlook Calendar authentication is required.');
      try {
        await loginOutlook();
      } catch (err) {
        console.error('❌ Outlook Calendar authentication failed:', err.message);
        return;
      }
    }

    let calendars = [];
    try {
      calendars = await getWritableOutlookCalendars();
    } catch (err) {
      console.error('❌ Failed to fetch Outlook Calendars:', err.message);
      return;
    }

    if (calendars.length === 0) {
      console.log('\n❌ No writable calendars found in your Outlook Account.');
      return;
    }

    const calendarChoices = calendars.map(cal => ({
      title: `${cal.summary}${cal.primary ? ' (Default)' : ''}`,
      value: cal.id
    }));

    const calendarPrompt = await prompts({
      type: 'select',
      name: 'calendarId',
      message: 'Select target Outlook Calendar:',
      choices: calendarChoices
    });

    if (!calendarPrompt.calendarId) {
      console.log('\nNo calendar selected. Exiting.');
      return;
    }

    const calendarId = calendarPrompt.calendarId;
    console.log(`\nAdding ${response.selectedAlbums.length} albums to Outlook Calendar...`);

    let successCount = 0;
    let duplicateCount = 0;
    let failCount = 0;

    for (const album of response.selectedAlbums) {
      try {
        const res = await addOutlookCalendarEvent(calendarId, album, album.year);
        if (res.status === 'success') {
          console.log(`✓ Added: ${album.artist} - ${album.album}`);
          successCount++;
        } else if (res.status === 'duplicate') {
          console.log(`- Already exists (skipped): ${album.artist} - ${album.album}`);
          duplicateCount++;
        }
      } catch (err) {
        console.error(`✗ Failed to add: ${album.artist} - ${album.album}:`, err.message);
        failCount++;
      }
    }

    console.log('\n=============================================');
    console.log('🎉 Outlook Calendar Sync Completed!');
    console.log(` - Successfully added: ${successCount}`);
    console.log(` - Already existed (skipped): ${duplicateCount}`);
    console.log(` - Failed: ${failCount}`);
    console.log('=============================================\n');
  }
}

main().catch(err => {
  console.error('Unexpected CLI error:', err);
});
