import fs from 'fs';
import path from 'path';
import http from 'http';
import { exec } from 'child_process';
import open from 'open';
import dotenv from 'dotenv';

// Load env variables if they exist
dotenv.config();

const AUTH_FILE = path.resolve('.spotify-auth.json');
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

/**
 * Helper to encode credentials to Base64.
 */
function getBasicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

/**
 * Loads Spotify auth tokens and credentials from config or env.
 */
export function getCredentials() {
  const envCreds = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  };

  let savedAuth = {};
  if (fs.existsSync(AUTH_FILE)) {
    try {
      savedAuth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    } catch (e) {
      // Ignore parse errors
    }
  }

  return {
    clientId: envCreds.clientId || savedAuth.clientId,
    clientSecret: envCreds.clientSecret || savedAuth.clientSecret,
    accessToken: savedAuth.accessToken,
    refreshToken: savedAuth.refreshToken,
    expiresAt: savedAuth.expiresAt,
    followedArtists: savedAuth.followedArtists || []
  };
}

/**
 * Saves auth config.
 */
export function saveCredentials(data) {
  const current = getCredentials();
  const updated = { ...current, ...data };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(updated, null, 2), 'utf-8');
}

/**
 * Refreshes the Spotify access token if expired.
 */
export async function refreshAccessToken() {
  const creds = getCredentials();
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
    throw new Error('Spotify is not logged in or client credentials are missing.');
  }

  // Token is still valid (with a 5-minute buffer)
  if (creds.expiresAt && Date.now() < creds.expiresAt - 300000) {
    return creds.accessToken;
  }

  // Refresh token
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': getBasicAuthHeader(creds.clientId, creds.clientSecret)
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh access token: ${errText}`);
  }

  const data = await response.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  saveCredentials({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken, // Spotify might not return a new refresh token
    expiresAt
  });

  return data.access_token;
}

/**
 * Runs a local server to handle Spotify OAuth callback.
 */
export async function login() {
  const creds = getCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    console.error('\nError: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in your .env file.');
    console.error('Please refer to .env.example to set up your environment variables.\n');
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Spotify Authentication Failed</h1><p>' + error + '</p>');
          server.close();
          reject(new Error(error));
          return;
        }

        try {
          // Exchange code for token
          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': getBasicAuthHeader(creds.clientId, creds.clientSecret)
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: REDIRECT_URI
            })
          });

          if (!tokenRes.ok) {
            throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
          }

          const data = await tokenRes.json();
          saveCredentials({
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000
          });

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #121212; color: #ffffff;">
                <h1 style="color: #1DB954;">Successfully Authenticated!</h1>
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
      const authUrl = `https://accounts.spotify.com/authorize?` + new URLSearchParams({
        client_id: creds.clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: 'user-follow-read'
      }).toString();

      console.log('\nOpening Spotify login in your browser...');
      console.log(`URL: ${authUrl}\n`);
      open(authUrl);
    });
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
