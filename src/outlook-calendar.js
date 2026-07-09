import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import open from 'open';
import dotenv from 'dotenv';
import { parseWikiDate } from './calendar.js';

dotenv.config();

const OUTLOOK_AUTH_FILE = path.resolve('.outlook-auth.json');
const REDIRECT_PORT = 8890;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const OUTLOOK_SCOPES = [
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite'
].join(' ');

export function getOutlookCredentials() {
  const envCreds = {
    clientId: process.env.OUTLOOK_CLIENT_ID,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
    tenantId: process.env.OUTLOOK_TENANT_ID
  };

  let savedAuth = {};
  if (fs.existsSync(OUTLOOK_AUTH_FILE)) {
    try {
      savedAuth = JSON.parse(fs.readFileSync(OUTLOOK_AUTH_FILE, 'utf-8'));
    } catch (e) {
      // Ignore malformed local auth cache.
    }
  }

  return {
    clientId: envCreds.clientId || savedAuth.clientId,
    clientSecret: envCreds.clientSecret || savedAuth.clientSecret,
    tenantId: envCreds.tenantId || savedAuth.tenantId,
    accessToken: savedAuth.accessToken,
    refreshToken: savedAuth.refreshToken,
    expiresAt: savedAuth.expiresAt
  };
}

function getAuthBaseUrl(creds) {
  return `https://login.microsoftonline.com/${creds.tenantId || 'common'}/oauth2/v2.0`;
}

export function saveOutlookCredentials(data) {
  const current = getOutlookCredentials();
  const updated = { ...current, ...data };
  fs.writeFileSync(OUTLOOK_AUTH_FILE, JSON.stringify(updated, null, 2), 'utf-8');
}

function buildTokenParams(creds, params) {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    ...params
  });

  if (creds.clientSecret) {
    body.set('client_secret', creds.clientSecret);
  }

  return body;
}

export async function refreshOutlookAccessToken() {
  const creds = getOutlookCredentials();
  if (!creds.refreshToken || !creds.clientId) {
    throw new Error('Outlook is not logged in or client credentials are missing.');
  }

  if (creds.expiresAt && Date.now() < creds.expiresAt - 300000) {
    return creds.accessToken;
  }

  const authBaseUrl = getAuthBaseUrl(creds);
  const response = await fetch(`${authBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: buildTokenParams(creds, {
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
      scope: OUTLOOK_SCOPES
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh Outlook access token: ${errText}`);
  }

  const data = await response.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  saveOutlookCredentials({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken,
    expiresAt
  });

  return data.access_token;
}

export async function loginOutlook() {
  const creds = getOutlookCredentials();
  if (!creds.clientId) {
    console.error('\nError: OUTLOOK_CLIENT_ID must be set in your .env file.');
    console.error('Please refer to .env.example to set up your Microsoft Graph credentials.\n');
    throw new Error('Outlook credentials missing in .env');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authBaseUrl = getAuthBaseUrl(creds);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        const returnedState = reqUrl.searchParams.get('state');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Outlook Authentication Failed</h1><p>' + error + '</p>');
          server.close();
          reject(new Error(error));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Outlook Authentication Failed</h1><p>Invalid state parameter.</p>');
          server.close();
          reject(new Error('Invalid Outlook OAuth state parameter'));
          return;
        }

        try {
          const tokenRes = await fetch(`${authBaseUrl}/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: buildTokenParams(creds, {
              code,
              redirect_uri: REDIRECT_URI,
              grant_type: 'authorization_code',
              scope: OUTLOOK_SCOPES
            })
          });

          if (!tokenRes.ok) {
            throw new Error(`Outlook token exchange failed: ${await tokenRes.text()}`);
          }

          const data = await tokenRes.json();
          saveOutlookCredentials({
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            tenantId: creds.tenantId,
            accessToken: data.access_token,
            refreshToken: data.refresh_token || creds.refreshToken,
            expiresAt: Date.now() + data.expires_in * 1000
          });

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #121212; color: #ffffff;">
                <h1 style="color: #0078D4;">Outlook Calendar Successfully Authenticated!</h1>
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
      const authUrl = `${authBaseUrl}/authorize?` + new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: OUTLOOK_SCOPES,
        response_mode: 'query',
        state
      }).toString();

      console.log('\nOpening Outlook login in your browser...');
      console.log(`URL: ${authUrl}\n`);
      open(authUrl);
    });
  });
}

export async function getWritableOutlookCalendars() {
  const token = await refreshOutlookAccessToken();

  const response = await fetch(`${GRAPH_BASE_URL}/me/calendars?$select=id,name,canEdit,isDefaultCalendar`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Outlook calendars: ${await response.text()}`);
  }

  const data = await response.json();
  return (data.value || [])
    .filter(item => item.canEdit !== false)
    .map(item => ({
      id: item.id,
      summary: item.name,
      primary: item.isDefaultCalendar || false
    }));
}

function toGraphDate(date) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function buildAlbumEvent(album, dates, transactionId) {
  const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(`${album.artist} ${album.album}`)}`;

  return {
    subject: `Album Drop: ${album.artist} - ${album.album}`,
    body: {
      contentType: 'Text',
      content: [
        `Artist: ${album.artist}`,
        `Album: ${album.album}`,
        album.genre ? `Genre: ${album.genre}` : '',
        album.label ? `Label: ${album.label}` : '',
        `Spotify Search: ${spotifySearchUrl}`
      ].filter(Boolean).join('\n')
    },
    isAllDay: true,
    start: {
      dateTime: `${toGraphDate(dates.start)}T00:00:00`,
      timeZone: 'UTC'
    },
    end: {
      dateTime: `${toGraphDate(dates.end)}T00:00:00`,
      timeZone: 'UTC'
    },
    transactionId,
    categories: ['Album Tracker']
  };
}

async function findExistingOutlookEvent(token, calendarId, eventBody) {
  const params = new URLSearchParams({
    startDateTime: eventBody.start.dateTime,
    endDateTime: eventBody.end.dateTime,
    '$select': 'id,subject,isAllDay'
  });

  const response = await fetch(`${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Prefer': 'outlook.timezone="UTC"'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to check Outlook calendar for duplicates: ${await response.text()}`);
  }

  const data = await response.json();
  return (data.value || []).some(event =>
    event.subject === eventBody.subject && event.isAllDay === true
  );
}

export async function addOutlookCalendarEvent(calendarId, album, year) {
  const token = await refreshOutlookAccessToken();
  const dates = parseWikiDate(album.date, year);
  if (!dates) {
    throw new Error(`Invalid date format for album: ${album.artist} - ${album.album}`);
  }

  const hashSource = `${album.artist.toLowerCase()}-${album.album.toLowerCase()}-${toGraphDate(dates.start)}`;
  const transactionId = crypto.createHash('sha256').update(hashSource).digest('hex');
  const eventBody = buildAlbumEvent(album, dates, transactionId);

  if (await findExistingOutlookEvent(token, calendarId, eventBody)) {
    return { status: 'duplicate' };
  }

  const response = await fetch(`${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'outlook.timezone="UTC"'
    },
    body: JSON.stringify(eventBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Outlook Calendar API Error: ${errText}`);
  }

  return { status: 'success' };
}

const args = process.argv.slice(2);
if (args.includes('--login')) {
  loginOutlook().then(() => {
    console.log('Outlook Calendar login successful! Syncing calendar list...');
    return getWritableOutlookCalendars();
  }).then((calendars) => {
    console.log(`Successfully connected! Found ${calendars.length} writable calendars:\n`);
    calendars.forEach(c => console.log(` - ${c.summary} (${c.primary ? 'Default' : c.id})`));
    console.log('\nOutlook Calendar sync is fully configured!\n');
    process.exit(0);
  }).catch(err => {
    console.error('Outlook login failed:', err.message);
    process.exit(1);
  });
}
