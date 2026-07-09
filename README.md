# Spotify Album Tracker CLI 🎵

A local Node.js CLI tool that scrapes upcoming album releases from Wikipedia, lets you select which ones you are interested in using an interactive terminal interface, and generates a standard calendar file (`.ics`) to import into Google Calendar, Apple Calendar, or Outlook.

It also integrates with Spotify to automatically highlight and pre-select upcoming albums from artists you follow!

---

## Features

- **Wikipedia Scraper:** Scrapes Wikipedia's annual album lists (e.g. `List of 2026 albums`) for the current and next month.
- **Interactive Multi-select:** Search and filter through albums using a searchable CLI checklist.
- **Spotify Integration (Optional):** Logs in via Spotify OAuth, fetches your followed artists, lists their upcoming releases at the top of the terminal menu, and pre-checks them for you.
- **All-Day Calendar Events:** Generates clean all-day events on the album release date.
- **Direct Spotify Links:** Each calendar event includes a search link (`https://open.spotify.com/search/...`) for that album, letting you listen with a single click.

---

## Installation & Setup

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
4. In the **Redirect URIs** field, enter: `http://localhost:8888/callback`.
5. Check the Web API box (and accept terms), then click **Save**.
6. Click **Settings** to find your **Client ID** and **Client Secret**.
7. Create a `.env` file in the root of this project:
   ```bash
   cp .env.example .env
   ```
8. Paste your credentials into the `.env` file:
   ```env
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   ```
9. Authenticate the CLI with your Spotify account by running:
   ```bash
   pnpm run login
   ```
   This will open a browser window for you to log in and authorize the application. Once approved, the CLI will sync your followed artists.

### 3. Configure Google Calendar Sync (Optional)
To add events directly into a specific Google Calendar from the CLI:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and enable the **Google Calendar API**.
3. Go to **APIs & Services** -> **OAuth consent screen**. Create a consent screen (External, add your email and scope `.../auth/calendar.events`). Add your Google account as a Test User.
4. Go to **APIs & Services** -> **Credentials**. Click **Create Credentials** -> **OAuth client ID**.
5. Select **Web application** (or Desktop App, but Web allows redirect).
6. Set the **Authorized redirect URIs** to: `http://localhost:8889/callback`.
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

---

## How to Run

To run the tracker:
```bash
pnpm start
```

### Flow:
1. **Interactive Checklist:** Navigate, search, and toggle selections.
2. **Select Destination:** You will be prompted to select where to export:
   * **Local iCalendar file (.ics):** Generates an `albums.ics` file.
   * **Google Calendar (Sync Directly):** Prompts you to select a calendar from your Google account and creates the events automatically (preventing duplicates).

### Interface Controls:
- **Up / Down Arrows:** Navigate the list.
- **Spacebar:** Toggle selection (check/uncheck).
- **Type Letters:** Filter/search the list of albums.
- **Enter:** Confirm and proceed to destination choice.

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

