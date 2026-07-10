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

const OUTLOOK_AUTH_FILE = path.resolve('.outlook-auth.json');
const REDIRECT_PORT = 8890;
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const OUTLOOK_SCOPES = [
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite'
].join(' ');

export function getOutlookCredentials() {
  const savedAuth = readAuthFile(OUTLOOK_AUTH_FILE);

  return {
    clientId: process.env.OUTLOOK_CLIENT_ID || savedAuth.clientId,
    // Secrets live in .env only — the local auth file never stores them.
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
    tenantId: process.env.OUTLOOK_TENANT_ID || savedAuth.tenantId,
    accessToken: savedAuth.accessToken,
    refreshToken: savedAuth.refreshToken,
    expiresAt: savedAuth.expiresAt
  };
}

function getAuthBaseUrl(creds) {
  return `https://login.microsoftonline.com/${creds.tenantId || 'common'}/oauth2/v2.0`;
}

export function saveOutlookCredentials(data) {
  writeAuthFile(OUTLOOK_AUTH_FILE, data);
}

export async function refreshOutlookAccessToken() {
  const creds = getOutlookCredentials();
  if (!creds.refreshToken || !creds.clientId) {
    throw new Error('Outlook is not logged in or client credentials are missing.');
  }

  if (isTokenFresh(creds.expiresAt)) {
    return creds.accessToken;
  }

  const data = await requestToken(`${getAuthBaseUrl(creds)}/token`, buildTokenParams(creds, {
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
    scope: OUTLOOK_SCOPES
  }), 'Outlook');

  saveOutlookCredentials({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken,
    expiresAt: data.expiresAt
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

  const authBaseUrl = getAuthBaseUrl(creds);

  await authorizeViaBrowser({
    port: REDIRECT_PORT,
    providerName: 'Outlook Calendar',
    accentColor: '#0078D4',
    buildAuthUrl: ({ state, redirectUri }) =>
      `${authBaseUrl}/authorize?` + new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OUTLOOK_SCOPES,
        response_mode: 'query',
        state
      }).toString(),
    exchangeCode: async (code, redirectUri) => {
      const data = await requestToken(`${authBaseUrl}/token`, buildTokenParams(creds, {
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: OUTLOOK_SCOPES
      }), 'Outlook');

      saveOutlookCredentials({
        clientId: creds.clientId,
        tenantId: creds.tenantId,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || creds.refreshToken,
        expiresAt: data.expiresAt
      });

      return data;
    }
  });
}

export async function getWritableOutlookCalendars() {
  const token = await refreshOutlookAccessToken();
  const calendars = [];
  let url = `${GRAPH_BASE_URL}/me/calendars?$select=id,name,canEdit,isDefaultCalendar`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Outlook calendars: ${await response.text()}`);
    }

    const data = await response.json();
    calendars.push(...(data.value || [])
      .filter(item => item.canEdit !== false)
      .map(item => ({
        id: item.id,
        summary: item.name,
        primary: item.isDefaultCalendar || false
      })));
    url = data['@odata.nextLink'] || null;
  }

  return calendars;
}

function buildAlbumEvent(album, dates, transactionId) {
  const { summary, descriptionLines } = albumEventContent(album);

  return {
    subject: summary,
    body: {
      contentType: 'Text',
      content: descriptionLines.join('\n')
    },
    isAllDay: true,
    start: {
      dateTime: `${dates.startISO}T00:00:00`,
      timeZone: 'UTC'
    },
    end: {
      dateTime: `${dates.endISO}T00:00:00`,
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

  const hashSource = `${album.artist.toLowerCase()}-${album.album.toLowerCase()}-${dates.startISO}`;
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

  if (response.status === 409) {
    return { status: 'duplicate' };
  }

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
