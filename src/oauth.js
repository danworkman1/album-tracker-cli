import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import open from 'open';

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isTokenFresh(expiresAt, now = Date.now()) {
  return Boolean(expiresAt) && now < expiresAt - EXPIRY_BUFFER_MS;
}

export function buildTokenParams(creds, params) {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    ...params
  });

  if (creds.clientSecret) {
    body.set('client_secret', creds.clientSecret);
  }

  return body;
}

export function mergeAuthState(current, update) {
  const merged = { ...current, ...update };
  // Auth strategy: local auth files store tokens and non-secret app IDs only.
  delete merged.clientSecret;
  return merged;
}

export function readAuthFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

export function writeAuthFile(filePath, update) {
  const merged = mergeAuthState(readAuthFile(filePath), update);
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function parseErrorCode(responseText) {
  try {
    return JSON.parse(responseText).error;
  } catch (e) {
    return null;
  }
}

export async function requestToken(tokenUrl, body, providerName) {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();

    // `invalid_grant` on a refresh means the stored refresh token is dead —
    // revoked, or aged out (Google expires them after 7 days while its consent
    // screen is still in "Testing"). Retrying never helps; only a fresh login
    // does, so callers get a code they can turn into that instruction.
    if (body.get('grant_type') === 'refresh_token' && parseErrorCode(text) === 'invalid_grant') {
      const err = new Error(`${providerName} authorization has expired or been revoked.`);
      err.code = 'reauth_required';
      throw err;
    }

    throw new Error(`${providerName} token request failed: ${text}`);
  }

  const data = await response.json();
  return { ...data, expiresAt: Date.now() + data.expires_in * 1000 };
}

/**
 * Runs the localhost OAuth callback dance shared by every provider. The
 * state parameter is generated and verified here so no provider can forget
 * it (Google previously did).
 */
export function authorizeViaBrowser({ port, providerName, accentColor, buildAuthUrl, exchangeCode, openBrowser = open }) {
  // Spotify (April 2025) rejects the `localhost` hostname and requires the
  // loopback IP literal; Google and Microsoft accept 127.0.0.1 too, so every
  // provider shares one host. The redirect URI must match each provider's
  // registered value exactly.
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      const returnedState = reqUrl.searchParams.get('state');

      const fail = (message, err) => {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>${providerName} Authentication Failed</h1><p>${message}</p>`);
        server.close();
        reject(err);
      };

      if (error) {
        fail(error, new Error(error));
        return;
      }

      if (returnedState !== state) {
        fail('Invalid state parameter.', new Error(`Invalid ${providerName} OAuth state parameter`));
        return;
      }

      try {
        const tokenData = await exchangeCode(code, redirectUri);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #121212; color: #ffffff;">
              <h1 style="color: ${accentColor};">${providerName} Successfully Authenticated!</h1>
              <p>You can now close this window and return to your terminal.</p>
            </body>
          </html>
        `);
        server.close();
        resolve(tokenData);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Internal Server Error</h1><p>' + err.message + '</p>');
        server.close();
        reject(err);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const authUrl = buildAuthUrl({ state, redirectUri });
      console.log(`\nOpening ${providerName} login in your browser...`);
      console.log(`URL: ${authUrl}\n`);
      openBrowser(authUrl);
    });
  });
}
