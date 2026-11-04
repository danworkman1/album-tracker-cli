import { refreshAlbums } from './albums.js';
import { syncFollowedArtists } from './spotify.js';
import { hasRefreshToken, setMeta } from './store.js';

export async function runSpotifySync(env) {
  if (!(await hasRefreshToken(env, 'spotify'))) return;

  try {
    await syncFollowedArtists(env);
  } catch (err) {
    // syncFollowedArtists records every other failure itself. A dead token it
    // leaves alone (the page shows "Connect Spotify"), but nobody is watching
    // a cron, so say why the list stopped updating.
    if (err.code === 'reauth_required') {
      await setMeta(env.DB, 'spotify_error', 'Spotify authorisation expired — reconnect');
    }
  }
}

/**
 * The daily run (the one cron trigger in wrangler.jsonc): refresh the album
 * window, then sync Spotify. Each is isolated so one failing doesn't skip the
 * other.
 */
export async function runScheduled(env) {
  try {
    await refreshAlbums(env);
  } catch (err) {
    console.error('Album refresh failed:', err);
  }
  await runSpotifySync(env);
}
