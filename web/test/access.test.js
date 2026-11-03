import { SignJWT, generateKeyPair } from 'jose';
import { beforeAll, expect, test } from 'vitest';
import { verifyAccess } from '../src/access.js';

const ENV = { ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'test-aud' };
const ISSUER = 'https://test.cloudflareaccess.com';

let pair;
let otherPair;
beforeAll(async () => {
  pair = await generateKeyPair('RS256');
  otherPair = await generateKeyPair('RS256');
});

const getKey = async () => pair.publicKey;
const now = () => Math.floor(Date.now() / 1000);

function sign({ key = pair.privateKey, aud = 'test-aud', iss = ISSUER, exp = now() + 300 } = {}) {
  return new SignJWT({ email: 'me@example.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

const requestWith = (token) =>
  new Request('https://app.test/', token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {});

test('a valid Access token passes', async () => {
  expect(await verifyAccess(requestWith(await sign()), ENV, getKey)).toBe(true);
});

test('a request with no token is refused', async () => {
  expect(await verifyAccess(requestWith(null), ENV, getKey)).toBe(false);
});

test('a token signed by a different key is refused', async () => {
  expect(await verifyAccess(requestWith(await sign({ key: otherPair.privateKey })), ENV, getKey)).toBe(false);
});

test('a token for a different application (aud) is refused', async () => {
  expect(await verifyAccess(requestWith(await sign({ aud: 'someone-elses-app' })), ENV, getKey)).toBe(false);
});

test('an expired token is refused', async () => {
  expect(await verifyAccess(requestWith(await sign({ exp: now() - 60 })), ENV, getKey)).toBe(false);
});

test('a token from a different issuer is refused', async () => {
  expect(await verifyAccess(requestWith(await sign({ iss: 'https://evil.example' })), ENV, getKey)).toBe(false);
});

test('garbage in the header is refused rather than thrown', async () => {
  expect(await verifyAccess(requestWith('not.a.jwt'), ENV, getKey)).toBe(false);
});

test('an unconfigured audience fails closed instead of skipping the aud check', async () => {
  const token = await sign({ aud: 'anything' });
  // An unset wrangler var is undefined, and jose skips the aud check for that.
  expect(await verifyAccess(requestWith(token), { ...ENV, ACCESS_AUD: undefined }, getKey)).toBe(false);
  expect(await verifyAccess(requestWith(token), { ...ENV, ACCESS_AUD: '' }, getKey)).toBe(false);
});

test('DEV_BYPASS_ACCESS=true lets an unauthenticated request through', async () => {
  expect(await verifyAccess(requestWith(null), { ...ENV, DEV_BYPASS_ACCESS: 'true' }, getKey)).toBe(true);
});

test('DEV_BYPASS_ACCESS=false does not', async () => {
  expect(await verifyAccess(requestWith(null), { ...ENV, DEV_BYPASS_ACCESS: 'false' }, getKey)).toBe(false);
});
