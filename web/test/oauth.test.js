import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import {
  clearCookie,
  getAccessToken,
  needsReconnect,
  pkcePair,
  randomToken,
  readCookie,
  requestToken,
  stateCookie
} from '../src/oauth.js';
import { deleteRefreshToken, loadRefreshToken, saveRefreshToken } from '../src/store.js';
import { json, stubFetch } from './helpers.js';

const CFG = {
  provider: 'google',
  providerName: 'Google',
  tokenUrl: 'https://token.example/token',
  clientId: 'cid',
  clientSecret: 'csecret'
};

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

test('randomToken is url-safe and different each time', () => {
  const a = randomToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(randomToken()).not.toBe(a);
});

test('pkcePair challenge is the S256 of the verifier', async () => {
  const { verifier, challenge } = await pkcePair();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  expect(challenge).toBe(b64url(digest));
});

test('stateCookie is HttpOnly and only Secure over https', () => {
  const https = stateCookie('oauth_state', 'abc', true);
  const http = stateCookie('oauth_state', 'abc', false);
  expect(https.startsWith('oauth_state=abc')).toBe(true);
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/auth', 'Max-Age=600']) {
    expect(https).toContain(part);
  }
  expect(https).toContain('Secure');
  expect(http).not.toContain('Secure');
});

test('clearCookie expires a cookie on the same Path stateCookie sets it on', () => {
  const cleared = clearCookie('oauth_state');
  expect(cleared.startsWith('oauth_state=;')).toBe(true);
  expect(cleared).toContain('Max-Age=0');
  // The browser only drops a cookie when the Path matches the one it was set with.
  const pathOf = (cookie) => cookie.match(/Path=[^;]+/)[0];
  expect(pathOf(cleared)).toBe(pathOf(stateCookie('oauth_state', 'abc', true)));
});

test('needsReconnect is true for a dead or missing connection and nothing else', () => {
  expect(needsReconnect(Object.assign(new Error('x'), { code: 'reauth_required' }))).toBe(true);
  expect(needsReconnect(Object.assign(new Error('x'), { code: 'not_connected' }))).toBe(true);
  expect(needsReconnect(Object.assign(new Error('x'), { code: 'not_found' }))).toBe(false);
  expect(needsReconnect(new Error('x'))).toBe(false);
});

test('readCookie finds one of several cookies and returns null when absent', () => {
  const req = new Request('https://x.test/', { headers: { Cookie: 'a=1; oauth_state=abc; b=2' } });
  expect(readCookie(req, 'oauth_state')).toBe('abc');
  expect(readCookie(req, 'missing')).toBeNull();
  expect(readCookie(new Request('https://x.test/'), 'a')).toBeNull();
});

test('requestToken returns the parsed token response', async () => {
  const calls = stubFetch(() => json({ access_token: 'at', expires_in: 3600 }));
  const data = await requestToken(CFG.tokenUrl, { grant_type: 'authorization_code', code: 'c' }, 'Google');
  expect(data.access_token).toBe('at');
  expect(calls[0].body).toEqual({ grant_type: 'authorization_code', code: 'c' });
});

test('requestToken marks a dead refresh token as reauth_required', async () => {
  stubFetch(() => json({ error: 'invalid_grant' }, 400));
  const err = await requestToken(CFG.tokenUrl, { grant_type: 'refresh_token', refresh_token: 'r' }, 'Google').catch((e) => e);
  expect(err.code).toBe('reauth_required');
});

test('requestToken leaves other failures uncoded', async () => {
  stubFetch(() => json({ error: 'invalid_grant' }, 400));
  const wrongGrant = await requestToken(CFG.tokenUrl, { grant_type: 'authorization_code', code: 'c' }, 'Google').catch((e) => e);
  expect(wrongGrant.code).toBeUndefined();

  stubFetch(() => json({ error: 'server_error' }, 500));
  const serverError = await requestToken(CFG.tokenUrl, { grant_type: 'refresh_token', refresh_token: 'r' }, 'Google').catch((e) => e);
  expect(serverError.code).toBeUndefined();
  expect(serverError.message).toContain('Google token request failed');
});

test('getAccessToken throws not_connected when nothing is stored', async () => {
  const err = await getAccessToken(env, CFG).catch((e) => e);
  expect(err.code).toBe('not_connected');
  expect(err.provider).toBe('google');
});

test('getAccessToken exchanges the stored refresh token', async () => {
  await saveRefreshToken(env, 'google', 'stored-refresh');
  const calls = stubFetch(() => json({ access_token: 'fresh-access', expires_in: 3600 }));

  expect(await getAccessToken(env, CFG)).toBe('fresh-access');
  expect(calls[0].body).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'stored-refresh',
    client_id: 'cid',
    client_secret: 'csecret'
  });
});

test('getAccessToken omits client_secret when the provider has none', async () => {
  await saveRefreshToken(env, 'spotify', 'r');
  const calls = stubFetch(() => json({ access_token: 'a', expires_in: 3600 }));
  await getAccessToken(env, { ...CFG, provider: 'spotify', clientSecret: undefined });
  expect(calls[0].body).not.toHaveProperty('client_secret');
});

test('getAccessToken deletes a dead token and asks for reauth', async () => {
  await saveRefreshToken(env, 'google', 'dead');
  stubFetch(() => json({ error: 'invalid_grant' }, 400));

  const err = await getAccessToken(env, CFG).catch((e) => e);
  expect(err.code).toBe('reauth_required');
  expect(err.provider).toBe('google');
  expect(await loadRefreshToken(env, 'google')).toBeNull();
});

test('getAccessToken keeps the token on a transient failure', async () => {
  await saveRefreshToken(env, 'google', 'good');
  stubFetch(() => json({ error: 'server_error' }, 503));

  const err = await getAccessToken(env, CFG).catch((e) => e);
  expect(err.code).toBeUndefined();
  expect(await loadRefreshToken(env, 'google')).toBe('good');
});

test('getAccessToken stores a rotated refresh token', async () => {
  await saveRefreshToken(env, 'google', 'old');
  stubFetch(() => json({ access_token: 'a', refresh_token: 'rotated', expires_in: 3600 }));
  await getAccessToken(env, CFG);
  expect(await loadRefreshToken(env, 'google')).toBe('rotated');
  await deleteRefreshToken(env, 'google');
});
