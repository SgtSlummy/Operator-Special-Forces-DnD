# AI action recovery checkpoint — 2026-09-12

The full Discord D&D product objective remains active. This checkpoint records a tested recovery slice, not a full release or live campaign adoption.

## Implemented

- The isolated player browser permits POST /api/hollow-lantern/resolve through its existing authenticated, serialized action boundary. It requires the original pending command, revision, campaign and actor, and validates terminal engine proof before clearing memory.
- Durable pending storage must clear successfully before proof reaches the player. Storage failure returns 503 without terminal proof, preserving recovery on both sides.
- The campaign AI exposes getDirectorRecovery and resolveDirectorRecovery for the configured, currently authorized human GM. Explicit resolution requires paused human-GM mode, uses the complete stored AI command, shares the director queue, and never submits a replacement gameplay action.
- The director remains held after explicit resolution until a later authenticated GM event opens AI mode with a newer authority epoch. Membership, mode, command identity and durable store CAS are rechecked before clearing.
- Browser tests now dispose unconsumed response bodies after each case. This resolves the full-suite container timeout without increasing timeouts or weakening production isolation.

## Evidence

- Combined AI runtime, director, recovery store, browser boundary and visual party: 72 passed; 2 optional browser cases were subsequently executed in the real browser suite.
- Real isolated browser suite with HOLLOW_BROWSER_FIXTURE=1: 19/19 passed, no skips. The container used network none, read-only filesystem and no host mounts.
- Additional startup, supervisor and voice suites: 36/36 passed.
- Type checking and the full local production build completed successfully.
- Gortex detect completed; both changed runtime entry points have test coverage. Guards returned none. Contract analysis reported broad existing impact; its named covering suites passed.
- Screenshot reviewed: C:/Users/Hermes/LocalFiles/hollow-lantern/scene-design-20260910/player-browser-boundary/screen.png. The compiled table renders correctly in paused human-DM mode with actor-private content.

## Source receipts

Browser production: 472–476. Browser tests: 469 and 485–487. AI runtime: 477–483. Director tests: 484. These are Gortex mutation receipts, not Git commits.

## Remaining integration

The native Discord human-GM recovery controls are now connected through the existing owner in `C:/Users/Hermes/Projects/Davy Jones/src/discord/hollow-lantern-config.js`. The earlier startup search was limited to the operator workspace: its absence of production callers did not establish absence in the separate Davy project. Davy already creates the campaign AI and mounts art review. It now mounts `createDirectorRecoveryAdapter` using that same closure-owned instance, adds a private GM entry, and closes the adapter during normal and failed startup cleanup.

Concurrent startAI calls now share one promise. Shutdown blocks new starts and controls, waits for an in-flight factory, closes any late-created AI before its host, and attempts the remaining owned cleanup even if one close fails. No new controller owner was introduced.

Adapter source/test receipts: 497/493. Gateway source receipts: 489–492, 494–496, 498. Gateway test receipts: 499–511. All are Gortex receipts, not Git commits. The batch-edit attempts rolled back on Windows rename sharing violations; individual Gortex file edits succeeded.

Verification: 23/23 gateway/configuration tests passed with `HOLLOW_LANTERN_RUNTIME_TEST_ROOT` set to the canonical game runtime. This includes importing the real adapter, opening its private GM panel through the registered gateway handler, resolving through the owned synthetic AI instance, and duplicate-click suppression. Separately, adapter/art-review/director-runtime suites passed 38/38, including seven new authorization and token-binding cases. No real Discord delivery or model invocation occurred. Gortex detect completed for Davy; guard checks found none and contract allowed the change, but its test map did not resolve this cross-workspace owner, so the explicit executed tests are the coverage evidence.

Full-plan work also remains for restart recovery UX, journal compaction/performance, all designed player states, live cross-surface acceptance, and the documented Figma and Unity external prerequisites. No live campaign, Discord publication, deployment, model invocation or new recurring task was performed by this slice.
