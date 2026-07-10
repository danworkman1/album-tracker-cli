# Spotify Album Tracker CLI 🎵

A local Node.js CLI tool that scrapes upcoming album releases from Wikipedia, lets you select which ones you are interested in using an interactive terminal interface, and generates a standard calendar file (`.ics`) to import into Google Calendar, Apple Calendar, or Outlook.

It also integrates with Spotify to automatically highlight and pre-select upcoming albums from artists you follow!

---

## Features

- **Wikipedia Scraper:** Scrapes Wikipedia's annual album lists (e.g. `List of 2026 albums`) for the current and next month.
- **Interactive Multi-select:** Search and filter through albums using a searchable CLI checklist.
- **Spotify Integration (Optional):** Logs in via Spotify OAuth, fetches your followed artists, lists their upcoming releases at the top of the terminal menu, and pre-checks them for you.
- **All-Day Calendar Events:** Generates clean all-day events on the album release date.
- **Direct Calendar Sync:** Adds selected releases directly to Google Calendar or Outlook Calendar.
- **Direct Spotify Links:** Each calendar event includes a search link (`https://open.spotify.com/search/...`) for that album, letting you listen with a single click.

---

## Installation & Setup

For the broader auth direction, including how this should work once the CLI ships with project-owned OAuth app IDs, see [docs/auth-strategy.md](docs/auth-strategy.md).

### 1. Install Dependencies
Make sure you have Node.js (version 18+) installed. Clone or navigate to this folder and run:
```bash
pnpm install
```

### 2. Configure Spotify Personalization (Optional)
To highlight and pre-select releases by your followed artists:
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Log in and click **Create App**.
3. Set the **App name** and **Description**.
4. In the **Redirect URIs** field, enter: `http://127.0.0.1:8888/callback`. (Spotify no longer accepts the `localhost` hostname — the loopback IP is required.)
5. Check the Web API box (and accept terms), then click **Save**.
6. Click **Settings** to find your **Client ID**.
7. Create a `.env` file in the root of this project:
   ```bash
   cp .env.example .env
   ```
8. Paste your client ID into the `.env` file:
   ```env
   SPOTIFY_CLIENT_ID=your_client_id
   ```
9. Authenticate the CLI with your Spotify account by running:
   ```bash
   pnpm run login
   ```
   This will open a browser window for you to log in and authorize the application. Once approved, the CLI will sync your followed artists. You can also skip this command and authenticate from the main `pnpm start` flow when prompted.

### 3. Configure Google Calendar Sync (Optional)
To add events directly into a specific Google Calendar from the CLI:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and enable the **Google Calendar API**.
3. Go to **APIs & Services** -> **OAuth consent screen**. Create a consent screen (External, add your email and scope `.../auth/calendar.events`). Add your Google account as a Test User.
4. Go to **APIs & Services** -> **Credentials**. Click **Create Credentials** -> **OAuth client ID**.
5. Select **Web application** (or Desktop App, but Web allows redirect).
6. Set the **Authorized redirect URIs** to: `http://127.0.0.1:8889/callback`.
7. Click **Create** and get your **Client ID** and **Client Secret**.
8. Paste these into your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```
9. Test authentication and sync writable calendars by running:
   ```bash
   pnpm run login-google
   ```

### 4. Configure Outlook Calendar Sync (Optional)
To add events directly into a specific Outlook Calendar from the CLI:
1. Go to the [Microsoft Azure App registrations page](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2. Click **New registration**.
3. Choose the supported account types you want. Use **Accounts in any organizational directory and personal Microsoft accounts** if you want both work/school and personal Outlook accounts.
4. Add a **Mobile and desktop applications** redirect URI: `http://127.0.0.1:8890/callback`.
5. After registration, copy the **Application (client) ID**.
6. Paste it into your `.env` file:
   ```env
   OUTLOOK_CLIENT_ID=your_outlook_client_id
   OUTLOOK_TENANT_ID=common
   ```
7. If you instead configure the app as a confidential web application, create a client secret under **Certificates & secrets** and add it to `.env`:
   ```env
   OUTLOOK_CLIENT_SECRET=your_outlook_client_secret
   ```
8. Authenticate the CLI with your Microsoft account:
   ```bash
   pnpm run login-outlook
   ```

---

## How to Run

To run the tracker:
```bash
pnpm start
```

### Flow:
1. **Connect Spotify (optional):** If configured but not yet connected, you'll be asked to connect so your followed artists can be highlighted and ranked. On later runs the CLI refreshes your followed artists automatically without asking.
2. **Choose your calendar destination:** Pick where releases should go before you see any albums:
   * **Local iCalendar file (.ics):** Generates an `albums.ics` file.
   * **Google Calendar (Sync Directly):** Logs in (if needed) and lets you pick a calendar from your Google account; events are created automatically (preventing duplicates).
   * **Outlook Calendar (Sync Directly):** Logs in (if needed) and lets you pick a calendar from your Microsoft account; events are created automatically (preventing duplicates).
3. **Interactive Checklist:** Navigate, search, and toggle selections. If you're connected to Spotify, a **Top 10 Suggestions** block (ranked by your followed artists) appears first, followed by the complete album list in alphabetical order by artist (A–Z) so you can browse everything.

### Interface Controls:
- **Up / Down Arrows:** Navigate the list.
- **Spacebar:** Toggle selection (check/uncheck).
- **Type Letters:** Filter/search the list of albums.
- **Enter:** Confirm and generate/sync your calendar using the destination you chose in step 2.

---

## Importing to Your Calendar (If using .ics)

If you chose to generate an `albums.ics` file:

### macOS (Apple Calendar):
- Simply double-click the `albums.ics` file. Apple Calendar will open and prompt you to import the events.

### Google Calendar manually:
1. Open [Google Calendar](https://calendar.google.com).
2. Click the **Settings gear** -> **Settings**.
3. Click **Import & export** in the left sidebar.
4. Click **Select file from your computer**, choose `albums.ics`, choose your target calendar, and click **Import**.
