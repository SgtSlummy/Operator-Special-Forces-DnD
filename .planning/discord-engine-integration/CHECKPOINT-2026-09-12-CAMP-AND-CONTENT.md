# Camp UI and campaign content identity — 2026-09-12

The full product goal remains active. This is partial evidence for UX-01 and RUN-01; it is not the Saltglass pack or full 45-state acceptance.

## Functional Camp view

The compiled private table now offers Open → Camp. The player can draft a check-in, conversation, rest request, or their own downtime idea. These controls select only the existing server-offered `describe` action and populate its `text` field; they do not create an engine permission or invoke a mechanical rest. The player edits the text and explicitly sends the request through the existing persisted action/recovery boundary. The confirmation says the request is awaiting a ruling. Missing permissions, blocked decisions, pending choices, and the GM overview offer no downtime submission. Journal and Map remain reachable.

Source: `raphael-council/app/hollow-lantern/page.tsx`; final source receipt 536, preceded by 514–517, 528, 530–531. Gortex receipts are not Git commits.

Executed evidence:

- Type checking and full local production build passed after the final labels.
- The compiled UI rehearsal `.planning/discord-engine-integration/browser-camp-rehearsal.mjs` passed at desktop 1440×1000 and phone 390×844 using keyboard submission and isolated synthetic API responses.
- Each scenario produced exactly one `describe` request with the edited text, original actor, view token and revision. Choosing an idea sent nothing. The received request cleared its pending receipt, displayed Awaiting a ruling, and preserved the supplied HP. Non-granted direct-rest actions were absent from the Camp menu. Pending-state requests were disabled and the GM overview could not submit.
- No page errors or horizontal overflow. The phone preview was visually inspected; labels were revised and the rehearsal rerun.
- Final report/screenshots: `C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/browser-camp-1789249263327/`.
- Existing service, contextual-action and action-recovery suites passed 51/51.

This establishes real compiled UI behavior against controlled responses, not live campaign completion or proof that a requested rest was adjudicated in a real session.

## Current content pinning

New `LanternContent.Create` campaigns store the implemented identity:

`{packId:"hollow-lantern",packVersion:1,rulesId:"hollow-lantern-rules",rulesVersion:1}`

`LanternAuthority` checks it before initial preparation/save or loaded receipt restoration. Unknown keys, unsupported IDs/versions and incompatible module versions are rejected. Missing/null metadata remains legacy; existing campaigns are not silently migrated. Only the implemented Hollow Lantern identity is accepted. No Saltglass ID is accepted or advertised, and no selection/migration API was added.

Files: `LanternState.cs`, `LanternAuthority.cs`, `RpgIntegration.Tests/LanternContentPinTests.cs`, and the existing test runner `Program.cs`. Rollback snapshots of previously existing files are under `C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/content-pin-before`.

The full C# harness exited zero, including 32 new checks for new/legacy state, save/reload, unsupported metadata, rejected command attempts to change metadata, original receipt replay/fingerprint, and pending inspiration continuation. Existing recovery, journal, director, combat, armor and inspiration suites also passed. Independent bounded review found no defect in exact-key/version validation or validation ordering; its source budget did not independently cover creation and continuation bodies.

## Verification limits and next work

Gortex guards found none; contracts allowed the relevant UI and engine changes. Its test map did not associate these acceptance checks with the changed symbols. Detect was deferred by failed/pending indexing receipts; physical builds and executed tests passed. No manual daemon restart or source-tool fallback was used for mutation.

Remaining work includes the actual versioned Saltglass story/rules pack, full human-GM run and advancement, all 45 player states, live cross-surface sessions, restart recovery UX, journal compaction/performance, and documented Figma/Unity prerequisites. No live Discord, AI model, campaign store, public deployment, paid route, or new recurring task was invoked by this slice.
