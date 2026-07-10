import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { parseWikiDate, albumEventContent } from './calendar.js';
import {
  authorizeViaBrowser,
  buildTokenParams,
  isTokenFresh,
  readAuthFile,
  requestToken,
  writeAuthFile
} from './oauth.js';

dotenv.config();

const GOOGLE_AUTH_FILE = path.resolve('.google-auth.json');
const REDIRECT_PORT = 8889;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Loads Google auth tokens and credentials from config or env.
 */
export function getGoogleCredentials() {
  const savedAuth = readAuthFile(GOOGLE_AUTH_FILE);

  return {
    clientId: process.env.GOOGLE_CLIENT_ID || savedAuth.clientId,
    // Secrets live in .env only — the local auth file never stores them.
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    accessToken: savedAuth.accessToken,
    refreshToken: savedAuth.refreshToken,
    expiresAt: savedAuth.expiresAt
  };
}

/**
 * Saves Google auth config.
 */
export function saveGoogleCredentials(data) {
  writeAuthFile(GOOGLE_AUTH_FILE, data);
}

/**
 * Refreshes Google access token if expired.
 */
export async function refreshGoogleAccessToken() {
  const creds = getGoogleCredentials();
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
    throw new Error('Google is not logged in or client credentials are missing.');
  }

  if (isTokenFresh(creds.expiresAt)) {
    return creds.accessToken;
  }

  const data = await requestToken(TOKEN_URL, buildTokenParams(creds, {
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token'
  }), 'Google');

  saveGoogleCredentials({
    accessToken: data.access_token,
    expiresAt: data.expiresAt
  });

  return data.access_token;
}

/**
 * Runs a local server to handle Google OAuth callback.
 */
export async function loginGoogle() {
  const creds = getGoogleCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    console.error('\nError: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in your .env file.');
    console.error('Please refer to .env.example to set up your Google API credentials.\n');
    throw new Error('Google credentials missing in .env');
  }

  await authorizeViaBrowser({
    port: REDIRECT_PORT,
    providerName: 'Google Calendar',
    accentColor: '#4285F4',
    buildAuthUrl: ({ state, redirectUri }) =>
      'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
        access_type: 'offline',
        prompt: 'consent', // Forces Google to provide a refresh_token
        state
      }).toString(),
    exchangeCode: async (code, redirectUri) => {
      const data = await requestToken(TOKEN_URL, buildTokenParams(creds, {
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }), 'Google');

      saveGoogleCredentials({
        clientId: creds.clientId,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || creds.refreshToken,
        expiresAt: data.expiresAt
      });

      return data;
    }
  });
}

/**
 * Fetches writeable calendars from the user's account, following pagination.
 */
export async function getWritableCalendars() {
  const token = await refreshGoogleAccessToken();
  const calendars = [];
  let pageToken;

  do {
    const params = new URLSearchParams(pageToken ? { pageToken } : {});
    const response = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Google calendars: ${await response.text()}`);
    }

    const data = await response.json();
    // Filter for calendars where we have write access (owner or writer)
    calendars.push(...(data.items || [])
      .filter(item => item.accessRole === 'owner' || item.accessRole === 'writer')
      .map(item => ({
        id: item.id,
        summary: item.summary,
        primary: item.primary || false
      })));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return calendars;
}

/**
 * Adds an album event to the specified Google Calendar.
 * Prevents duplicates by creating a deterministic ID from artist, album and date.
 */
export async function addGoogleCalendarEvent(calendarId, album) {
  const token = await refreshGoogleAccessToken();
  const dates = parseWikiDate(album.date, album.year);
  if (!dates) {
    throw new Error(`Invalid date format for album: ${album.artist} - ${album.album}`);
  }

  const startISO = dates.startISO;
  const endISO = dates.endISO;

  // Generate a deterministic event ID compatible with Google Calendar rules [a-v0-9]
  // MD5 output is hex (0-9a-f), which matches the character restrictions.
  const hashSource = `${album.artist.toLowerCase()}-${album.album.toLowerCase()}-${startISO}`;
  const eventId = crypto.createHash('md5').update(hashSource).digest('hex');

  const { summary, spotifySearchUrl, descriptionLines } = albumEventContent(album);

  const eventBody = {
    id: eventId,
    summary,
    description: descriptionLines.join('\n'),
    start: {
      date: startISO
    },
    end: {
      date: endISO
    },
    source: {
      title: 'Spotify Search',
      url: spotifySearchUrl
    }
  };

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventBody)
  });

  if (response.status === 409) {
    // 409 Conflict: Event already exists, which means we successfully de-duplicated
    return { status: 'duplicate' };
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Calendar API Error: ${errText}`);
  }

  return { status: 'success' };
}

// Support running login directly from the npm/pnpm script
const args = process.argv.slice(2);
if (args.includes('--login')) {
  loginGoogle().then(() => {
    console.log('Google Calendar login successful! Syncing calendar list...');
    return getWritableCalendars();
  }).then((calendars) => {
    console.log(`Successfully connected! Found ${calendars.length} writable calendars:\n`);
    calendars.forEach(c => console.log(` - ${c.summary} (${c.primary ? 'Primary' : c.id})`));
    console.log('\nGoogle Calendar personalization is fully configured!\n');
    process.exit(0);
  }).catch(err => {
    console.error('Google login failed:', err.message);
    process.exit(1);
  });
}

