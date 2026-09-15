# App foundations — 10 September 2026

The first-use flow now opens the configured Hollow Lantern campaign, checks the existing Discord session, checks the authorized engine view, and offers a clear next action. This work is built and verified locally. The running immutable Activity release has not been replaced.

## Implemented

| Function | Result |
| --- | --- |
| Protected Windows launch | Starts the installed Vinext JavaScript CLI through Node. Arguments remain literal, including spaces and shell characters. Missing configuration and dependencies produce bounded guidance without printing secrets. |
| Stop and failure handling | Forwards SIGINT/SIGTERM to the child, removes lifecycle listeners, and preserves failed or signal-based exit status. |
| Correct home screen | Hollow Lantern receives its own responsive entry screen at request time. A Discord frame still opens the existing Activity connection flow. Legacy campaigns retain their current home screen. |
| Sign-in and resume | Checks campaign configuration, session identity, membership, and the authorized engine view in order. A ready state provides the actual Hollow table link. Opening the page does not enroll characters or submit game commands. |
| Correct OAuth return | Browser sign-in returns Hollow Lantern to `/hollow-lantern`; legacy campaigns retain `/play`. Hollow browser OAuth errors return a fixed recovery category to the welcome screen. |
| Sign-out and account recovery | Revoked accounts can clear their sign-in. Failed sign-out stays visible and does not pretend the session was cleared. |
| Loading and connection failures | Bounded requests, cancellation of obsolete checks, manual retry, distinct sign-in/enrollment/configuration/offline states, and no raw provider errors in the entry UI. |
| Phone layout | Primary entry action remains visible and full width. No horizontal overflow at 390 px. Keyboard focus and status announcements are provided. |

## Evidence

- 41 focused Node tests passed: entry connection, browser authentication routing, protected launcher, existing Activity connection, and existing Discord authorization tests. The launcher includes a real harmless Node child under a path containing spaces.
- Production build passed with `node images/host.mjs build`.
- Targeted lint passed for the changed entry, authentication HTTP, launcher, and fixture files.
- Headless Chrome passed at 1365×1000 and 390×844, including clicking into the actual Hollow table page and receiving its fixture briefing. The run also checked sign-in, failed logout, revoked-account recovery, offline engine handling, safe OAuth recovery, manual retry, overflow, and browser errors.
- The first navigation check caught a production client-navigation exception (`e is not a function`) on the entry link. The entry now crosses into and out of the private table with full document navigation. The failing screenshot/record were retained, and the complete browser sequence passed after the repair.
- The browser run uses explicit simulated API responses, not real Discord credentials or gameplay. Its six screenshots and results are under `C:/Users/Hermes/LocalFiles/hollow-lantern/app-foundations-20260910`.
- The complete TypeScript check remains non-green with nine existing errors in `app/game-lab/page.tsx` and `app/layout-lab/page.tsx`. No errors were reported in the changed files.
- Gortex impact/detect calls still resolve this task to the stale untracked OneDrive directory. No graph guard or contract pass is claimed. Native checks were used after the actual integration failure.

Reproduce from the canonical `raphael-council` directory:

```powershell
node --test app/entry/connection.test.mjs scripts/start-protected.test.mjs client/activity-connection.test.mjs auth/discord.test.mjs
node images/host.mjs build
node scripts/entry-browser-check.mjs 'C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json' 'C:/Users/Hermes/LocalFiles/hollow-lantern/app-foundations-20260910'
```

The browser fixture uses installed Chrome in an isolated temporary profile, starts one temporary loopback web server on a free port, and closes both. It does not use the signed-in Discord browser, launch Davy, start Unity, or modify a campaign save.

## Remaining execution gates

The last live Discord OAuth check failed with `invalid_client`. Credentials were not changed here; live sign-in and the complete real-account return flow still require that repair. The existing immutable Activity deployment remains under its current deployment owner and must consume a tested build through the coordinated release path.

The [app execution foundation](app-execution.md) adds `app:check` and `app:start`: read-only prerequisite checks, saved-campaign validation, signed engine readiness, duplicate web-process detection, an owned HTTP startup handshake, and child-only shutdown. The web launcher does not supervise Unity, the Davy gateway, the private AI worker, or image generation. The entry screen still verifies the authenticated game view. Coordinated recovery of those external dependencies remains separate work.

Campaign saves, Davy's gateway, music, and the protected private AI worker were not changed by this work. Davy's readiness endpoint still returned `ready`, and the original campaign save retained SHA-256 `5457671d252dd51dfde5a964fd7eac47e52cd488c48292184da175ddc980e33e`.

The full mission, autonomous combat continuation, real Discord/Activity parity, restart recovery across all services, and isolated human-style visual acceptance remain release gates. This foundation work does not declare them passed.
