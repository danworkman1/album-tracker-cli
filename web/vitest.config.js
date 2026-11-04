import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(here, 'migrations'));
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            // Test-only: applied in test/setup.js.
            TEST_MIGRATIONS: migrations,
            // 32 zero bytes, base64. Test key only.
            TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            TIMEZONE: 'Australia/Sydney',
            GOOGLE_CLIENT_ID: 'test-google-client',
            GOOGLE_CLIENT_SECRET: 'test-google-pw',
            SPOTIFY_CLIENT_ID: 'test-spotify-client',
            GOOGLE_CALENDAR_ID: 'primary',
            ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
            ACCESS_AUD: 'test-aud'
          }
        }
      };
    })
  ],
  test: {
    setupFiles: ['./test/setup.js']
  }
});
