import { listReleases, refreshAlbums } from './albums.js';
import { addAlbumToCalendar, exchangeGoogleCode, googleAuthUrl } from './google.js';
import {
  STATE_COOKIE,
  VERIFIER_COOKIE,
  clearCookie,
  needsReconnect,
  pkcePair,
  randomToken,
  readCookie,
  stateCookie
} from './oauth.js';
import { exchangeSpotifyCode, spotifyAuthUrl, syncFollowedArtists } from './spotify.js';
import { getMeta, hasRefreshToken } from './store.js';
import { todayInZone } from './window.js';

const PROVIDER_NAMES = { google: 'Google', spotify: 'Spotify' };

const json = (body, status = 200) => Response.json(body, { status });
const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

// Must be the same string in the authorise request and the token exchange, or
// the provider rejects the sign-in with redirect_uri_mismatch.
const callbackUri = (url, provider) => `${url.origin}/auth/${provider}/callback`;

function errorResponse(err) {
  if (needsReconnect(err)) return json({ error: 'reauth_required', provider: err.provider }, 401);
  if (err.code === 'not_found') return json({ error: 'not_found' }, 404);
  return json({ error: err.message }, 500);
}

async function state(env) {
  const [google, spotify, albumsSyncedAt, spotifySyncedAt, albumsWarnings, spotifyError, releases] = await Promise.all([
    hasRefreshToken(env, 'google'),
    hasRefreshToken(env, 'spotify'),
    getMeta(env.DB, 'albums_synced_at'),
    getMeta(env.DB, 'spotify_synced_at'),
    getMeta(env.DB, 'albums_warnings'),
    getMeta(env.DB, 'spotify_error'),
    listReleases(env.DB, { today: todayInZone(env.TIMEZONE), nowMs: Date.now() })
  ]);

  const warnings = albumsWarnings ? JSON.parse(albumsWarnings) : [];
  if (spotifyError) warnings.push(spotifyError);

  return json({
    google: { connected: google },
    spotify: { connected: spotify },
    albumsSyncedAt: albumsSyncedAt === null ? null : Number(albumsSyncedAt),
    spotifySyncedAt: spotifySyncedAt === null ? null : Number(spotifySyncedAt),
    warnings,
    releases
  });
}

async function authStart(provider, url, env) {
  const isHttps = url.protocol === 'https:';
  const state = randomToken();
  const redirectUri = callbackUri(url, provider);
  const headers = new Headers();
  headers.append('Set-Cookie', stateCookie(STATE_COOKIE, state, isHttps));

  let location;
  if (provider === 'google') {
    location = googleAuthUrl(env, { redirectUri, state });
  } else {
    const { verifier, challenge } = await pkcePair();
    headers.append('Set-Cookie', stateCookie(VERIFIER_COOKIE, verifier, isHttps));
    location = spotifyAuthUrl(env, { redirectUri, state, challenge });
  }

  headers.set('Location', location);
  return new Response(null, { status: 302, headers });
}

async function authCallback(provider, request, url, env) {
  const name = PROVIDER_NAMES[provider];
  const providerError = url.searchParams.get('error');
  if (providerError) return text(`${name} sign-in was not completed: ${providerError}`, 400);

  const returnedState = url.searchParams.get('state');
  const cookieState = readCookie(request, STATE_COOKIE);
  if (!returnedState || !cookieState || returnedState !== cookieState) {
    return text('Invalid sign-in state. Start again from the app.', 400);
  }

  const code = url.searchParams.get('code');
  if (!code) return text(`${name} did not send a code.`, 400);

  const redirectUri = callbackUri(url, provider);
  try {
    if (provider === 'google') {
      await exchangeGoogleCode(env, { code, redirectUri });
    } else {
      const verifier = readCookie(request, VERIFIER_COOKIE);
      if (!verifier) return text('Missing sign-in verifier. Start again from the app.', 400);
      await exchangeSpotifyCode(env, { code, redirectUri, verifier });
    }
  } catch (err) {
    return text(`${name} sign-in failed: ${err.message}`, 500);
  }

  const headers = new Headers({ Location: `/?connected=${provider}` });
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE));
  headers.append('Set-Cookie', clearCookie(VERIFIER_COOKIE));
  return new Response(null, { status: 302, headers });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  try {
    if (request.method === 'POST' && pathname.startsWith('/api/')) {
      // Browsers send Origin on POSTs; a foreign page can't make us act.
      if (request.headers.get('Origin') !== url.origin) return json({ error: 'forbidden' }, 403);

      if (pathname === '/api/spotify/sync') return json({ count: await syncFollowedArtists(env) });
      if (pathname === '/api/albums/refresh') return json(await refreshAlbums(env));
      const add = pathname.match(/^\/api\/albums\/([^/]+)\/add$/);
      if (add) return json(await addAlbumToCalendar(env, decodeURIComponent(add[1])));
    }

    if (request.method === 'GET') {
      if (pathname === '/api/state') return await state(env);
      const auth = pathname.match(/^\/auth\/(google|spotify)\/(start|callback)$/);
      if (auth) {
        return auth[2] === 'start'
          ? await authStart(auth[1], url, env)
          : await authCallback(auth[1], request, url, env);
      }
    }
  } catch (err) {
    return errorResponse(err);
  }

  return env.ASSETS.fetch(request);
}
