import { expect, test } from 'vitest';
import { decrypt, encrypt } from '../src/crypto.js';

const KEY_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const KEY_B = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

test('encrypt then decrypt round-trips', async () => {
  const blob = await encrypt('abc', KEY_A);
  expect(await decrypt(blob, KEY_A)).toBe('abc');
});

test('two encryptions of the same text differ', async () => {
  expect(await encrypt('abc', KEY_A)).not.toBe(await encrypt('abc', KEY_A));
});

test('decrypting with the wrong key throws', async () => {
  const blob = await encrypt('abc', KEY_A);
  await expect(decrypt(blob, KEY_B)).rejects.toThrow();
});

test('decrypting tampered data throws', async () => {
  const blob = await encrypt('abc', KEY_A);
  const [iv, ciphertext] = blob.split(':');
  // Flip the first character of the ciphertext to a different base64 character.
  const flipped = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
  await expect(decrypt(`${iv}:${flipped}`, KEY_A)).rejects.toThrow();
});
