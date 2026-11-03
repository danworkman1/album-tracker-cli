// Everything from Wikipedia and Spotify goes into the page with textContent,
// never innerHTML, so a hostile album title can't run script.

const PROVIDER_NAMES = { google: 'Google', spotify: 'Spotify' };

let state = null;
const needsReconnect = new Set(); // providers a request just told us to reconnect
let message = null; // one-off banner text (success or failure)

const $ = (id) => document.getElementById(id);

function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

function relativeTime(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

async function api(method, path) {
  const res = await fetch(path, { method });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page); leave data null.
  }
  return { ok: res.ok, status: res.status, data };
}

function errorText(result) {
  return result.data?.error ?? `Request failed (${result.status})`;
}

function renderHeader() {
  const parts = [];
  parts.push(state.albumsSyncedAt ? `Releases updated ${relativeTime(state.albumsSyncedAt)}` : 'Releases not loaded yet. Tap "Refresh releases".');
  if (state.spotifySyncedAt) parts.push(`Spotify synced ${relativeTime(state.spotifySyncedAt)}`);
  $('updated').textContent = parts.join(' · ');
}

function renderBanners() {
  const box = $('banners');
  box.replaceChildren();

  if (message) box.append(el('div', { className: 'banner', text: message }));
  for (const warning of state.warnings) box.append(el('div', { className: 'banner', text: warning }));

  for (const provider of ['google', 'spotify']) {
    const connected = state[provider].connected && !needsReconnect.has(provider);
    if (connected) continue;
    const name = PROVIDER_NAMES[provider];
    const verb = needsReconnect.has(provider) ? 'Reconnect' : 'Connect';
    box.append(
      el('div', { className: 'banner' }, [
        el('a', { text: `${verb} ${name}`, attrs: { href: `/auth/${provider}/start` } }),
        document.createTextNode(provider === 'google' ? ' to add albums to your calendar.' : ' to highlight artists you follow.')
      ])
    );
  }
}

function releaseRow(release) {
  const title = el('span', { text: `${release.artist} – ${release.album}` });
  const main = el('div', { className: 'main' }, [title]);
  if (release.isNew) main.append(el('span', { className: 'badge', text: 'New' }));
  const meta = [release.genre, release.label].filter(Boolean).join(' · ');
  if (meta) main.append(el('span', { className: 'meta', text: meta }));

  const button = el('button', { className: 'add', text: release.added ? 'Added' : 'Add', attrs: { type: 'button' } });
  button.disabled = release.added;
  button.addEventListener('click', () => addRelease(release, button));

  return el('li', { className: 'release' }, [el('span', { className: 'date', text: formatDate(release.releaseDate) }), main, button]);
}

function renderFollowed() {
  const followed = state.releases.filter((r) => r.followed);
  $('followed').replaceChildren(...followed.map(releaseRow));

  const empty = $('followed-empty');
  empty.hidden = followed.length > 0;
  empty.textContent = state.spotify.connected
    ? 'None of the artists you follow have releases in this window.'
    : 'Connect Spotify to see releases from artists you follow.';
}

function renderAll() {
  const needle = $('filter').value.trim().toLowerCase();
  const sorted = [...state.releases].sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
  const shown = needle ? sorted.filter((r) => `${r.artist} ${r.album}`.toLowerCase().includes(needle)) : sorted;
  $('all').replaceChildren(...shown.map(releaseRow));
  $('all-count').textContent = `(${shown.length}${needle ? ` of ${sorted.length}` : ''})`;
}

function render() {
  renderHeader();
  renderBanners();
  renderFollowed();
  renderAll();
}

async function load() {
  const result = await api('GET', '/api/state');
  if (!result.ok) {
    message = `Could not load releases: ${errorText(result)}`;
    if (!state) state = { google: {}, spotify: {}, albumsSyncedAt: null, spotifySyncedAt: null, warnings: [], releases: [] };
  } else {
    state = result.data;
  }
  render();
}

async function addRelease(release, button) {
  button.disabled = true;
  button.textContent = 'Adding…';
  message = null;

  const result = await api('POST', `/api/albums/${encodeURIComponent(release.id)}/add`);
  if (result.ok) {
    await load();
    return;
  }

  if (result.status === 401 && result.data?.error === 'reauth_required') {
    needsReconnect.add(result.data.provider ?? 'google');
  } else {
    message = `Could not add "${release.album}": ${errorText(result)}`;
  }
  render();
  button.disabled = false;
  button.textContent = 'Add';
}

async function runAction(button, busyLabel, path, onSuccess) {
  const idle = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  message = null;

  const result = await api('POST', path);
  if (result.ok) {
    needsReconnect.clear();
    message = onSuccess(result.data);
  } else if (result.status === 401 && result.data?.error === 'reauth_required') {
    needsReconnect.add(result.data.provider);
  } else {
    message = errorText(result);
  }

  await load();
  button.disabled = false;
  button.textContent = idle;
}

$('refresh-albums').addEventListener('click', (e) =>
  runAction(e.currentTarget, 'Refreshing…', '/api/albums/refresh', (d) => `Loaded ${d.upserted} releases.`)
);
$('sync-spotify').addEventListener('click', (e) =>
  runAction(e.currentTarget, 'Syncing…', '/api/spotify/sync', (d) => `Synced ${d.count} followed artists.`)
);
$('filter').addEventListener('input', () => {
  if (state) renderAll();
});

const connected = new URLSearchParams(location.search).get('connected');
if (connected && PROVIDER_NAMES[connected]) {
  message = `${PROVIDER_NAMES[connected]} connected.`;
  history.replaceState(null, '', '/');
}

load();
