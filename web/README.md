# Album Tracker web app

A single-user Cloudflare Worker that does what the CLI does, without the terminal:

- A daily cron scrapes Wikipedia for this month's and next month's releases into D1.
- A second daily cron (plus a **Re-sync Spotify** button) refreshes the artists you follow.
- The page lists releases from artists you follow first, then everything A to Z, and each row has an **Add** button that puts a free 9am reminder in your Google Calendar.
- You sign in to Google and Spotify once. The Worker keeps the refresh tokens (AES-GCM encrypted in D1) and renews access tokens itself.
- Cloudflare Access gates the whole thing, and the Worker checks the Access token too, so the bare `workers.dev` URL can't be used to skip the login.

Source layout, task by task, is in `docs/superpowers/plans/2026-11-01-album-tracker-web.md` (local only, gitignored).

## First-time setup

Run everything from `web/`, prefixed with `eval "$(/opt/homebrew/bin/fnm env)" &&` on this machine.

1. **Install and create the database.**
   ```bash
   pnpm install
   pnpm wrangler d1 create album-tracker
   ```
   Put the `database_id` it prints into `wrangler.jsonc`, then create the tables:
   ```bash
   pnpm wrangler d1 migrations apply DB --remote
   ```

2. **Google Cloud console** (same project as the CLI is fine).
   - Add these authorised redirect URIs to the OAuth client:
     - `https://album-tracker.<your-workers-subdomain>.workers.dev/auth/google/callback`
     - `http://127.0.0.1:8787/auth/google/callback` (local dev)
   - **Set the OAuth consent screen's publishing status to "In production".** While it says "Testing", Google expires refresh tokens after 7 days and the app will keep asking you to reconnect. Expect a one-off "Google hasn't verified this app" screen when you connect; that's normal for a personal app.

3. **Spotify dashboard.** Add the redirect URIs:
   - `https://album-tracker.<your-workers-subdomain>.workers.dev/auth/spotify/callback`
   - `http://127.0.0.1:8787/auth/spotify/callback` (local dev)

4. **Cloudflare Access.** Put the Worker behind Access with a policy that allows only your email (Workers & Pages, the Worker's Settings, Domains & Routes, enable Cloudflare Access; the dashboard wording may differ slightly). Then copy two values into `wrangler.jsonc`:
   - `ACCESS_TEAM_DOMAIN`: your team domain, like `your-team.cloudflareaccess.com`
   - `ACCESS_AUD`: the application's Audience (AUD) tag

   Until both are set the Worker refuses every request (it fails closed).

5. **Config in `wrangler.jsonc`.** Set `TIMEZONE` (an IANA name, e.g. `Australia/Sydney`; it decides what "today" is and the time zone of the 9am reminder), `GOOGLE_CLIENT_ID` and `SPOTIFY_CLIENT_ID`. `GOOGLE_CALENDAR_ID` defaults to `primary`.

6. **Secrets.** These never go in a file or the terminal output:
   ```bash
   openssl rand -base64 32 | pnpm wrangler secret put TOKEN_ENCRYPTION_KEY
   pnpm wrangler secret put GOOGLE_CLIENT_SECRET   # paste at the prompt
   ```
   Don't lose `TOKEN_ENCRYPTION_KEY`: without it the stored tokens can't be read and you'd reconnect Google and Spotify.

7. **Deploy.**
   ```bash
   pnpm deploy
   ```

8. **First run.** Open the site (you'll go through the Access login), click **Connect Google** and **Connect Spotify**, then **Re-sync Spotify** and **Refresh releases**. After that the crons keep it current (albums at 18:00 UTC, Spotify at 18:05 UTC).

## Local development

```bash
pnpm wrangler d1 migrations apply DB --local
pnpm dev        # http://127.0.0.1:8787
```

`pnpm dev` needs a `.dev.vars` file (gitignored) next to `wrangler.jsonc`. Copy `.dev.vars.example` and set `DEV_BYPASS_ACCESS=true` so you don't need an Access login locally. Never set that variable in production.

Add the two `127.0.0.1:8787` redirect URIs above if you want to test the Google and Spotify connect flows locally.

## Tests

```bash
pnpm test
```

Runs in the Workers runtime with a real (in-memory) D1 database. External calls (Google, Spotify, Wikipedia) are stubbed.

## Known limits

- Artists are matched to your followed list by exact lowercase name, same as the CLI, so a Wikipedia cell like "A and B" won't match a followed artist.
- If you delete a reminder from Google Calendar, adding it again fails: Google keeps the cancelled event's id. The CLI behaves the same way.
- If "Refresh releases" returns 0 in production but works locally, Wikipedia may be blocking Cloudflare's outbound requests. The fix would be to switch the scraper to Wikipedia's `api.php?action=parse` endpoint.
- Free-plan limit: a Worker invocation may make 50 subrequests. A 1,700-artist Spotify sync uses about 35, which is why albums and Spotify run as separate crons.
