import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cloudflare Access signs a JWT for every request it lets through and sends it
// in this header. Checking it ourselves means hitting the bare workers.dev URL
// (which bypasses Access) gets a 403 instead of the app.
const HEADER = 'Cf-Access-Jwt-Assertion';

// Built once per isolate and reused so jose can cache Cloudflare's signing keys.
let remoteKeys;

function defaultKeys(env) {
  remoteKeys ??= createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
  return remoteKeys;
}

/**
 * True if the request carries a valid Access JWT for this application.
 * `DEV_BYPASS_ACCESS=true` (set only in the local dev vars file) skips the
 * check. Never throws: any problem means "not allowed".
 */
export async function verifyAccess(request, env, getKey) {
  if (env.DEV_BYPASS_ACCESS === 'true') return true;

  // Fail closed: jose skips the audience check when given an empty audience,
  // which would accept a token minted for any other Access app on the team.
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return false;

  const token = request.headers.get(HEADER);
  if (!token) return false;

  try {
    await jwtVerify(token, getKey ?? defaultKeys(env), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256']
    });
    return true;
  } catch {
    return false;
  }
}
