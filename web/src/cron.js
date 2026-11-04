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
    // syncFollowedArtists records every other failure itself. A dead token it
    // leaves alone (the page shows "Connect Spotify"), but nobody is watching
    // a cron, so say why the list stopped updating.
    if (err.code === 'reauth_required') {
      await setMeta(env.DB, 'spotify_error', 'Spotify authorization expired — reconnect');
    }
  }
}

/**
 * Albums is the default so an unrecognised cron string still does something
 * useful. The catch: if SPOTIFY_CRON drifts from wrangler.jsonc, the Spotify
 * trigger quietly becomes a second album refresh, so change them together.
 */
export async function runScheduled(cron, env) {
  if (cron === SPOTIFY_CRON) {
    await runSpotifySync(env);
  } else {
    await refreshAlbums(env);
  }
}
