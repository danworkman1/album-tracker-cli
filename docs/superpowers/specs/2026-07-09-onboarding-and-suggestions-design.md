# Onboarding & Suggestions List Design

## Problem

Two usability issues in the `pnpm start` flow (`src/cli.js`):

1. Calendar destination (Local / Google / Outlook) is only asked *after* the user has already picked albums, and it re-asks for the specific calendar every run. It should be decided upfront, alongside the existing Spotify connect step.
2. The album list is sorted "followed first, then chronological," which buries albums from lesser-followed or unfollowed artists. It should surface a genuine top-10 pick list first, then show the complete catalogue in alphabetical order for browsing.

## Onboarding sequence

Restructure the top of `main()` into two sequential steps, both happening before any albums are fetched.

**Step A — Spotify connect** (existing behavior, extended)
- Same confirm-prompt-to-connect flow as today.
- `login()`'s requested OAuth scope changes from `user-follow-read` to `user-follow-read user-top-read`.
- After a successful connect (fresh login *or* an existing valid refresh token), also fetch the user's long-term top artists via a new `getTopArtists()` in `src/spotify.js`:
  - `GET https://api.spotify.com/v1/me/top/artists?time_range=long_term&limit=50`
  - Returns `[{ name, rank }]` where `rank` is 1-based position in the response.
  - Build a `Map<artistNameLowercased, rank>` for lookup.
- If this call fails with 403 (most likely: an existing refresh token issued before `user-top-read` was added to the scope), catch it, print one line telling the user to run `pnpm run login` again to enable ranked suggestions, and continue with an **empty** rank map. This is not a special code path — an empty map just means every followed artist falls into the "unranked" tier described below, which degrades to plain soonest-release ordering.

**Step B — Calendar destination** (new; replaces the current end-of-flow prompt)
- Immediately after Step A, a `select` prompt: `Local iCalendar file (.ics)` / `Google Calendar` / `Outlook Calendar`.
- Choosing Google or Outlook immediately runs the configured-check → login-if-needed → fetch-writable-calendars → select-specific-calendar sequence that currently lives at the bottom of `main()` — moved, not rewritten.
- Result stored as `{ destination, calendarId }` (`calendarId` is `undefined` for `local`).
- Any failure in this step (provider not configured, login fails, no writable calendars found) prints the existing error message and exits — same behavior as today, just earlier in the flow.
- The old end-of-flow "Select calendar destination" and "Select target Google/Outlook Calendar" prompts are removed. The export step at the end uses the Step B result directly.

## Suggestions ranking

New pure helper in `src/cli.js`, e.g. `buildSuggestions(enrichedAlbums, topArtistRanks)`:

1. Filter `enrichedAlbums` to `isFollowed === true`. If Spotify was never connected, this is `[]`.
2. If the followed list has **10 or fewer** albums: that's the entire Suggestions list, sorted by soonest release date (reuse the existing `getDay`/month-index comparator). No padding to reach 10.
3. If the followed list has **more than 10** albums: partition into:
   - `ranked` — artist name found in `topArtistRanks`, sorted ascending by rank (lower rank = more played = higher priority).
   - `unranked` — artist name not found in `topArtistRanks`, sorted by soonest release date.
   - Concatenate `ranked` then `unranked`, take the first 10.

When `topArtistRanks` is empty (Spotify not reconnected under the new scope), every followed artist is `unranked`, so step 3 collapses to "soonest release, first 10" — consistent, no extra branching required.

## List rendering

Single `autocompleteMultiselect` prompt, same as today, built from one flat `choices` array:

- If the Suggestions list is non-empty:
  1. Suggestion choices first (same title format as today: `★ [Followed] Artist - Album (Date)`).
  2. A non-selectable divider choice: `{ title: '── Full List (A–Z) ──', value: null, disabled: true }`.
  3. Then **every** album in `enrichedAlbums` (including the ones already shown in Suggestions), sorted by `artist.localeCompare()` (tiebreak: album title, then existing chronological comparator for stability).
- If the Suggestions list is empty: skip straight to the A–Z list, no divider.
- `selected: album.isFollowed` pre-selection behavior is unchanged for every choice.

**Duplicate-selection handling:** the Suggestions choice and the A–Z choice for the same album point at the *same* album object reference (not a clone). If a user selects both occurrences of one album, `response.selectedAlbums` will contain that object reference twice. Before generating calendar events, dedupe with `[...new Set(response.selectedAlbums)]` — correct because it's the same reference, and cheap.

## Export

After the multiselect returns, skip straight to event generation using the Step B `{ destination, calendarId }` — no further prompts. The ICS-writing, Google-event-adding, and Outlook-event-adding branches are otherwise unchanged from current behavior.

## Testing

Manual pass through these scenarios (no automated test suite exists in this project today):

- No Spotify configured → no Suggestions block, plain A–Z list.
- Spotify connected, ≤10 followed-artist albums → Suggestions = all of them, soonest first.
- Spotify connected, >10 followed-artist albums, fresh token with `user-top-read` → Suggestions ranked by top-artist position.
- Spotify connected, >10 followed-artist albums, stale token predating the scope change → graceful fallback message, Suggestions ordered by soonest release.
- Each calendar destination (Local, Google, Outlook) chosen upfront, including first-time login for each provider.
