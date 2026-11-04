// Worker-safe OAuth helpers. Don't import ../../src/oauth.js here: that one is
// for the CLI's localhost callback server and pulls in `open`.
import { deleteRefreshToken, loadRefreshToken, saveRefreshToken } from './store.js';

const toB64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function codedError(message, code, provider) {
  return Object.assign(new Error(message), { code, provider });
}

export function randomToken(bytes = 32) {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkcePair() {
  const verifier = randomToken(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: toB64Url(new Uint8Array(digest)) };
}

export const STATE_COOKIE = 'oauth_state';
export const VERIFIER_COOKIE = 'oauth_verifier';
const COOKIE_PATH = '/auth';

/** Set-Cookie value for the short-lived state/verifier cookies used during login. */
export function stateCookie(name, value, isHttps) {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=600${isHttps ? '; Secure' : ''}`;
}

/** Set-Cookie value that expires a stateCookie. The Path must match or the browser keeps it. */
export function clearCookie(name) {
  return `${name}=; Max-Age=0; Path=${COOKIE_PATH}`;
}

/** A dead or missing connection: both mean "send the user through the connect flow again". */
export function needsReconnect(err) {
  return err.code === 'reauth_required' || err.code === 'not_connected';
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/**
 * POSTs a token request. A refresh that gets `invalid_grant` means the stored
 * token is dead (revoked, or Google's 7-day expiry while the consent screen is
 * in "Testing"), so it is marked `reauth_required`; retrying can never help.
 */
export async function requestToken(tokenUrl, params, providerName) {
  const body = new URLSearchParams(params);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    let errorCode = null;
    try {
      errorCode = JSON.parse(text).error;
    } catch {
      // Not JSON; fall through to the generic error.
    }
    if (params.grant_type === 'refresh_token' && errorCode === 'invalid_grant') {
      throw codedError(`${providerName} authorization has expired or been revoked.`, 'reauth_required');
    }
    throw new Error(`${providerName} token request failed: ${text}`);
  }

  return response.json();
}

/**
 * Swaps the stored refresh token for a short-lived access token. Throws with
 * code `not_connected` if nothing is stored, or `reauth_required` (after
 * deleting the dead token) if the provider rejects it. Access tokens aren't
 * cached: one refresh per action is cheap for a single user.
 */
export async function getAccessToken(env, { provider, providerName, tokenUrl, clientId, clientSecret }) {
  const refreshToken = await loadRefreshToken(env, provider);
  if (!refreshToken) {
    throw codedError(`${providerName} is not connected.`, 'not_connected', provider);
  }

  try {
    const data = await requestToken(
      tokenUrl,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {})
      },
      providerName
    );
    // Spotify may rotate the refresh token; Google usually doesn't.
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      await saveRefreshToken(env, provider, data.refresh_token);
    }
    return data.access_token;
  } catch (err) {
    if (err.code === 'reauth_required') {
      await deleteRefreshToken(env, provider);
      err.provider = provider;
    }
    throw err;
  }
}
