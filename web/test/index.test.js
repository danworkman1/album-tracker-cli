import { expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { testEnv } from './helpers.js';

const ctx = { waitUntil() {}, passThroughOnException() {} };

test('every request without an Access token is 403 and never reaches the app or assets', async () => {
  const assets = vi.fn(async () => new Response('asset'));
  const env = testEnv({ ASSETS: { fetch: assets } });

  for (const [method, path] of [
    ['GET', '/'],
    ['GET', '/app.js'],
    ['GET', '/api/state'],
    ['POST', '/api/albums/x/add'],
    ['GET', '/auth/google/start']
  ]) {
    const res = await worker.fetch(new Request(`https://app.test${path}`, { method, headers: { Origin: 'https://app.test' } }), env, ctx);
    expect(res.status, `${method} ${path}`).toBe(403);
  }
  expect(assets).not.toHaveBeenCalled();
});

test('with a valid gate the request is handled', async () => {
  const assets = vi.fn(async () => new Response('asset'));
  // DEV_BYPASS_ACCESS stands in for a verified token (access.test.js covers real tokens).
  const env = testEnv({ ASSETS: { fetch: assets }, DEV_BYPASS_ACCESS: 'true' });

  const res = await worker.fetch(new Request('https://app.test/'), env, ctx);
  expect(await res.text()).toBe('asset');
  expect(assets).toHaveBeenCalledOnce();
});
