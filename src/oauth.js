import fs from 'fs';

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isTokenFresh(expiresAt, now = Date.now()) {
  return Boolean(expiresAt) && now < expiresAt - EXPIRY_BUFFER_MS;
}

export function buildTokenParams(creds, params) {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    ...params
  });

  if (creds.clientSecret) {
    body.set('client_secret', creds.clientSecret);
  }

  return body;
}

export function mergeAuthState(current, update) {
  const merged = { ...current, ...update };
  // Auth strategy: local auth files store tokens and non-secret app IDs only.
  delete merged.clientSecret;
  return merged;
}

export function readAuthFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

export function writeAuthFile(filePath, update) {
  const merged = mergeAuthState(readAuthFile(filePath), update);
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}
