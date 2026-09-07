# Private membership bridge

The membership bridge lets Davy Jones check current Operator campaign membership without importing the game web host, AI platform or another Discord gateway. Each authorization request calls the canonical `GameStore.member({campaign, owner})` and allows only the current `host` role in an explicitly allowed campaign. It does not grant rules, AI, provider, transcript or repository authority.

`bridge/server.mjs` binds only to literal `127.0.0.1`. `bridge/client.mjs` is for server-side Davy code. Never expose this service through the public game tunnel, Discord Activity proxy, browser UI or a public network bind. The bridge credential stays on the host and is separate from the Discord bot token and Obus service token.

## Host configuration

| Variable | Requirement |
|---|---|
| `RAPHAEL_MEMBERSHIP_PORT` | Optional decimal port 1–65535; defaults to `38176`. |
| `RAPHAEL_MEMBERSHIP_CAMPAIGNS` | Required comma-separated allowlist of 1–100 unique campaign IDs. Each ID is 1–64 ASCII letters, digits, underscores or hyphens. Spaces around commas are trimmed. |
| `RAPHAEL_MEMBERSHIP_TOKEN` | One possible token source: 32–512 printable, non-whitespace ASCII characters. |
| `RAPHAEL_MEMBERSHIP_TOKEN_FILE` | Alternative token source: an absolute path to a private file containing the token. One final LF or CRLF is accepted. Configure exactly one token source. |
| `RAPHAEL_GAME_DATA_DIR` | Existing private game data directory resolved by `gameConfig`. Its `game.sqlite` must already exist. If omitted, the normal private game directory is used. |

The launcher verifies the actual resolved database path and SQLite header before opening `GameStore`. Missing, empty and non-SQLite files are rejected; it never bootstraps a new empty game database from a mistyped path. OneDrive paths, resolved links into OneDrive, and configured OneDrive sync-root boundaries are refused. The normal start uses the canonical game-store opener and its supported schema setup; use the coordinated host backup process before a live schema transition.

Token generation and rotation belong to the host supervisor setup. This launcher does not generate tokens, write credential files, print tokens or relay raw driver/configuration exceptions. Tokens are also omitted from serialization of its configuration object. Store token files under the private host account with restricted access.

## Explicit commands

Use Node.js 22.16.0 or later. From `raphael-council`:

```powershell
node --env-file-if-exists=.env.local bridge/host.mjs --check
node --env-file-if-exists=.env.local bridge/host.mjs
```

`--check` validates configuration, reads the token and verifies the existing database file through filesystem operations. It does not open SQLite, run migrations, create a database or start a listener. Its JSON result includes `mode:"check"` and `listening:false`; `ready:true` means configuration validation succeeded, not that a service is running or a campaign membership lookup has been performed.

The command without `--check` explicitly starts the loopback listener and opens one dedicated game-store connection. It prints a safe readiness record with the listener URL. Importing `bridge/host.mjs` does not start a service. No npm script, recurring task, service registration, token generation or bot activation is added by these files.

SIGINT and SIGTERM join one shutdown operation. The launcher waits for the bridge to close before closing its own GameStore connection. Startup failure closes a successfully opened owned connection. It does not close any other game process, Obus runtime, Discord client, music connection or provider service. Cleanup failures are reported without raw exception contents.

## Davy injection

Use the bridge client only in the existing Davy server process:

```js
import { createMembershipClient } from './bridge/client.mjs';

const membership = createMembershipClient({
  url: 'http://127.0.0.1:38176',
  token: privateMembershipToken,
});

const chronicleOptions = {
  // Other explicit Obus, shared-voice, transport and chronicle-store dependencies.
  authorizeCommand: scope => membership.authorizeCommand(scope),
};
```

The owner must be the authenticated Discord account ID, and the campaign must come from the existing trusted game binding. Do not accept client-supplied role claims or substitute a cached host role. The server requires a 17–20 digit Discord owner ID and checks the current database role on every request. Campaigns outside the configured allowlist are denied. Davy's chronicle adapter must also enforce its current Discord guild/role checks.

Unavailable service, invalid credentials, unknown membership, revocation, malformed/oversized replies, timeout and redirect all fail closed. Do not fall back to `true`, a previously cached permission, or an AI decision. An authenticated status check proves service connectivity; it does not authorize a user. Both implementations keep request/reply scope bounded to membership data.

The portable `@operator/chronicle` artifact remains unchanged. This bridge supplies the explicit server-side authorization callback required by its durable commands. Complete handler integration and real shared voice acceptance still belong to the existing Davy gateway; these files do not register commands or activate that bot.

## Verification

`node --test bridge/host.test.mjs` uses disposable databases and ephemeral listeners only. It covers invalid configuration, missing/empty databases without creation, secret-safe check output, an actual `--check` with an occupied port, token-file bounds, OneDrive/junction refusal, startup cleanup, a real temporary GameStore authorization bridge, current-role changes, and shared signal/drain ordering. It does not inspect or migrate live campaign data.
