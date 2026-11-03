import { decrypt, encrypt } from './crypto.js';

export async function saveRefreshToken(env, provider, token) {
  const enc = await encrypt(token, env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    `INSERT INTO tokens (provider, refresh_token_enc, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc, updated_at = excluded.updated_at`
  )
    .bind(provider, enc, Date.now())
    .run();
}

export async function loadRefreshToken(env, provider) {
  const row = await env.DB.prepare('SELECT refresh_token_enc FROM tokens WHERE provider = ?').bind(provider).first();
  return row ? decrypt(row.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY) : null;
}

export async function deleteRefreshToken(env, provider) {
  await env.DB.prepare('DELETE FROM tokens WHERE provider = ?').bind(provider).run();
}

export async function getMeta(db, key) {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setMeta(db, key, value) {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}
