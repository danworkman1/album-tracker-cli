import { vi } from 'vitest';

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Replaces global fetch for one test. `handler(url, init)` returns a Response;
 * every call is recorded as { url, init, body } (body is the form/JSON body
 * parsed to an object when there is one). Restored by setup.js after each test.
 */
export function stubFetch(handler) {
  const calls = [];
  vi.stubGlobal('fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    let body = null;
    if (typeof init.body === 'string') {
      body = init.body.startsWith('{') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body));
    } else if (init.body instanceof URLSearchParams) {
      body = Object.fromEntries(init.body);
    }
    calls.push({ url, init, body });
    return handler(url, init);
  });
  return calls;
}
