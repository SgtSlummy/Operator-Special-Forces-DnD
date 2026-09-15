# Activity implementation — September 10, 2026 UTC

**OAuth credentials have been repaired and verified. Do not repeat the old secret-reset instructions. Authenticated Discord Activity play remains unverified.** The user's latest actual Discord screenshots show `account_access`; they do not establish the exact rejected check or which account launched it.

The user completed the credential form at 14:28 UTC. Actual bot/application identity, public-key agreement and OAuth client authentication passed, followed by a coordinated reload and eight independent production HTTP checks. At 15:54:56 UTC, port 18796 returned HTTP 200 with client `1540006061099188274`, experience `hollow-lantern`, and campaign `operation-hollow-lantern`. The original campaign and Davy's separate rehearsal remain intentionally distinct; cross-interface parity is not established.

The registered redirect is `https://loki-2.tail2111c3.ts.net:8443/activity`. Leave it unchanged. `/api/auth/discord/callback` belongs to optional standalone web login and is not required by the embedded SDK flow. Activities and the global Launch command were verified. See [Discord's Activity setup documentation](https://docs.discord.com/developers/activities/building-an-activity).

Real Discord member/guild/role reads and the current original save at 15:36 UTC confirm that **Canna's Cammera Man (Stream Acc)** (`1230264975533281312`) is eligible, has current host authority, and is the saved GM. **Mecha Cannibal** (`294709392798908417`) has current Discord host authority but no original campaign seat. No enrollment changed. The user previously selected the Stream account; their current launching account remains unconfirmed.

Evidence: `C:/Users/Hermes/LocalFiles/hollow-lantern/discord-credential-setup/verification.json`, `reload-acceptance.json`, `activity-entry-verification.json`, `activity-account-access.json`, and `activity-access-evidence/evidence.json`. The last directory preserves both user-supplied Discord failure screenshots, with viewer and screenshot revision explicitly unknown.

The earlier credential reload is retained in `C:/Users/Hermes/LocalFiles/hollow-lantern/credential-reload-20260910/runtime.json`; its web/edge PIDs and release were superseded by the coordinated update below. Do not use archived process IDs as restart targets.

## Current production release and independent verification

**Superseding release at 16:42 UTC:** `3f003faa559417ff4cea89d30554812e97878ae9a2be01b6378bb72ef8deb432`, web PID **29500** / launcher **39112** / port **18796**. Edge **41088** remains unchanged. This release adds verified caller-only identity and specific access-denial messages, plus all six approved local SD scene mappings. It passed 59 combined authentication/runtime tests and the production build. Root's eight local/public HTTP probes passed; independent verification at 16:43:23 UTC confirmed all 20 served JavaScript assets, all five caller diagnostic codes and the “Signed in as” label. Anonymous map/view/illustration requests remain 401/no-store. Evidence: `scene-design-20260910/web-deployed.json` and `activity-auth-diagnostics-20260910/caller-diagnostics-live-verification.json`. Both paused save hashes are unchanged. No session or gameplay was created by these checks. Prior release details below are retained as historical evidence, not current restart targets.

The integration owner deployed release `7c23954406652b73ece12e57d3620a2b8358738b71e8ac3a5a19c8e3a8dda840` at 16:06 UTC, including illustrated routes and the auth diagnostics. Web PID **41828** listens on **18796**; edge PID **41088** listens on **18805**. The deployment record is `C:/Users/Hermes/LocalFiles/hollow-lantern/scene-design-20260910/web-deployed.json`.

Independent actual local/public HTTP verification passed **25 cases**: page/config availability, null anonymous session, private view/map/scene/portrait denial, new Origin diagnostics, legacy-path denial and unsupported illustration-method denial. No real user code, production session or gameplay command was created. The original campaign stayed at revision 0 with SHA256 `5457671d252dd51dfde5a964fd7eac47e52cd488c48292184da175ddc980e33e`.

All **20 JavaScript assets** referenced by the Activity HTML and embedded page/module data returned HTTP 200. The served page chunk contains `origin_not_allowed`, `activity_origin_required` and `campaign_unavailable`, proving the client mapping is published too. This does not establish execution in an authenticated Discord browser or authorized artwork viewing.

Reports are `C:/Users/Hermes/LocalFiles/hollow-lantern/activity-auth-diagnostics-20260910/live-verification.json` and `live-client-bundle.json`. Their initial probes are retained separately: one incorrectly expected 405 where the edge deliberately rejects unsupported methods as 404; the first bundle scan omitted embedded module references. Corrected scope/expectations and the bounded follow-up checks are documented rather than hiding those initial results.

The owner completed the Unity runtime update at 16:09 UTC. Independent OS listener checks confirm original PID **42796** / port **18791** and rehearsal PID **42512** / port **18810**. `scene-design-20260910/engines-deployed.json` records original revision 0, rehearsal revision 76, both paused with exact prior save hashes. Both existing saves retain terrain rules version 0; do not imply that new terrain features were activated in those preserved saves. Discord/Activity campaign parity and actual human sign-in remain unverified.

The user explicitly reaffirmed authorization for maps and illustrations. Continue approved local SD work within the established audience scope; no additional art approval is required. This does not identify the currently signed-in Discord account or change its campaign enrollment.

## Earlier implemented behavior

- Server composition explicitly selects `hollow-lantern` or `legacy`. Config, exchange and session responses carry that selection. Custom rehearsal names open the Hollow Lantern table instead of the old game.
- The connection checks the server campaign, exchanges Discord consent, authenticates the SDK, then verifies the private cookie session before opening the table. Cancellation prevents late consent from sending an exchange. Human consent has no artificial timeout; connection work is bounded.
- Host configuration, account enrollment, expired authorization and transient failures have distinct recovery guidance. Host configuration failures do not offer a futile retry button. Provider payloads and credentials are not shown.
- Known unseated accounts receive a 403 before a session is created. Existing current-membership and GM-revocation checks remain authoritative.
- The DM sees both available ruling responses and their consequences beside the dropdown before selecting. Selection sends no command; confirmation uses the existing persistent command/receipt path.
- Visible tables refresh their authorized projection every 15 seconds. New revisions clear outdated action selection; 401/403 responses clear private content. Polling pauses while hidden or submitting and ends on unmount.
- Mobile presents the map before action controls, with tighter spacing and explicit accessible names on the menus.
- An optional complete campaign environment file binds campaign ID, engine URL, bridge secret path, save path and separate Activity authentication store together. It cannot replace Discord application credentials.

## Historical deployment evidence — superseded by the reload above

The original task released Activity port 18796 for a controlled replacement. The previous PID 32232 and its exact immutable release were checked before stopping that process only. Gateway, edge and both Unity processes were outside this cutover.

Historical Activity PID: **32500**. Retained terminal session: **11685**. Immutable release: `f3094062c76d0e9782148f49685bfedc1e324e7129e09df5668b24c0fdd99f92`. This is not the current binding or a process to restart.

At that earlier checkpoint, the Activity bound `hollow-lantern-rehearsal-20260910` to `http://127.0.0.1:18810`, using its existing rehearsal save and the authentication directory `C:/Users/Hermes/LocalFiles/hollow-lantern/activity-20260910/private-rehearsal-auth`. This binding was subsequently replaced by the original campaign binding above. No gameplay command was submitted by this Activity task during that verification.

The HTTPS endpoint `https://loki-2.tail2111c3.ts.net:8443/activity` returned 200, all **22 page-linked JS/CSS assets** returned 200, the public config identified the correct rehearsal/experience, unauthenticated private view returned 401, and the legacy game API remained 404 through the edge. An ordinary browser URL is not a substitute for launching the Activity inside Discord.

The native task reports a durable engine commit follower for the same rehearsal; Activity does not need a second gateway refresh endpoint. Actual authenticated Activity-to-Discord presentation parity remains unverified until sign-in is repaired.

## Historical verification and limits

**49 focused tests passed at that earlier checkpoint** across Activity connection, authentication, current Discord permissions, campaign runtime authorization, receipt recovery and immutable launch/configuration. The production build passed. That TypeScript run reported nine existing errors in `app/game-lab/page.tsx` and `app/layout-lab/page.tsx`; no changed Activity/auth path appeared. Do not add this overlapping count to the newer 37-test result below or treat it as a current application-wide green gate.

A separate headless browser served the immutable production build with declared mock API responses. It verified DM response visibility, selection without submission, one confirmed intent and matching receipt cleanup, private player inventory, no DM controls in the player view, automatic revision updates, private-view clearing after revoked access, host-configuration guidance, and a 390-pixel mobile layout without horizontal overflow. Seven screenshots were captured. These are development UI fixtures with a labeled schematic map, **not real Discord interaction evidence, engine mission completion, or blind-player visual acceptance**. Browser contexts were disposable and the fixture server was closed.

The first browser test failed to locate the action dropdown by its complete accessible name. Explicit menu labels repaired that issue. Its failure report is retained. The final UI report names the exact deployed release and passes with no page errors.

Evidence directory: `C:/Users/Hermes/LocalFiles/hollow-lantern/activity-20260910/`:

- `ui-report.json`, seven PNGs, and `verify-ui.mjs` — repeatable production UI fixture.
- `ui-report-first-failure.json` — retained initial failure log.
- `preflight.json` — separate real-config production server, shell/assets and unauthenticated boundary.
- `candidate-release.json`, `candidate-binding.json`, `rehearsal-activity.env` — exact release/binding.
- `cutover-checkpoint.json`, `live-process.json`, `live-https.json` — actual deployment and HTTP evidence.
- `live-oauth-check.json` — historical 401 `invalid_client`, superseded by the verified credential repair.

Gortex native calls still reject this task's stale OneDrive binding as untracked. Canonical source was inspected and edited through the permitted fallback; no project alias, daemon or shared index was changed. No Gortex guard/contract pass is claimed.

The development MemPalace checkpoint write was refused because another writer holds the palace lock. That writer was left running; this project document is the retained checkpoint. No shared-memory write is claimed.

## Historical standalone Unity proof

Additional authority proof, September 10 UTC: a separate campaign `activity-fixture-098282ee-7e19-42f9-91ea-3eca919464a1` ran through the actual Activity handler and a real standalone Unity process on temporary loopback port 59559. Five commands committed through revision 5: open decisions, offered movement, request a DM ruling, decline that ruling, and checkpoint. The same movement command returned its original replayed receipt without another revision; a new command from the old view was rejected. Wrong-character and copied-view requests did not change state.

The fixture Unity process was restarted from PID 35244 to 17296 at revision 3. Its pending ruling and the original movement receipt survived. Recreating the Activity runtime rejected old controls while allowing authorized receipt recovery. The DM then closed the restored ruling. Revoked fixture identity could fetch neither private view nor receipt. Eight real scoped map PNGs were captured for the DM and three characters at revisions 3 and 5.

This proof used synthetic fixture identities, not Discord OAuth or blind participants, and is not a full mission claim. Both fixture PIDs and the temporary listener were independently confirmed absent after cleanup. The first report's cleanup flag incorrectly tested only `exitCode`; the harness now also recognizes signal termination, and `cleanup-verified.json` records the authoritative process/listener checks without overwriting the original report. Evidence: `C:/Users/Hermes/LocalFiles/hollow-lantern/activity-20260910/unity-098282ee-7e19-42f9-91ea-3eca919464a1/`. No live gameplay command or shared-service restart occurred in this validation turn.

## Published authentication diagnostics

The old generic `account_access` error also covered rejected Origins and unreadable campaign saves. Public endpoint probes confirmed the Origin ambiguity; this does not prove the user's request had a bad Origin. The new source preserves all denials while distinguishing these cases:

| Failure | Code and recovery | Boundary |
|---|---|---|
| Missing or rejected Origin | `403 origin_not_allowed`, host configuration | No exchange or session. |
| Web Origin used for Activity exchange | `403 activity_origin_required`, launch from Discord | No exchange or session. |
| Unavailable campaign membership source | `503 campaign_unavailable`, retry | No access; internal details hidden. |
| Actual missing seat, ineligibility or revoked GM | Existing `account_access` | Existing policy unchanged. |

The engine adapter adds read-only `readMember`, which distinguishes an unavailable source from a valid save with no seat. Existing `member` callers retain fail-closed null behavior for Chronicle compatibility. Neither path caches stale authority or falls back to backup. The client renders fixed safe messages only.

At 15:51 UTC, all eight assigned source/test files were handed back to the integration owner and subsequently included in the production release above. One combined source-validation run passed **37 tests, zero failures and zero skips**:

```text
node --test client/activity-connection.test.mjs hollow-lantern/engine-membership.test.mjs auth/discord.test.mjs auth/http.test.mjs auth/discord-policy.test.mjs auth/interchangeable.test.mjs
```

The tests cover origin rejection before exchange, unavailable source versus missing seat, receiver binding, no session on denial, error redaction, GM revocation, current-save ownership, restored-source recovery, cancellation and scoped session matching. Exact file checksums and the handoff are in `C:/Users/Hermes/LocalFiles/hollow-lantern/activity-auth-diagnostics-20260910/source-ready.json`. This is source validation, not successful Discord sign-in or full-mission acceptance.

## Current next gates

1. Complete an actual Discord launch with the enrolled DM. If it fails, use the new exact code and observed account to identify the failed gate. Do not reset valid keys, silently enroll another GM, relax Origin checks, or infer identity from an avatar.
2. Verify private DM/character actions, authorized illustrations, per-character maps, receipts, stale/copied/revoked access, mobile presentation and restart/rejoin. Align bindings deliberately before claiming Discord/Activity parity; preserve both existing saves.
3. Complete the original mission, isolated visual-participant, gameplay-agent, local-image, music/voice/consent and recovery release gates. Fixtures and anonymous HTTP checks do not replace these requirements.

The Activity goal remains active and incomplete. The complete previous handoff is preserved at `C:/Users/Hermes/LocalFiles/hollow-lantern/activity-auth-diagnostics-20260910/activity-progress-before-refresh.md`; its former secret-reset permission and blocked-goal instructions are historical and superseded. Gortex checks remain unavailable for this stale task binding, and the peer MemPalace writer lock was not bypassed. This document and the local evidence are the current checkpoint.
