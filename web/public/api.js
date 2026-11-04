// Fetch wrapper for the page. It never throws: a network failure (phone
// offline, or an expired Access session turning the call into a blocked
// cross-origin redirect) comes back as a normal failed result so callers can
// restore their buttons and show a message.
export async function api(method, path) {
  let res;
  try {
    res = await fetch(path, { method });
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Reload the page and try again.' } };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page); leave data null.
  }
  return { ok: res.ok, status: res.status, data };
}
