import { getAccessToken, needsReconnect, requestToken } from './oauth.js';
import { saveRefreshToken, setMeta } from './store.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
// D1 allows 100 bound parameters per statement; two per artist.
const ARTISTS_PER_INSERT = 50;

const tokenConfig = (env) => ({
  provider: 'spotify',
  providerName: 'Spotify',
  tokenUrl: TOKEN_URL,
  clientId: env.SPOTIFY_CLIENT_ID
});

export function spotifyAuthUrl(env, { redirectUri, state, challenge }) {
  return (
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      client_id: env.SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'user-follow-read',
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge
    })
  );
}

/** PKCE exchange: no client secret needed. */
export async function exchangeSpotifyCode(env, { code, redirectUri, verifier }) {
  const data = await requestToken(
    TOKEN_URL,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: env.SPOTIFY_CLIENT_ID
    },
    'Spotify'
  );
  if (!data.refresh_token) throw new Error('Spotify did not return a refresh token');
  await saveRefreshToken(env, 'spotify', data.refresh_token);
  // Connecting again fixes whatever the last sync complained about.
  await setMeta(env.DB, 'spotify_error', '');
}

/**
 * Syncs followed artists, and records any failure for the page to show (the
 * cron and the Re-sync button both come through here). A dead or missing token
 * isn't recorded: the page already shows "Connect Spotify" for that.
 */
export async function syncFollowedArtists(env) {
  try {
    return await storeFollowedArtists(env);
  } catch (err) {
    if (!needsReconnect(err)) {
      await setMeta(env.DB, 'spotify_error', `Spotify sync failed: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Fetches every followed artist, then swaps them into D1 in a single batch so a
 * failed page leaves the previous list untouched. Returns how many artists
 * Spotify reported (artists sharing a name collapse to one row).
 */
async function storeFollowedArtists(env) {
  const token = await getAccessToken(env, tokenConfig(env));
  const artists = [];
  let after = null;
  let hasMore = true;

  while (hasMore) {
    const url =
      'https://api.spotify.com/v1/me/following?' +
      new URLSearchParams({ type: 'artist', limit: '50', ...(after ? { after } : {}) });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new Error(`Failed to fetch followed artists: ${await response.text()}`);
    }

    const data = await response.json();
    artists.push(...data.artists.items.map((a) => a.name));
    hasMore = data.artists.next !== null;
    after = data.artists.cursors.after;
  }

  // A 200 with nobody in it is more likely a different account or an API quirk
  // than "follows nobody"; don't wipe the list on it.
  if (artists.length === 0) {
    throw new Error('Spotify returned no followed artists; keeping the previous list');
  }

  const statements = [env.DB.prepare('DELETE FROM followed_artists')];
  for (let i = 0; i < artists.length; i += ARTISTS_PER_INSERT) {
    const chunk = artists.slice(i, i + ARTISTS_PER_INSERT);
    const placeholders = chunk.map(() => '(?, ?)').join(', ');
    statements.push(
      env.DB.prepare(`INSERT OR IGNORE INTO followed_artists (name_lower, name) VALUES ${placeholders}`).bind(
        ...chunk.flatMap((name) => [name.toLowerCase(), name])
      )
    );
  }
  await env.DB.batch(statements);

  await setMeta(env.DB, 'spotify_synced_at', String(Date.now()));
  await setMeta(env.DB, 'spotify_error', '');
  return artists.length;
}
