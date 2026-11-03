import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import {
  deleteRefreshToken,
  getMeta,
  loadRefreshToken,
  saveRefreshToken,
  setMeta
} from '../src/store.js';

test('a saved refresh token is stored encrypted and loads back', async () => {
  await saveRefreshToken(env, 'google', 'tok-123');

  const raw = await env.DB.prepare("SELECT refresh_token_enc FROM tokens WHERE provider = 'google'").first();
  expect(raw.refresh_token_enc).not.toContain('tok-123');
  expect(await loadRefreshToken(env, 'google')).toBe('tok-123');
});

test('saving a token again replaces the old one', async () => {
  await saveRefreshToken(env, 'spotify', 'old');
  await saveRefreshToken(env, 'spotify', 'new');
  expect(await loadRefreshToken(env, 'spotify')).toBe('new');
});

test('tokens are kept per provider', async () => {
  await saveRefreshToken(env, 'google', 'g');
  await saveRefreshToken(env, 'spotify', 's');
  expect(await loadRefreshToken(env, 'google')).toBe('g');
  expect(await loadRefreshToken(env, 'spotify')).toBe('s');
});

test('a deleted token loads as null', async () => {
  await saveRefreshToken(env, 'google', 'tok');
  await deleteRefreshToken(env, 'google');
  expect(await loadRefreshToken(env, 'google')).toBeNull();
});

test('a token that was never saved loads as null', async () => {
  expect(await loadRefreshToken(env, 'google')).toBeNull();
});

test('a missing meta key is null', async () => {
  expect(await getMeta(env.DB, 'nope')).toBeNull();
});

test('meta values round-trip and overwrite', async () => {
  await setMeta(env.DB, 'k', 'one');
  expect(await getMeta(env.DB, 'k')).toBe('one');
  await setMeta(env.DB, 'k', 'two');
  expect(await getMeta(env.DB, 'k')).toBe('two');
});
