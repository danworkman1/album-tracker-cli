import { REMINDER_END_TIME, REMINDER_START_TIME, albumEventContent } from '../../src/calendar.js';
import { getAccessToken, requestToken } from './oauth.js';
import { loadRefreshToken, saveRefreshToken } from './store.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const tokenConfig = (env) => ({
  provider: 'google',
  providerName: 'Google',
  tokenUrl: TOKEN_URL,
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET
});

export function googleAuthUrl(env, { redirectUri, state }) {
  return (
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent', // Without this Google only hands out a refresh token the first time.
      state
    })
  );
}

export async function exchangeGoogleCode(env, { code, redirectUri }) {
  const data = await requestToken(
    TOKEN_URL,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET
    },
    'Google'
  );

  if (data.refresh_token) {
    await saveRefreshToken(env, 'google', data.refresh_token);
  } else if (!(await loadRefreshToken(env, 'google'))) {
    throw new Error('Google did not return a refresh token');
  }
}

/** Same event the CLI creates: a free 9am reminder on release day. */
export function buildEventBody({ id, artist, album, genre, label, releaseDate }, timeZone) {
  const { summary, spotifySearchUrl, descriptionLines } = albumEventContent({ artist, album, genre, label });
  return {
    id,
    summary,
    description: descriptionLines.join('\n'),
    start: { dateTime: `${releaseDate}T${REMINDER_START_TIME}`, timeZone },
    end: { dateTime: `${releaseDate}T${REMINDER_END_TIME}`, timeZone },
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    source: { title: 'Spotify Search', url: spotifySearchUrl }
  };
}

export async function addAlbumToCalendar(env, albumId) {
  const row = await env.DB.prepare(
    'SELECT id, artist, album, genre, label, release_date FROM albums WHERE id = ?'
  )
    .bind(albumId)
    .first();
  if (!row) {
    throw Object.assign(new Error('Album not found'), { code: 'not_found' });
  }

  const token = await getAccessToken(env, tokenConfig(env));
  const event = buildEventBody({ ...row, releaseDate: row.release_date }, env.TIMEZONE);

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }
  );

  // 409 means an event with this id already exists (a double click, or the CLI
  // added it), which is the outcome we wanted anyway.
  if (response.status !== 409 && !response.ok) {
    throw new Error(`Google Calendar API Error: ${await response.text()}`);
  }

  await env.DB.prepare('UPDATE albums SET added_at = COALESCE(added_at, ?) WHERE id = ?')
    .bind(Date.now(), albumId)
    .run();
  return { status: response.status === 409 ? 'duplicate' : 'success' };
}
