# Reviewed-save browser lifecycle evidence

Observed on 2026-09-06 using the Codex in-app browser and CUA accessibility/Playwright actions at `http://127.0.0.1:49719/`. This is a manual interaction record, not an automated browser suite or full Raph release certificate.

## Scope and exact source

The fixture rendered the actual `CheckRequestPanel`, `ReviewedSaveRequestForm`, `PendingDamageNotice` and `SavedDamageDetails`. Its fetch boundary simulated host options, request persistence and failures in memory. No live authentication, game database, Discord, image generation or random dice were used in this browser fixture. The separate HTTP integration test exercises real SQLite and PNG rendering.

Sources during the observations:

| File | SHA-256 |
| --- | --- |
| `app/play/check-consequences.tsx` | `117d416b76f596516b4f6dc3f60b8bc615670a2f5c84093cd3b414dedd76f296` |
| `app/play/check-request-panel.tsx` | `f8ed204e2b639455f559821369696db2d9a9dde98aab0257b9a3957f11feae20` |
| `research/check-review-fixture/main.tsx` | `5439c81dec2e435bdd9531cab425042d4f639889d5b39ff123145497797e2ff1` |
| `research/serve-check-review-fixture.mjs` | `31442b9a3a1d123da3abb6d9558f7538c4751ed6c5f7398e89a92fc9b21ea974` |

Fixture corrections before testing: preparing a check leaves the game revision unchanged; successful responses include the check label; stale responses include `STALE`; a pending concentration control exposes the same authoring lock as the server. These are fixture corrections, not evidence of product defects.

## Observed cases

1. **Lost response after commit.** Entered the real form's target, label, proficiency review and defense review, checked the review confirmation, then submitted with the fixture's loss mode. The form showed the interrupted-connection message, disabled its fields and offered “Retry same saved request.” The fixture showed one committed check and one POST attempt. Retrying produced two POST attempts, exactly one commit and one replay, with one successful callback. Both attempts used ID `78cb2a3a-1ede-4f37-8819-db91a0b3b73b` and body SHA-256 `99149bb230c0d5a13a86e07233553468602e84a933753b3cdd1c135df25e12e4`. Success cleared the form and showed “Requested Burning bridge.”

2. **Persisted-result presentation.** The real pending notice showed failed-save fire damage and successful-save half damage. The fixture's separate result action then passed fixed persisted values to the actual result component: d6 `[6, 5]`, bonus `+2`, total and applied damage `13`, HP `20` → `7`, receipt revision `12`. Every value was visible in the saved result definition list. This validates rendering of a supplied receipt, not calculation or actual map pixels.

3. **Confirmed stale rejection and failed refresh.** A request at revision `10` received HTTP 409/STALE without a commit. The form disabled fields and review, and required “Refresh game for a new review.” A rejected refresh callback kept both review and submit disabled, preserving the draft and displaying the failed-refresh message. A successful refresh moved the parent and options to `11`, preserved the draft, and left review unchecked and submit disabled. Checking review again permitted a new request. The rejected ID was `43e03b7e-6d0f-4767-b693-076d69854314` (body hash `b6ba0709564064a6e926d414433c1a060a948827e276377594087cb71e82ef87`); the new ID was `207f5a95-0cf8-4c4e-b02b-89cbb692582c` (hash `d8e880257ab079925a8761159dc3c2131aa4667dcc736dd01405b87e997cb27b`, expected revision `11`). There was one commit across those two attempts.

4. **Parent/options mismatch.** A reviewed, unsubmitted draft was retained while options advanced beyond the parent map revision. The wrapper disabled review and submit and exposed “Refresh map and controls.” A failed wrapper refresh left them disabled with an explicit failure message. After recovery, the label remained “Unsubmitted draft,” review was unchecked, review was enabled, and submit remained disabled. Refresh did not erase the draft or silently approve it.

5. **Pending concentration.** Enabling the fixture's pending concentration lock disabled submit and displayed “Resolve the pending reaction or concentration save before preparing another save.” The server's lock itself is independently covered by the checked-damage HTTP regression.

6. **Session denial.** Returning 403 from the options endpoint removed the actual host form: the rendered `Request a save with damage` region count was zero. Restoring host access produced a fresh form with an empty label. This proves handling of a denied response, not a deployed login flow.

7. **Campaign isolation.** Entering “Do not carry into beta” and switching from fixture alpha to beta created a collapsed, fresh panel. On opening it, the label was empty and review unchecked. Beta had zero POST attempts and zero committed checks. The fixture-wide callback counter intentionally remains global and is not a campaign receipt count.

## Local execution and limits

From the app directory, start with `node research/serve-check-review-fixture.mjs` and open the printed loopback URL. The launcher uses installed Vite and the React plugin with no application config or API proxy. Launch checks observed HTML and transformed fixture JS at HTTP 200, `/api/game/checks/request` blocked at 404, and a direct request for `game/runtime.mjs` outside allowed UI directories blocked at 403. Targeted ESLint and `tsc --noEmit --incremental false` passed after fixture changes.

The fixture tab was closed after testing. The launcher owner stopped its exec session `71652` with Ctrl-C and verified that `127.0.0.1:49719` refused connections (`ECONNREFUSED`). Root could not address the child agent's scoped session handle directly, so cleanup was performed by that owner; no unrelated process was stopped. Existing shared `app/play/page.tsx` and `app/play/checks.tsx` were not changed by this browser exercise. Mounting these components into the actual Play page, complete player history/map refresh through that page, real multiplayer authentication, and the full connected campaign journey still require verification. The full Raph integration goal remains active.
