# Album Tracker web app

A single-user Cloudflare Worker that does what the CLI does, without the terminal:

- A daily cron scrapes Wikipedia for this month's and next month's releases into D1, then refreshes the artists you follow on Spotify. A **Re-sync Spotify** button (and a **Refresh releases** one) do the same on demand.
- The page lists releases from artists you follow first, then everything A to Z, and each row has an **Add** button that puts a free 9am reminder in your Google Calendar.
- You sign in to Google and Spotify once. The Worker keeps the refresh tokens (AES-GCM encrypted in D1) and renews access tokens itself.
- Cloudflare Access gates the whole thing, and the Worker checks the Access token too, so the bare `workers.dev` URL can't be used to skip the login.

## First-time setup

Run these from `web/` unless it says otherwise. You need Node and pnpm.

1. **Install and create the database.** The Worker reuses the CLI's scraper, which needs `cheerio` from the repo root, so install in both places:
   ```bash
   pnpm install          # at the repo root
   cd web && pnpm install
   pnpm wrangler d1 create album-tracker
   ```
   Put the `database_id` it prints into `wrangler.jsonc`, then create the tables:
   ```bash
   pnpm wrangler d1 migrations apply DB --remote
   ```

2. **Google Cloud console** (same project as the CLI is fine).
   - Add these authorised redirect URIs to the OAuth client (your workers.dev subdomain is under Workers & Pages, Account details):
     - `https://album-tracker.<your-workers-subdomain>.workers.dev/auth/google/callback`
     - `http://127.0.0.1:8787/auth/google/callback` (local dev)
   - **Set the OAuth consent screen's publishing status to "In production".** While it says "Testing", Google expires refresh tokens after 7 days and the app will keep asking you to reconnect. Expect a one-off "Google hasn't verified this app" screen when you connect; that's normal for a personal app.

3. **Spotify dashboard.** Add the redirect URIs:
   - `https://album-tracker.<your-workers-subdomain>.workers.dev/auth/spotify/callback`
   - `http://127.0.0.1:8787/auth/spotify/callback` (local dev)

4. **Config in `wrangler.jsonc`.** Set `TIMEZONE` (an IANA name, e.g. `Australia/Sydney`; it decides what "today" is and the time zone of the 9am reminder), `GOOGLE_CLIENT_ID` and `SPOTIFY_CLIENT_ID`. `GOOGLE_CALENDAR_ID` defaults to `primary`.

5. **First deploy.**
   ```bash
   pnpm run deploy
   ```
   (`pnpm deploy` on its own is a different pnpm command and won't run this script.) The Worker now exists, but it answers 403 to everything until Access is set up in step 7. That's expected: it fails closed.

6. **Secrets.** These never go in a file or the terminal output, and they need the Worker from step 5 to exist:
   ```bash
   openssl rand -base64 32 | pnpm wrangler secret put TOKEN_ENCRYPTION_KEY
   pnpm wrangler secret put GOOGLE_CLIENT_SECRET   # paste at the prompt
   ```
   Don't lose `TOKEN_ENCRYPTION_KEY`: without it the stored tokens can't be read and you'd reconnect Google and Spotify.

7. **Cloudflare Access.** Put the Worker behind Access with a policy that allows only your email (Workers & Pages, the Worker's Settings, Domains & Routes, enable Cloudflare Access; the dashboard wording may differ slightly). Copy two values into `wrangler.jsonc`, then run `pnpm run deploy` again:
   - `ACCESS_TEAM_DOMAIN`: your team domain, like `your-team.cloudflareaccess.com`
   - `ACCESS_AUD`: the application's Audience (AUD) tag

8. **First run.** Open the site (you'll go through the Access login), click **Connect Google** and **Connect Spotify**, then **Re-sync Spotify** and **Refresh releases**. After that the daily cron (18:00 UTC) keeps it current.

## Local development

```bash
pnpm wrangler d1 migrations apply DB --local
pnpm dev
```

Open `http://127.0.0.1:8787`, not the `localhost` address wrangler may print: the redirect URIs above are registered for `127.0.0.1`, and Google and Spotify reject a different host with `redirect_uri_mismatch`.

`pnpm dev` needs a `.dev.vars` file (gitignored) next to `wrangler.jsonc`. Copy `.dev.vars.example` and set `DEV_BYPASS_ACCESS=true` so you don't need an Access login locally. Never set that variable in production.

## Tests

```bash
pnpm test
```

Runs in the Workers runtime with a real (in-memory) D1 database. External calls (Google, Spotify, Wikipedia) are stubbed.

## Known limits

- **This needs the Workers Paid plan.** Refreshing releases parses one ~2.6 MB Wikipedia page per month with cheerio's slim parser, which measured about 0.1 s of CPU and 20 MB of heap per page on a laptop (Node). The Free plan allows 10 ms of CPU per request or cron run, so the refresh can't run there. Paid allows 30 seconds by default. A Free-plan version would need a much lighter fetch (for example Wikipedia's `api.php?action=parse&section=N`, about 130 KB per month, or streaming `HTMLRewriter`), and even then 10 ms isn't guaranteed.
- If "Refresh releases" fails in production but works locally, check the Worker's logs first: `exceededCpu` or `exceededMemory` means the limits above (wrong plan), not Wikipedia. Only if the logs show a Wikipedia 403 or 429 is it blocking Cloudflare's outbound requests.
- Artists are matched to your followed list by exact lowercase name, same as the CLI, so a Wikipedia cell like "A and B" won't match a followed artist.
- The page only knows about reminders it added itself. An album you added with the CLI shows **Add** until you press it; the app then finds the existing reminder and marks it **Added**.
- If you delete a reminder in Google Calendar, Google keeps its id reserved. For an album added with the CLI, pressing **Add** in the app looks the event up and restores it. That restore path is only covered by stubbed tests, so check it against real Google after your first deploy. An album you added in the app and later delete in Google Calendar stays **Added** and can't be added again from the app.
