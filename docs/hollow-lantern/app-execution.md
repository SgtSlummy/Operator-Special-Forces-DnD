# App execution foundation — 10 September 2026

Run from `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\raphael-council`.

```powershell
npm run app:check
npm run app:start
```

`app:check` checks the existing campaign save, protected engine settings, Discord configuration, a signed public engine view, the web port, and the presence of the production build. It does not create a save, initialize an OAuth database, prepare a build snapshot, submit a game action, or start any service. Every result names the selected campaign. Configured Discord credentials are not reported as verified credentials.

`app:start` performs those checks and then starts one web process from a verified immutable production snapshot. The process must report that it is listening and answer an HTTP health request with the expected campaign, application and launch identity before the launcher reports success. The existing welcome screen then checks the user's sign-in, membership and authorized game view before offering the table.

The default configuration files are the existing canonical Davy `deployment/.env` and `deployment/.env.native-gateway`. This currently selects `operation-hollow-lantern`. To select a separate rehearsal, supply its complete existing campaign binding through `HOLLOW_ACTIVITY_CAMPAIGN_ENV_FILE`; the launch does not silently choose or create a rehearsal. The existing `HOLLOW_ACTIVITY_BASE_ENV_FILE` and `HOLLOW_ACTIVITY_NATIVE_ENV_FILE` overrides remain supported. Credentials stay inside the protected files and child environment.

## Start and stop behavior

- An existing web app with the same campaign and application identity is reused without replacing its process or changing its build.
- An occupied, unrecognized, unavailable or differently bound web port blocks launch. There is no automatic process termination or port switching.
- Missing prerequisites produce an explanation. Unity, Davy, private AI workers and image providers remain separately managed dependencies. This launcher does not start duplicate gateways or retry a policy-denied worker restart.
- Ctrl+C asks only the owned web child to close. The launcher observes its exit, handles a startup cancellation, and reports incomplete shutdown if termination is not confirmed. Closing a launcher that found an existing app leaves that app running.
- If the launcher disconnects while the child starts, a late-created server is closed. Unexpected termination reports failure, including an unexpected zero exit code.
- Opening or closing the web app does not advance, reset or overwrite campaign saves. Startup does not authorize a character, approve a DM ruling or open an AI decision opportunity.

`/api/health` is an inert liveness endpoint. It returns a small public campaign/application identity and launch marker, never a save, account, secret, map or authorization result. It opens no stores. It is intentionally outside the current public Activity edge allowlist. The launcher checks it on loopback; authenticated game APIs remain authoritative for private access and game readiness.

## Verification

Focused tests cover signed read-only readiness, bad or mismatched saves, local paths, secret-file parsing, safe error output, endpoint validation, occupied ports, cancellation, failed startup, readiness identity and observed shutdown. A real disposable Vinext process demonstrates immutable startup, HTTP delivery, second-launch reuse and shutdown. Another real-process check disconnects the parent during server import and verifies that no listener survives.

The production build passed. Browser evidence is retained separately under `C:\Users\Hermes\LocalFiles\hollow-lantern\app-execution-20260910`. The entry-browser fixture uses simulated API replies with actual production pages, isolated desktop/phone browser profiles and no live game decisions. It is not Discord or blind-participant acceptance evidence.

The first actual signed-out browser check caught a real entry defect: `/api/auth/session` returns HTTP 200 with `scope:null` when no session cookie exists, while the entry checker had assumed a signed-out response would always be HTTP 401. This showed misleading host-repair guidance and hid sign-in. The checker now handles the real null-session response. A regression test calls the actual auth HTTP handler, and the browser fixture uses that response shape. The first failure screenshot and response record remain preserved as `live-web-failure-1.*`.

The corrected production build passed desktop and phone entry checks in `corrected-entry`. The actual running app then passed a fresh signed-out browser check with no simulated API replies: the expected sign-in screen appeared, there were no browser exceptions, and only GET configuration/session requests occurred. `live-web.json` and `live-web.png` preserve that result. The original save stayed at revision zero with SHA-256 `5457671d252dd51dfde5a964fd7eac47e52cd488c48292184da175ddc980e33e`. `runtime.json` identifies the running owned web process and launcher; `release.json` identifies the immutable build. This check did not click consent, exchange credentials or submit gameplay.

The saved replacement Discord credentials passed the separate account/application and client-credentials checks on 10 September. At 14:51 UTC the web app, public entry and Davy had been reloaded with the existing original/rehearsal bindings preserved. Browser sign-in now returns the exact Discord authorization redirect with a secure, HttpOnly state cookie. The public root serves the welcome screen, while root requests with `frame_id` and explicit `/activity` requests serve the Activity screen. Unauthenticated game views still return 401 and the public management probe returns 404. The callback address must still be registered in Discord, followed by real-account consent and token-exchange verification; a correct redirect is not completed sign-in. Evidence and encrypted configuration rollback are under `C:\Users\Hermes\LocalFiles\hollow-lantern\credential-reload-20260910`.

The callback-registration requirement above applies only to standalone-browser sign-in. The separate 15:12 UTC application check confirms the existing `/activity` redirect, Embedded setting and Activity launch command are already configured. The Discord Activity can therefore be taken through its own real-account launch and authentication check without adding the browser callback first. Evidence: `C:\Users\Hermes\LocalFiles\hollow-lantern\discord-credential-setup\activity-entry-verification.json`. Registered settings do not establish successful authenticated Activity use.

Both original revision-zero and rehearsal revision-76 save hashes remained unchanged. Davy reported ready with autoplay not started; neither Unity process was restarted. This work does not establish unattended full-stack recovery, voice acceptance, a complete mission, or live Discord/Activity parity. The private-worker policy denial remains in force. The broader project's existing type/lint/release findings are not superseded by these focused checks.

The source endpoint mismatch is fixed: Activity configuration now accepts the same private loopback root URL shape as the engine client. Earlier `activity-launch.mjs --check` behavior still prepares a snapshot; use `app:check` for the new read-only check.
