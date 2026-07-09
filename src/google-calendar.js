import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import open from 'open';
import dotenv from 'dotenv';
import { parseWikiDate } from './calendar.js';

dotenv.config();

const GOOGLE_AUTH_FILE = path.resolve('.google-auth.json');
const REDIRECT_PORT = 8889;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

/**
 * Loads Google auth tokens and credentials from config or env.
 */
export function getGoogleCredentials() {
  const envCreds = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };

  let savedAuth = {};
  if (fs.existsSync(GOOGLE_AUTH_FILE)) {
    try {
      savedAuth = JSON.parse(fs.readFileSync(GOOGLE_AUTH_FILE, 'utf-8'));
    } catch (e) {
      // Ignore
    }
  }

  return {
    clientId: envCreds.clientId || savedAuth.clientId,
    clientSecret: envCreds.clientSecret || savedAuth.clientSecret,
    accessToken: savedAuth.accessToken,
    refreshToken: savedAuth.refreshToken,
    expiresAt: savedAuth.expiresAt
  };
}

/**
 * Saves Google auth config.
 */
export function saveGoogleCredentials(data) {
  const current = getGoogleCredentials();
  const updated = { ...current, ...data };
  fs.writeFileSync(GOOGLE_AUTH_FILE, JSON.stringify(updated, null, 2), 'utf-8');
}

/**
 * Refreshes Google access token if expired.
 */
export async function refreshGoogleAccessToken() {
  const creds = getGoogleCredentials();
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
    throw new Error('Google is not logged in or client credentials are missing.');
  }

  // Token is still valid (5-minute buffer)
  if (creds.expiresAt && Date.now() < creds.expiresAt - 300000) {
    return creds.accessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh Google access token: ${errText}`);
  }

  const data = await response.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  saveGoogleCredentials({
    accessToken: data.access_token,
    expiresAt
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

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Google Authentication Failed</h1><p>' + error + '</p>');
          server.close();
          reject(new Error(error));
          return;
        }

        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              code,
              client_id: creds.clientId,
              client_secret: creds.clientSecret,
              redirect_uri: REDIRECT_URI,
              grant_type: 'authorization_code'
            })
          });

          if (!tokenRes.ok) {
            throw new Error(`Google token exchange failed: ${await tokenRes.text()}`);
          }

          const data = await tokenRes.json();
          saveGoogleCredentials({
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            accessToken: data.access_token,
            refreshToken: data.refresh_token || creds.refreshToken,
            expiresAt: Date.now() + data.expires_in * 1000
          });

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #121212; color: #ffffff;">
                <h1 style="color: #4285F4;">Google Calendar Successfully Authenticated!</h1>
                <p>You can now close this window and return to your terminal.</p>
              </body>
            </html>
          `);
          
          server.close();
          resolve();
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<h1>Internal Server Error</h1><p>' + err.message + '</p>');
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(REDIRECT_PORT, () => {
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
        access_type: 'offline',
        prompt: 'consent' // Forces Google to provide a refresh_token
      }).toString();

      console.log('\nOpening Google login in your browser...');
      console.log(`URL: ${authUrl}\n`);
      open(authUrl);
    });
  });
}

/**
 * Fetches writeable calendars from the user's account.
 */
export async function getWritableCalendars() {
  const token = await refreshGoogleAccessToken();
  
  const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google calendars: ${await response.text()}`);
  }

  const data = await response.json();
  // Filter for calendars where we have write access (owner or writer)
  return data.items
    .filter(item => item.accessRole === 'owner' || item.accessRole === 'writer')
    .map(item => ({
      id: item.id,
      summary: item.summary,
      primary: item.primary || false
    }));
}

/**
 * Adds an album event to the specified Google Calendar.
 * Prevents duplicates by creating a deterministic ID from artist, album and date.
 */
export async function addGoogleCalendarEvent(calendarId, album, year) {
  const token = await refreshGoogleAccessToken();
  const dates = parseWikiDate(album.date, year);
  if (!dates) {
    throw new Error(`Invalid date format for album: ${album.artist} - ${album.album}`);
  }

  // Format dates to YYYY-MM-DD for Google API
  const startISO = `${dates.start.slice(0, 4)}-${dates.start.slice(4, 6)}-${dates.start.slice(6, 8)}`;
  const endISO = `${dates.end.slice(0, 4)}-${dates.end.slice(4, 6)}-${dates.end.slice(6, 8)}`;

  // Generate a deterministic event ID compatible with Google Calendar rules [a-v0-9]
  // MD5 output is hex (0-9a-f), which matches the character restrictions.
  const hashSource = `${album.artist.toLowerCase()}-${album.album.toLowerCase()}-${startISO}`;
  const eventId = crypto.createHash('md5').update(hashSource).digest('hex');

  const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(`${album.artist} ${album.album}`)}`;

  const eventBody = {
    id: eventId,
    summary: `Album Drop: ${album.artist} - ${album.album}`,
    description: [
      `Artist: ${album.artist}`,
      `Album: ${album.album}`,
      album.genre ? `Genre: ${album.genre}` : '',
      album.label ? `Label: ${album.label}` : '',
      `Spotify Search: ${spotifySearchUrl}`
    ].filter(Boolean).join('\n'),
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

