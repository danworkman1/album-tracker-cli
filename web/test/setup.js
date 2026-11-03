import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// The Workers Vitest plugin isolates storage per test file, not per test, so
// start every test from empty tables.
beforeEach(async () => {
  await env.DB.batch(
    ['albums', 'followed_artists', 'tokens', 'meta'].map((table) => env.DB.prepare(`DELETE FROM ${table}`))
  );
});
