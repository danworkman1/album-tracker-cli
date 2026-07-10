import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildTokenParams,
  isTokenFresh,
  mergeAuthState,
  readAuthFile,
  writeAuthFile
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
