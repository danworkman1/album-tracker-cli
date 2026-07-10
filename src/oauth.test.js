import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import {
  buildTokenParams,
  isTokenFresh,
  mergeAuthState,
  readAuthFile,
  writeAuthFile,
  requestToken,
  authorizeViaBrowser
} from './oauth.js';

test('buildTokenParams always sends client_id and only sends client_secret when present', () => {
  const withSecret = buildTokenParams({ clientId: 'id', clientSecret: 'shh' }, { grant_type: 'x' });
  assert.equal(withSecret.get('client_id'), 'id');
  assert.equal(withSecret.get('client_secret'), 'shh');
  assert.equal(withSecret.get('grant_type'), 'x');

  const withoutSecret = buildTokenParams({ clientId: 'id' }, { grant_type: 'x' });
  assert.equal(withoutSecret.get('client_secret'), null);
});

test('isTokenFresh applies a 5-minute buffer', () => {
  const now = 1_000_000_000;
  assert.equal(isTokenFresh(now + 301_000, now), true);
  assert.equal(isTokenFresh(now + 299_000, now), false);
  assert.equal(isTokenFresh(undefined, now), false);
});

test('mergeAuthState merges updates and never keeps a client secret', () => {
  const merged = mergeAuthState(
    { clientId: 'id', clientSecret: 'shh', followedArtists: [{ name: 'Tool' }] },
    { accessToken: 'new' }
  );

  assert.deepEqual(merged, {
    clientId: 'id',
    followedArtists: [{ name: 'Tool' }],
    accessToken: 'new'
  });
});

test('writeAuthFile merges with existing file contents and strips secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const file = path.join(dir, 'auth.json');
  fs.writeFileSync(file, JSON.stringify({ clientSecret: 'shh', followedArtists: [{ name: 'Tool' }] }));

  writeAuthFile(file, { accessToken: 'tok' });

  assert.deepEqual(readAuthFile(file), {
    followedArtists: [{ name: 'Tool' }],
    accessToken: 'tok'
  });
});

test('readAuthFile returns an empty object for missing or corrupt files', () => {
  assert.deepEqual(readAuthFile('/nonexistent/auth.json'), {});

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const file = path.join(dir, 'auth.json');
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(readAuthFile(file), {});
});

test('requestToken posts form params and computes expiresAt', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      assert.equal(new URLSearchParams(body).get('grant_type'), 'refresh_token');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    });
  });
  await new Promise(resolve => server.listen(0, resolve));
  const url = `http://localhost:${server.address().port}/token`;

  const before = Date.now();
  const data = await requestToken(url, new URLSearchParams({ grant_type: 'refresh_token' }), 'Test');
  server.close();

  assert.equal(data.access_token, 'tok');
  assert.ok(data.expiresAt >= before + 3600 * 1000);
});

test('requestToken throws with the provider name and response body on failure', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(400);
    res.end('bad_grant');
  });
  await new Promise(resolve => server.listen(0, resolve));
  const url = `http://localhost:${server.address().port}/token`;

  await assert.rejects(
    requestToken(url, new URLSearchParams(), 'Test'),
    /Test token request failed: bad_grant/
  );
  server.close();
});

async function waitFor(getter) {
  for (let i = 0; i < 100 && !getter(); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return getter();
}

test('authorizeViaBrowser exchanges the code when state matches', async () => {
  let authUrl;
  const pending = authorizeViaBrowser({
    port: 18888,
    providerName: 'Test',
    accentColor: '#fff',
    buildAuthUrl: ({ state, redirectUri }) =>
      `https://example.com/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async (code, redirectUri) => ({ code, redirectUri }),
    openBrowser: (url) => { authUrl = url; }
  });

  await waitFor(() => authUrl);
  const state = new URL(authUrl).searchParams.get('state');
  const res = await fetch(`http://localhost:18888/callback?code=abc&state=${state}`);

  assert.equal(res.status, 200);
  assert.deepEqual(await pending, { code: 'abc', redirectUri: 'http://localhost:18888/callback' });
});

test('authorizeViaBrowser rejects on state mismatch', async () => {
  let authUrl;
  const pending = authorizeViaBrowser({
    port: 18889,
    providerName: 'Test',
    accentColor: '#fff',
    buildAuthUrl: () => 'https://example.com/auth',
    exchangeCode: async () => { throw new Error('should not be called'); },
    openBrowser: (url) => { authUrl = url; }
  });

  // Attach the rejection assertion before awaiting anything else: the
  // callback server rejects `pending` as soon as it handles the request
  // below, which can happen before this function's execution reaches the
  // `assert.rejects` call. Node's test runner flags a promise as unhandled
  // the moment it rejects with nothing attached yet, even if something is
  // attached microtasks later - so we attach here first.
  const rejection = assert.rejects(pending, /Invalid Test OAuth state parameter/);

  await waitFor(() => authUrl);
  const res = await fetch('http://localhost:18889/callback?code=abc&state=wrong');

  assert.equal(res.status, 400);
  await rejection;
});
