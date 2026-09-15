# Hollow Lantern Activity production preparation

The project's production command is `npm run build:local` (Vinext's Next-compatible Node build). On 2026-09-09 it passed all five production stages, including `/activity` and the four `/api/hollow-lantern` routes. No source changes were needed to make the build pass. This is a build and loopback smoke result, not an actual Discord Activity acceptance result.

## Protected local launch

Run from `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\raphael-council`:

```powershell
$env:HOLLOW_ACTIVITY_BASE_ENV_FILE = 'C:\Users\Hermes\Projects\Davy Jones\deployment\.env'
$env:HOLLOW_ACTIVITY_NATIVE_ENV_FILE = 'C:\Users\Hermes\Projects\Davy Jones\deployment\.env.native-gateway'
node hollow-lantern/activity-launch.mjs --check
node hollow-lantern/activity-launch.mjs
```

Only file paths appear in commands. Credentials stay in the existing protected files and child environment. The launcher binds `127.0.0.1:18796`; it neither creates a tunnel nor logs configuration values. Stop its foreground process with Ctrl+C. Do not use `npm start` directly: its default binding is broader and its environment may contain old campaign settings.

Base configuration is followed by the native overlay. The launcher explicitly replaces campaign, guild, and DM bindings with Hollow settings before importing the server, clears inherited player/role eligibility unless the native overlay explicitly supplies it, and forces local Node mode. It requires the existing engine URL, engine secret file, campaign save, art directory, and dedicated Activity OAuth directory. Paths beneath OneDrive and non-loopback engine URLs are rejected. It does not open the gameplay store itself; HTTP authentication uses the existing read-only engine membership facade. First authentication runtime initialization may initialize the dedicated OAuth SQLite schema, never game mechanics.

## Entry mapping

The existing `/` page selects the Activity shell when Discord supplies `frame_id`. `/activity` is also an explicit SDK entry route. The parameter chooses presentation only; Discord OAuth and fresh membership authorize every game view/action.

For a separately authorized HTTPS reverse proxy forwarding to this loopback service, configure Discord **Activities → URL Mappings** with prefix `/` and target `<owned HTTPS hostname>` without the protocol. Preserve `/api/*`, assets, cookies, and query parameters. Do not map the entire root to a target ending in `/activity`: that can also prefix API and asset requests. The existing frame-aware root makes a rewrite unnecessary. If an upstream needs an explicit landing rewrite, rewrite only the exact `/` document request to `/activity`, preserving its query; do not rewrite the API or asset paths.

Discord's official [URL mapping rules](https://docs.discord.com/developers/activities/development-guides/local-development) specify directory targets without a protocol; its [networking guide](https://docs.discord.com/developers/activities/development-guides/networking) describes proxy-relative requests. No public hostname, tunnel, Developer Portal setting, or launch command was changed during this preparation.

## Verification and remaining acceptance

- Actual production loopback smoke: `/activity` and `/?frame_id=local-smoke` returned 200 with the SDK connection shell. No private game state was rendered into those documents.
- Unauthenticated `/api/hollow-lantern/view` returned 401 with no private payload. The temporary server was stopped after this check.
- Launcher checks proved stale campaign overrides, inherited eligibility clearing, remote-engine rejection, and OneDrive-path rejection. Actual protected-file `--check` passed without starting a service.
- Plain `/` without Discord frame parameters still presents the existing companion shell; it does not silently authenticate or enroll anyone. Hollow legacy mechanics guards remain in force.
- Pending: authorized HTTPS routing and Developer Portal mapping, real Discord SDK OAuth/cookie flow, membership revocation and character switching in the Activity, ordinary controls with engine receipts, and private map attachment/screenshot acceptance on desktop/mobile. The local standalone table on 18792 is not this Activity.

The production server must use the same Unity campaign and committed-event follower as Davy. Never mount a legacy GameStore as the Hollow authority. Keep the live campaign paused during the eventual connectivity verification.
