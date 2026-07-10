import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  authorizeViaBrowser,
  buildTokenParams,
  isTokenFresh,
  readAuthFile,
  requestToken,
  writeAuthFile
} from './oauth.js';

// Load env variables if they exist
dotenv.config();

const AUTH_FILE = path.resolve('.spotify-auth.json');
const REDIRECT_PORT = 8888;
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createPkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(64));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Loads Spotify auth tokens and credentials from config or env.
 */
export function getCredentials() {
  const savedAuth = readAuthFile(AUTH_FILE);

  return {
    clientId: process.env.SPOTIFY_CLIENT_ID || savedAuth.clientId,
    // Secrets live in .env only — the local auth file never stores them.
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    accessToken: savedAuth.accessToken,
    refreshToken: savedAuth.refreshToken,
    expiresAt: savedAuth.expiresAt
  };
}

/**
 * Followed artists are cached in the same file as the tokens, but they're
 * not credentials — read them through this instead of getCredentials.
 */
export function getCachedFollowedArtists() {
  return readAuthFile(AUTH_FILE).followedArtists || [];
}

/**
 * Saves auth config.
 */
export function saveCredentials(data) {
  writeAuthFile(AUTH_FILE, data);
}

/**
 * Refreshes the Spotify access token if expired.
 */
export async function refreshAccessToken() {
  const creds = getCredentials();
  if (!creds.refreshToken || !creds.clientId) {
    throw new Error('Spotify is not logged in or client credentials are missing.');
  }

  if (isTokenFresh(creds.expiresAt)) {
    return creds.accessToken;
  }

  const data = await requestToken(TOKEN_URL, buildTokenParams(creds, {
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken
  }), 'Spotify');

  saveCredentials({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken, // Spotify might not return a new refresh token
    expiresAt: data.expiresAt
  });

  return data.access_token;
}

/**
 * Runs a local server to handle Spotify OAuth callback.
 */
export async function login() {
  const creds = getCredentials();
  if (!creds.clientId) {
    console.error('\nError: SPOTIFY_CLIENT_ID must be set in your .env file.');
    console.error('Please refer to .env.example to set up your environment variables.\n');
    process.exit(1);
  }

  const pkce = createPkcePair();

  await authorizeViaBrowser({
    port: REDIRECT_PORT,
    providerName: 'Spotify',
    accentColor: '#1DB954',
    buildAuthUrl: ({ state, redirectUri }) =>
      'https://accounts.spotify.com/authorize?' + new URLSearchParams({
        client_id: creds.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'user-follow-read user-top-read',
        state,
        code_challenge_method: 'S256',
        code_challenge: pkce.challenge
      }).toString(),
    exchangeCode: async (code, redirectUri) => {
      const data = await requestToken(TOKEN_URL, buildTokenParams(creds, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: pkce.verifier
      }), 'Spotify');

      saveCredentials({
        clientId: creds.clientId,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expiresAt
      });

      return data;
    }
  });
}

/**
 * Fetches all followed artists for the authenticated user.
 */
export async function syncFollowedArtists() {
  const token = await refreshAccessToken();
  let artists = [];
  let after = null;
  let hasMore = true;

  console.log('Fetching followed artists from Spotify...');

  while (hasMore) {
    const url = 'https://api.spotify.com/v1/me/following?' + new URLSearchParams({
      type: 'artist',
      limit: '50',
      ...(after ? { after } : {})
    }).toString();

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch followed artists: ${await response.text()}`);
    }

    const data = await response.json();
    const artistList = data.artists.items;
    artists = artists.concat(artistList.map(a => ({
      name: a.name,
      popularity: a.popularity,
      id: a.id
    })));

    hasMore = data.artists.next !== null;
    after = data.artists.cursors.after;
  }

  saveCredentials({ followedArtists: artists });
  console.log(`Successfully synced ${artists.length} followed artists!`);
  return artists;
}

/**
 * Fetches the user's long-term top artists (most played over ~years),
 * ranked by listening history. Used to break ties when more than 10
 * followed artists have upcoming releases.
 */
export async function getTopArtists() {
  const token = await refreshAccessToken();

  const url = 'https://api.spotify.com/v1/me/top/artists?' + new URLSearchParams({
    time_range: 'long_term',
    limit: '50'
  }).toString();

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch top artists: ${await response.text()}`);
  }

  const data = await response.json();
  return data.items.map((artist, index) => ({
    name: artist.name,
    rank: index + 1
  }));
}

// Support running login directly from the npm script
const args = process.argv.slice(2);
if (args.includes('--login')) {
  login().then(() => {
    console.log('Login successful! Now syncing followed artists...');
    return syncFollowedArtists();
  }).then(() => {
    console.log('Spotify personalization is fully configured!\n');
    process.exit(0);
  }).catch(err => {
    console.error('Login/sync failed:', err.message);
    process.exit(1);
  });
}
