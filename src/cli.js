import prompts from 'prompts';
import path from 'path';
import { getUpcomingAlbums } from './scraper.js';
import { generateICS, MONTH_NAMES } from './calendar.js';
import { getCredentials, getCachedFollowedArtists, getCachedTopArtists, getFollowedArtistsSyncedAt, login, syncFollowedArtists, getTopArtists } from './spotify.js';
import { buildTopArtistRankMap, buildSuggestions, sortAlphabeticallyByArtist } from './suggestions.js';

// Followed artists are read from the local cache on boot; we only call
// Spotify again once the cache is older than this (or the user passes
// --refresh), which keeps normal startups fast and offline-friendly.
const SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function waitForEnter(message) {
  await prompts({
    type: 'text',
    name: 'continue',
    message
  });
}

/**
 * Everything destination-specific for the two direct-sync providers lives
 * here; setupSyncProvider and the sync loop below are provider-agnostic.
 */
const SYNC_PROVIDERS = {
  google: {
    label: 'Google Calendar',
    accountNoun: 'Google Account',
    primaryTag: 'Primary',
    envHint: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.',
    loginScript: 'pnpm run login-google',
    async load() {
      const m = await import('./google-calendar.js');
      const creds = m.getGoogleCredentials();
      return {
        isConfigured: Boolean(creds.clientId && creds.clientSecret),
        hasToken: Boolean(creds.refreshToken),
        login: m.loginGoogle,
        getCalendars: m.getWritableCalendars,
        addEvent: m.addGoogleCalendarEvent
      };
    }
  },
  outlook: {
    label: 'Outlook Calendar',
    accountNoun: 'Outlook Account',
    primaryTag: 'Default',
    envHint: 'Please set OUTLOOK_CLIENT_ID in your .env file.',
    loginScript: 'pnpm run login-outlook',
    async load() {
      const m = await import('./outlook-calendar.js');
      const creds = m.getOutlookCredentials();
      return {
        isConfigured: Boolean(creds.clientId),
        hasToken: Boolean(creds.refreshToken),
        login: m.loginOutlook,
        getCalendars: m.getWritableOutlookCalendars,
        addEvent: m.addOutlookCalendarEvent
      };
    }
  }
};

async function setupSyncProvider(key) {
  const def = SYNC_PROVIDERS[key];
  const provider = await def.load();

  if (!provider.isConfigured) {
    console.log(`\n❌ Error: ${def.label} credentials not configured.`);
    console.log(def.envHint);
    console.log(`Then run \`${def.loginScript}\` to authenticate.\n`);
    process.exit(1);
  }

  if (!provider.hasToken) {
    console.log(`\n${def.label} authentication is required.`);
    try {
      await provider.login();
      await waitForEnter(`${def.label} authentication successful. Press Enter to continue.`);
    } catch (err) {
      console.error(`❌ ${def.label} authentication failed:`, err.message);
      process.exit(1);
    }
  }

  let calendars = [];
  try {
    calendars = await provider.getCalendars();
  } catch (err) {
    console.error(`❌ Failed to fetch ${def.label}s:`, err.message);
    process.exit(1);
  }

  if (calendars.length === 0) {
    console.log(`\n❌ No writable calendars found in your ${def.accountNoun}.`);
    process.exit(1);
  }

  const calendarPrompt = await prompts({
    type: 'select',
    name: 'calendarId',
    message: `Select target ${def.label}:`,
    choices: calendars.map(cal => ({
      title: `${cal.summary}${cal.primary ? ` (${def.primaryTag})` : ''}`,
      value: cal.id
    }))
  });

  if (!calendarPrompt.calendarId) {
    console.log('\nNo calendar selected. Exiting.');
    process.exit(0);
  }

  return {
    destination: key,
    label: def.label,
    calendarId: calendarPrompt.calendarId,
    addEvent: provider.addEvent
  };
}

/**
 * Prompts for a calendar destination and completes any required auth/calendar
 * selection upfront, before the user has picked any albums. Exits the
 * process on setup failure or if the user backs out of a prompt.
 */
async function chooseCalendarDestination() {
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
    process.exit(0);
  }

  if (destinationPrompt.destination === 'ics') {
    return { destination: 'ics' };
  }

  return setupSyncProvider(destinationPrompt.destination);
}

async function main() {
  console.log('=============================================');
  console.log('      Spotify Album Tracker CLI 🎵           ');
  console.log('=============================================\n');

  const creds = getCredentials();
  const forceRefresh = process.argv.slice(2).includes('--refresh');
  let followedArtists = getCachedFollowedArtists();
  let topArtistRankMap = new Map();
  const isSpotifyConfigured = Boolean(creds.clientId);

  async function loadTopArtistRanks() {
    try {
      const topArtists = await getTopArtists();
      topArtistRankMap = buildTopArtistRankMap(topArtists);
    } catch (err) {
      if (err.status === 403) {
        console.log('⚠️  Spotify refused the top-artists request — run `pnpm run login` again to grant the new permission. Continuing without ranked suggestions.\n');
      } else {
        console.log(`⚠️  Could not fetch ranked top artists (${err.message}). Continuing without ranked suggestions.\n`);
      }
    }
  }

  if (isSpotifyConfigured) {
    if (!creds.refreshToken) {
      const spotifyPrompt = await prompts({
        type: 'confirm',
        name: 'connectSpotify',
        message: 'Spotify is configured. Connect now to highlight followed artists?',
        initial: true
      });

      if (spotifyPrompt.connectSpotify) {
        try {
          await login();
          await waitForEnter('Spotify authentication successful. Press Enter to continue.');
          followedArtists = await syncFollowedArtists();
          console.log(`Synced followed artists. Found ${followedArtists.length} followed artists.\n`);
          await loadTopArtistRanks();
        } catch (err) {
          console.log(`⚠️  Could not authenticate Spotify: ${err.message}`);
          console.log('Continuing without Spotify personalization.\n');
        }
      } else {
        console.log('Continuing without Spotify personalization.\n');
      }
    } else {
      const cacheAge = Date.now() - getFollowedArtistsSyncedAt();
      const cacheIsFresh = followedArtists.length > 0 && cacheAge < SYNC_MAX_AGE_MS;

      if (cacheIsFresh && !forceRefresh) {
        // Fast path: trust the local cache and skip Spotify entirely.
        topArtistRankMap = buildTopArtistRankMap(getCachedTopArtists());
        console.log(`Loaded ${followedArtists.length} followed artists from local cache. Run with --refresh to re-sync.\n`);
      } else {
        try {
          // Cache is stale (or forced): re-sync and refresh the local copy.
          followedArtists = await syncFollowedArtists();
          console.log(`Synced followed artists. Found ${followedArtists.length} followed artists.\n`);
          await loadTopArtistRanks();
        } catch (err) {
          console.log(`⚠️  Could not sync Spotify followed artists: ${err.message}`);
          console.log('Using cached followed artists instead.\n');
          topArtistRankMap = buildTopArtistRankMap(getCachedTopArtists());
        }
      }
    }
  } else {
    console.log('💡 Tip: Set SPOTIFY_CLIENT_ID in .env');
    console.log('to automatically highlight and pre-select your followed artists!\n');
  }

  const calendarChoice = await chooseCalendarDestination();

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

  // Cross-reference with followed artists
  const enrichedAlbums = allAlbums.map(album => {
    const isFollowed = followedSet.has(album.artist.toLowerCase());
    return {
      ...album,
      isFollowed,
      // Keep track of release year for ICS/calendar generation
      year: album.date.toLowerCase().includes(currentMonth.toLowerCase()) ? currentYear : nextMonthYear
    };
  });

  const followedAlbums = enrichedAlbums.filter(album => album.isFollowed);
  const suggestions = buildSuggestions(followedAlbums, topArtistRankMap);
  const fullList = sortAlphabeticallyByArtist(enrichedAlbums);

  // Followed artists get a leading star so they're easy to spot, but nothing
  // is pre-selected — every pick is an explicit choice by the user.
  const toChoice = (album) => ({
    title: `${album.isFollowed ? '★ ' : ''}${album.artist} - ${album.album} (${album.date})`,
    value: album
  });

  const choices = suggestions.length > 0
    ? [
        { title: '── Top 10 Suggestions ──', value: null, disabled: true },
        ...suggestions.map(toChoice),
        { title: '── Full List (A–Z) ──', value: null, disabled: true },
        ...fullList.map(toChoice)
      ]
    : fullList.map(toChoice);

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

  // Suggestions and the A-Z list share album object references for anything
  // that appears in both, so dedupe by reference before generating events.
  const selectedAlbums = [...new Set(response.selectedAlbums)].filter(Boolean);

  if (calendarChoice.destination === 'ics') {
    const outputPath = path.resolve('albums.ics');
    console.log(`\nGenerating calendar with ${selectedAlbums.length} albums...`);

    try {
      generateICS(selectedAlbums, outputPath);

      console.log(`\n🎉 Success! Calendar file created at:`);
      console.log(`👉 ${outputPath}`);
      console.log('\nHow to import into your calendar:');
      console.log(' - macOS: Double-click "albums.ics" to import into Apple Calendar.');
      console.log(' - Google Calendar: Go to Settings -> Import & export -> Select "albums.ics" and upload.');
    } catch (err) {
      console.error('❌ Failed to generate calendar:', err.message);
    }
  } else {
    const { label, calendarId, addEvent } = calendarChoice;
    console.log(`\nAdding ${selectedAlbums.length} albums to ${label}...`);

    let successCount = 0;
    let duplicateCount = 0;
    let failCount = 0;

    for (const album of selectedAlbums) {
      try {
        const res = await addEvent(calendarId, album);
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
    console.log(`🎉 ${label} Sync Completed!`);
    console.log(` - Successfully added: ${successCount}`);
    console.log(` - Already existed (skipped): ${duplicateCount}`);
    console.log(` - Failed: ${failCount}`);
    console.log('=============================================\n');
  }
}

main().catch(err => {
  console.error('Unexpected CLI error:', err);
});
