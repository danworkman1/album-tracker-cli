# Auth Strategy

The CLI should feel like a normal consumer tool:

1. User picks a provider in the terminal.
2. CLI prints the authorization URL and opens the browser automatically.
3. Provider redirects to a localhost callback.
4. Browser shows a success page.
5. Terminal confirms auth succeeded and continues after Enter.

No user should manually generate API tokens. Local credential files should only store OAuth access tokens, refresh tokens, expiry data, and non-secret app IDs.

## Provider App Credentials

OAuth still requires each provider to know which app is asking for access. For a tool intended for other people, the project should own and ship the OAuth app configuration where provider policy allows it.

- Spotify: use Authorization Code with PKCE. Users need only a client ID for local development, and a distributed CLI can ship the project-owned client ID.
- Google Calendar: users currently need a client ID and client secret. For broad distribution, create and verify a project-owned OAuth app so users only see the browser consent flow.
- Outlook: use a public/native Microsoft app registration where possible. A distributed CLI can ship the project-owned client ID.

## MCP

An MCP server can help agent-driven workflows authenticate to Spotify or other services, but it should not be the default dependency for this CLI. Requiring MCP would make ordinary users install and configure an agent runtime before they can use a calendar tool.

MCP can be added later as an optional auth/data provider behind the same internal provider interface. The default CLI path should remain direct OAuth in the terminal and browser.
