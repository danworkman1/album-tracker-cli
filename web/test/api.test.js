import { expect, test, vi } from 'vitest';
import { api } from '../public/api.js';
import { json, stubFetch } from './helpers.js';

test('api returns the parsed body and status', async () => {
  const calls = stubFetch(() => json({ a: 1 }));
  expect(await api('POST', '/api/x')).toEqual({ ok: true, status: 200, data: { a: 1 } });
  expect(calls[0].init.method).toBe('POST');
});

test('api keeps the status and an error body for a failed request', async () => {
  stubFetch(() => json({ error: 'reauth_required', provider: 'google' }, 401));
  expect(await api('POST', '/api/x')).toEqual({
    ok: false,
    status: 401,
    data: { error: 'reauth_required', provider: 'google' }
  });
});

test('api tolerates a non-JSON body', async () => {
  stubFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
  expect(await api('GET', '/api/state')).toEqual({ ok: false, status: 502, data: null });
});

test('a network failure comes back as a result, not a thrown error', async () => {
  // Phone offline, or an expired Access session turning the call into a blocked cross-origin redirect.
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch');
  });

  const result = await api('POST', '/api/albums/x/add');

  expect(result.ok).toBe(false);
  expect(result.status).toBe(0);
  expect(result.data.error).toMatch(/reload/i);
});
