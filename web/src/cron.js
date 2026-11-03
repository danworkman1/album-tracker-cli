import { refreshAlbums } from './albums.js';
import { syncFollowedArtists } from './spotify.js';
import { hasRefreshToken, setMeta } from './store.js';

// These must match `triggers.crons` in wrangler.jsonc. Two separate triggers
// keep each run well inside the Workers Free limit of 50 subrequests (a
// 1,700-artist Spotify sync alone is about 35).
export const ALBUMS_CRON = '0 18 * * *';
export const SPOTIFY_CRON = '5 18 * * *';

async function runSpotifySync(env) {
  if (!(await hasRefreshToken(env, 'spotify'))) return;

  try {
    await syncFollowedArtists(env);
  } catch (err) {
    const message =
      err.code === 'reauth_required'
        ? 'Spotify authorization expired — reconnect'
        : `Spotify sync failed: ${err.message}`;
    await setMeta(env.DB, 'spotify_error', message);
  }
}

/** Anything that isn't the Spotify trigger refreshes albums. */
export async function runScheduled(cron, env) {
  if (cron === SPOTIFY_CRON) {
    await runSpotifySync(env);
  } else {
    await refreshAlbums(env);
  }
}
