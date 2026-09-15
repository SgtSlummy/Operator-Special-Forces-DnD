# Campaign authentication and browser routing — 2026-09-12

The full plan remains active. This supersedes the prior registry checkpoint's statement that auth and table-browser routing were unchanged. Entry-page selection is still incomplete; multi-campaign end-to-end readiness is not claimed.

## Implemented

- Auth HTTP resolves the selected campaign platform. OAuth state carries a canonical campaign binding and is checked against the selected campaign's own stored state. Session and state cookies are namespaced for catalog campaigns. The registered callback URI and legacy cookie behavior remain compatible.
- Malformed or duplicate selectors, foreign campaign cookies and invalid wrapped state are rejected. A regression found by existing entry tests was corrected: missing legacy OAuth state reaches the established sign-in recovery flow, while duplicate state remains rejected and catalog callbacks require wrapped state.
- client/api.mjs forwards one validated campaignId to auth and Hollow Lantern requests, including Discord proxy requests. An explicit request campaign wins over the browser's currently selected campaign. Unrelated API paths are unchanged. IDs match the catalog's ASCII letter/digit/underscore/hyphen rule, 1–64 characters.
- The campaign table includes selected campaign IDs in its request/stale-response scope, resets old character/view state when that selection changes, and sends action or receipt requests using the campaignId stored with the pending action. URL query updates use the existing Next-compatible search-parameter hook inside a Suspense boundary.
- Two type errors in the touched table page were corrected. Other lab-page type errors remain open.

## Verification

The root independently passed a final combined 77 Node tests, exit 0:

    node --test client/api.test.mjs client/campaign-api.test.mjs app/entry/connection.test.mjs app/hollow-lantern/action-session.test.mjs auth/http.test.mjs auth/discord.test.mjs auth/interchangeable.test.mjs hollow-lantern/campaign-registry.test.mjs hollow-lantern/activity-runtime.test.mjs hollow-lantern/activity-transient-auth.test.mjs

Run from the canonical project's raphael-council directory. Browser routing tests failed before the fix. Auth acceptance tests also observed a failure before implementation. Tests use local fixtures/mock OAuth responses; no real Discord login or voice session was performed.

The full TypeScript check still exits 1, reporting nine errors confined to app/game-lab/page.tsx and app/layout-lab/page.tsx. It reports no remaining errors in the touched campaign table. A rendered browser walkthrough, full application build and real two-campaign engine/auth session are not yet verified.

## Remaining connected work

Home/Welcome still needs to derive and retain the selected campaign. Its ordinary anchors intentionally avoid a previously observed Vinext navigation issue; preserve ordinary anchors while adding the selected campaign to the home, table and Discord sign-in links. inspectCampaign must use explicit matching selection for its configuration/session/view checks. Do not send a private catalog descriptor to a browser: registry.catalog.get(id) contains private paths, so pass only required public fields.

The entry worker acquired source and prepared the change, but made no entry edits because the impact gate again refused pending atlas indexing and failed atlas mutation 326. That specific failed receipt was reported to its owning task for reconciliation. No source was discarded or blindly reapplied.

Trusted direct registry runtime access, configuration-cache regression coverage, two actual isolated engine stores, full restart/revocation/recovery rehearsal, voice consent/review/interruption, all 45 player states, native Figma delivery, Unity migration and public beta remain open. Safe terminal cancellation still needs a fence that survives the engine's backup fallback.

## Tool state and ownership

Root browser/table changes committed through 322; auth compatibility correction through 331. Gortex impact and signature checks succeeded before these mutations; the signature check found no caller violation. Final graph detection remains incomplete because the shared index is pending. Auth contract analysis allowed the behavioral change and no guard rules were configured; executable tests provide the confirmed validation above.

Coordinator claim revision 15 covers the current Node/auth/entry work. Completed C# file reservations were released to keep the claim within the helper's path limit; the full requirements ledger and goal were not reduced. Reacquire those exact paths before further engine edits.

All project work remains under C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons. No live campaign configuration, user data, deployment, paid service or Discord message was changed by this slice.
