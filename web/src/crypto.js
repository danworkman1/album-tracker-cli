// AES-GCM for refresh tokens at rest. The key is a Worker secret (base64 of
// 32 bytes), never stored next to the ciphertext.

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function importKey(keyB64) {
  return crypto.subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Returns `base64(iv):base64(ciphertext)`. */
export async function encrypt(plain, keyB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyB64);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `${toB64(iv)}:${toB64(new Uint8Array(data))}`;
}

/** Throws if the key is wrong or the blob has been altered. */
export async function decrypt(blob, keyB64) {
  const [iv, ciphertext] = blob.split(':');
  const key = await importKey(keyB64);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext));
  return new TextDecoder().decode(data);
}
