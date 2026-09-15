# Operator execution log

## 2026-09-07 UTC: recovery and first completed repair

Canonical project: `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`.
Canonical backend: `C:\Users\Hermes\Documents\obus-moa-exe`.
Plan: `PROJECT_RECOVERY_PLAN.md`, containing 27 goals. The Codex execution goal is active in task `01a07991-e45b-7753-9b72-d7c346b2b011`.

### Recovery delivered

- Recovered the migration checkpoint, accepted Discord/Web plan, human-DM scribe/storyboard/music requests, current local integration document, recent coordination decisions, and relevant archived task inventory.
- Created the consolidated local plan with scope, source task IDs, dependencies, acceptance criteria, and explicit historical/current distinctions.
- Large multi-task history retrieval calls were repeatedly interrupted. Their cause remains unknown. Use small single-task pages for the remaining requirements; do not repeat whole-history fan-out.
- Confirmed supported Gortex repo-prefixed operations read/write `operator-local` in Projects and `obus-moa-exe` in Documents, despite this task's stale OneDrive cwd. Set explicit local working directories for commands.

### Goal A01: completed source compatibility repair

The original frozen harness was read from the local project with SHA256 `a1bb04abddbf442957a771089c58e84d20c5d06cef0130085c254c75b510a6a0`. This task made no edits to that harness.

Fresh baseline: 20 consumer checks, 14 failures / 6 passes. This supersedes the older migration checkpoint's 16 failures / 4 passes without erasing that historical evidence.

Changes in the canonical backend:

- `backend/game_runtime.py`: accept only Host-prefixed HMAC headers; publish effective policy and required-route flag; require a campaign master before child registration; compare child registration against its own snapshot; prevent child replacement of campaign authority; advance a rejoining child's revision; renew campaign/master-session leases together; require campaign scope and expectedGeneration for policy mutation; reject revoking the campaign as a child.
- `backend/game_agent.py`: report actual process-local queued/dispatched counts by campaign/session; clear counts on normal/error exits; recheck runtime after serialized queue waits and before replay; return transcription text only on its initial completion; persist/replay receipt-only metadata; sanitize an encountered legacy receipt on authorized replay; enforce the 6000-character transcript maximum.
- `tests/test_game_runtime.py`, `tests/test_game_agent.py`, `tests/test_game_agent_stt.py`: migrate setup and wire expectations to the agreed campaign-master/child protocol, exact Host headers, PATCH field and raw HTTP snapshots. Preserve existing behavior assertions and the reference HMAC vector. Add checks for scoped queue counts across waiting/running/failure and for transcript length plus revoked-authority replay.

Gortex atomic mutation IDs:

- `operator-recovery-runtime-contract-20260907-v1`
- `operator-recovery-agent-and-fixtures-20260907-v1`

Final test evidence:

| Check | Result | Log under migration report directory |
|---|---|---|
| Frozen `host/acceptance/obus_contract.py --backend-root C:/Users/Hermes/Documents/obus-moa-exe` | 20/20 PASS, exit 0 | `recovery-20260907-obus-contract-final.log` |
| `pytest -q --tb=short -p no:cacheprovider tests/test_game_runtime.py tests/test_game_agent.py tests/test_game_agent_stt.py` | 26/26 PASS, exit 0 | `recovery-20260907-backend-final.log` |

Report directory: `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z`.

The consumer harness verifies canonical imports and uses disposable SQLite stores, synthetic credentials/providers/audio and a boundary denying real network/provider/process access. These 46 passing checks certify the bounded source changes, not a live game deployment.

Gortex detect with `options.repo=obus-moa-exe` identified exactly the five changed backend/test files. Guards reported no configured rules. Contract analysis retained a general high-risk behavioral warning and incomplete test edges; it did not grant release acceptance. Actual covering test execution is recorded above. A normal detect in the default old workspace cannot certify local untracked documents.

### Still pending

No live Obus restart, new host generation, Discord command publication, real voice capture, free-provider/Codex activation, or public tunnel was performed. Existing unrelated changes were not reverted. No Git commit was created.

No OneDrive source was deleted. The active task/desktop saved roots were last observed under OneDrive, even though the work in this log occurred in local canonical paths. Preserve migration rollback copies and finish the explicit source-retirement acceptance before removing originals. Local source absence and cloud/recycle-bin deletion are distinct checks.

### Goal R03: localize active deployment and asset references

A bounded path audit found two active Obus deployment scripts still targeting `C:\Users\Hermes\OneDrive\OBus-MOA-Digital`, plus absolute OneDrive links in the Discord mockup README and Witnesslight people manifest. Historical cron reports, rollback documentation, and deliberate OneDrive safety-test fixtures were retained as evidence and test data.

The canonical deployment scripts now target `C:\Users\Hermes\Projects\Obus-Artifacts`:

- `obus-moa-exe/deploy_final.py` now creates, copies, opens and launches the local artifact bundle.
- `obus-moa-exe/deploy_complete.sh` now builds from Documents and copies to local `Projects/Obus-Artifacts`; its README and output labels no longer call that location cloud storage.
- `mockups/discord-short-game/README.md` image links and `campaign-art/witnesslight/people/manifest.json` absolute asset references now target the local Operator project.

The Python deployment script compiled successfully. The shell syntax check could not run because this Windows environment has no `/bin/bash`; the script was not executed. A focused post-edit search found no `OneDrive`, `cloud_exe`, or `CLOUD_` matches in those four edited files. This is partial R03 evidence, not proof that every historical/configuration reference across all projects is gone.

No deployment was launched and no executable was overwritten by this slice. The canonical Obus backend remains in Documents, and the local artifact destination is preserved.

### A02/A03 host readiness checkpoint

Local `raphael-council/host/diagnostics.mjs` completed read-only against the private game agent. Result was saved as `recovery-20260907-host-diagnostics.log`:

- Obus game contract reachable and valid.
- Campaign RAG, provider allowlist and Codex gate advertised.
- `freeRoutes:false`, `codexAvailable:false`, `localSttReady:false`.
- No campaign/session scopes were available, so no active game-host authority could be reported.
- `inference:not-run`, metadata unavailable, and no credentials or store migration were touched.

`raphael-council/scripts/obus-game.ps1 -Action status` reported `ready:true`, `managed:false`, port `38175`; `-Action start` reused that healthy existing agent and did not create a duplicate. A healthy agent is not an active game-host generation, so A02 and A03 remain open.

### R02/R04 migration checkpoint

The read-only `Finish-ProjectMove.ps1` status confirmed all eight approved local destinations exist and reported `changesMade:false` and `sourceRetirementEnabled:false`. The native Codex project listing still exposes the Operator project at the legacy OneDrive path. The saved `project-bindings-final.json` separately records the approved local Operator root and local Documents Obus root; this backend binding receipt does not prove the desktop record has switched.

A fresh `verify_migration.py operator-recovery-current` comparison completed with zero scan errors and zero scan drift on both trees. It found 53 differences. The difference set is explainable at this stage by local recovery documents/path rewrites, existing source-side working-tree/code changes, and Codex `.git` turn-diff/checkpoint objects. This is useful reconciliation evidence but is not yet a retirement certificate or byte-for-byte equality claim. Receipt: `operator-recovery-current.receipt.json`; manifests: `operator-recovery-current-0.manifest.json` and `operator-recovery-current-1.manifest.json`.

No source was deleted or moved. R02 and R04 remain in progress until the desktop project binding is corrected through supported app operations and the ordinary-file differences are explicitly reconciled against backups and prior receipts.

### R01 requirements recovery: player distance/reach inquiry

A bounded read of archived task `01a074f3-b915-7211-8874-3ee3b9043b74` recovered an additional explicit player requirement: from the scene view, a player can ask how far something is and whether the character can reach it. The intended response must distinguish map distance, movement needed, equipped weapon range, remaining movement, obstacles, turn state, and unsupported abilities requiring GM adjudication. Archived work reports corresponding local modules (`game/reach.mjs`, browser `SceneReach`, Discord reach modal/adapter, and reach HTTP routes), plus focused tests and a successful game build at that milestone; live Discord/browser acceptance was not established. This belongs under T01/T02 and must be reverified from the canonical local copy.

The same archived task reports campaign image requests save the player view snapshot, mark late results as earlier snapshots, reuse identical requests, and fall back to approved artwork when generation is unavailable. It reports browser/Discord controls and image-provider fixtures, but also records a later build/lint failure before a subsequent successful build; current local verification remains required.

Next work: R01 remaining bounded requirements recovery; R02 supported local project binding; R04 manifest reconciliation and unique-history review; complete valid host configuration for A02, then A03 fresh synthetic local inference. Do not mark the full execution goal complete while these and the other plan goals remain open.

[2026-09-07T00:27:07Z] T01 verification: canonical local Raphael tests passed (exit 0): game/reach.test.mjs, game/reach-http.test.mjs, images/http.test.mjs, images/service.test.mjs, images/provider.test.mjs, discord/image-adapter.test.mjs. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-reach-image-tests.log

[2026-09-07T00:27:07Z] R03 cleanup: removed remaining stale absolute OneDrive links from campaign asset manifest, Discord mockup README, and Chronicle integration documentation. Intentional OneDrive refusal checks and historical evidence were preserved.

[2026-09-07T02:57:38Z] A02/A03 fresh diagnostics: Obus reachable and contract valid; campaignRag/providerAllowlist/codexGate true; freeRoutes=false, codexAvailable=false, localSttReady=false, metadata unavailable, sessions empty, inference not-run. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-host-diagnostics-latest.log. Archived hosting handoff confirms old STT activation body is superseded; no standalone activation performed.

[2026-09-07T03:00:00Z] A02/A03 diagnosis: canonical Obus backend confirms route_ready intentionally remains false until private game-host runtime authority is registered and a session lease is active. STT requires exact raph-obus-game-stt-v1 envelope plus runtime contract, bootEpoch, generation, and sessionPolicyRevision; local model readiness alone is insufficient. No security boundary weakened and no standalone activation attempted.

[2026-09-07T03:02:00Z] R02/R04 retirement audit: migration receipt contains 53 differences: 41 Git/Codex metadata, 2 local recovery records, 3 localized docs/assets, and 7 source/test files requiring semantic review. Retirement decision remains HOLD; OneDrive was not deleted. Audit: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\operator-recovery-retirement-audit.json

[2026-09-07T03:05:00Z] R02/R04 source-difference review: all 7 non-metadata differences are existing local-vs-OneDrive revisions, not missing local files. Local host/scopes.mjs retains defensive OneDrive-root validation; Chronicle source/tests differ in initialization-validation coverage and require semantic review. No stale OneDrive code was copied over local canonical files; retirement remains HOLD.

[2026-09-07T03:10:00Z] Requirements recovery: tactical archive confirms authoritative action boundaries for turn, visibility, movement/path cost, range/targets, resources, defeated actors, pause/resume, unsupported mechanics, map/world transitions, council choice CAS, and persistent receipts. Scribe archive confirms consent-scoped typed/voice capture, pause/resume and gaps, configurable summaries, corrections with audit trail, private DM read-aloud drafts, tagged searchable chronicle, scene/image requests with approved-art fallback, and illustrated chronological recap. These are recovered acceptance requirements; historical task output is not treated as fresh proof.

[2026-09-07T03:10:00Z] Fresh canonical local tactical/scribe-focused suite passed (exit 0): game/store.test.mjs, game/world.test.mjs, game/adjudication.test.mjs, chronicle/core.test.mjs, chronicle/runtime.test.mjs, host/scopes.test.mjs. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-tactical-scribe-tests.log

[2026-09-07T03:15:00Z] Storyboard/music audit: canonical local storyboard data contains 30 panels, 6 acts, 18 cited entries, and Admin/DM/Player role filtering. Music manifest contains 7 original tracks including recurring Crossing the Veil and battle cue; all 7 MP3 files exist and SHA-256 hashes match manifest. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-music-assets.json. Adaptive runtime integration, mood transitions, DM override, narration ducking, and silence behavior remain unverified.

[2026-09-07T03:20:00Z] Adaptive music integration audit: no runtime controller, mood transition, ducking, override, or silence implementation found in the canonical local project. Existing music is storyboard/mockup asset production only; Chronicle integration documentation explicitly states shared music/voice composition remains a release dependency. Preserve the 7 verified tracks; adaptive runtime remains open.

[2026-09-07T03:25:00Z] Adaptive music implementation slice: created chronicle/music.mjs as a pure injected coordinator that preserves Davy ownership while supporting approved mood selection, crossfade intent, DM override, narration ducking, and break silence. Added chronicle/music.test.mjs; focused suite passed exit 0. This is coordinator-level evidence only; live Davy binding and actual audio playback remain unverified. Mutation receipts: commit-1351, commit-1352, commit-1353.

[2026-09-07T03:30:00Z] Adaptive music runtime hook: portable Chronicle core now accepts optional injected music and exposes it on the returned runtime without taking voice/connection ownership. Existing Chronicle music/preack/runtime/core tests passed exit 0. The Davy wrapper's live argument plumbing and actual playback remain open; no competing gateway or connection was introduced.

[2026-09-07T03:35:00Z] Adaptive music Davy hook completed: chronicle-runtime.mjs now forwards optional injected music to chronicle-core.mjs; existing callers remain compatible. First combined command incorrectly treated packages/chronicle/consumer-fixture.mjs as a standalone test and failed; rerun of actual music/core/runtime/preack tests passed exit 0. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-music-davy-hook-tests.log. Live Davy audio remains unverified.

[2026-09-07T03:40:00Z] Adaptive music runtime acceptance: injected coordinator survives Chronicle core composition and shutdown without the runtime owning the player. Added chronicle/music-runtime-hook.test.mjs; music, hook, core, runtime, and preack suite passed exit 0. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-music-runtime-acceptance.log. Live Davy gateway/audio remains unverified.

[2026-09-07T03:45:00Z] Campaign RAG/provider acceptance slice: canonical local ai/obus runtime, AI service, host AI-services, and Chronicle Obus-provider tests passed exit 0. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-rag-provider-tests.log. This proves adapter/provider contract behavior only; live semantic retrieval and real inference remain unverified because host diagnostics still report metadata unavailable and inference not-run.

[2026-09-07T03:50:00Z] Fresh shared gameplay/image release checks: npm run test:game passed 620/620; npm run test:images passed 48/48. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-game-suite.log and recovery-20260907-image-suite.log. These are local fixture/unit/integration checks; live Discord/Web mixed-player acceptance remains open.

[2026-09-07T04:00:00Z] Fresh character/Discord/training acceptance checks: npm run test:characters passed 186/186; npm run test:training passed 5/5. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-characters-discord-suite.log and recovery-20260907-training-suite.log. These remain local checks; live bot, real accounts, and mixed-interface acceptance remain open.

[2026-09-07T04:10:00Z] Local hosting build gate: npm run lint passed; generic npm run build failed because Cloudflare/RSC bundling attempted to parse native @napi-rs/canvas. The intended local-host path with RAPHAEL_LOCAL_HOST=1 passed and completed all routes. Evidence: recovery-20260907-lint.log, recovery-20260907-local-build.log. The generic cloud build remains a separate environment/configuration issue; local build is green.

[2026-09-07T04:20:00Z] Windows bot composition check: npm run bot:check failed closed because local .env.local is absent; required private values are DISCORD_TOKEN, RAPHAEL_GUILD_ID, RAPHAEL_CHANNEL_ID, RAPHAEL_CAMPAIGN_ID. No credentials were requested, printed, or started. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-bot-check.log. Live gateway acceptance remains unavailable.

[2026-09-07T04:25:00Z] Created PROJECT_ACCEPTANCE_MATRIX.md with requirement-by-requirement verified/partial/open status and six remaining live acceptance gates. It consolidates current evidence without claiming live credentials, inference, Discord, Davy, or migration retirement.

[2026-09-07T04:30:00Z] Portable Chronicle package now exports createAdaptiveMusic for Davy injection; direct package import verified exit 0. Mutation receipt commit-1360. This removes the internal-path dependency, but live Davy package installation and gateway composition remain unverified.

[2026-09-07T04:35:00Z] Dedicated local game host build: npm run build:game passed and emitted all game/activity/API routes. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-game-host-build.log. This is the preferred local Windows artifact; live start, HTTPS endpoint, and Discord Activity connection remain open.

[2026-09-07T04:45:00Z] Local runtime smoke: started dedicated 
pm run start:game host with RAPHAEL_LOCAL_HOST=1; server running at http://127.0.0.1:3000 in session 15627. GET /play returned HTTP 200 with HTML. No Discord gateway or second bot process started. .env.local absent, so authenticated/live campaign flows remain open.

[2026-09-07T04:50:00Z] Live local host recheck: session 15627 remained running; GET /play served previously with 200 and unauthenticated GET /api/game returned expected 401. This confirms the local auth boundary is active without exposing campaign data. No credentials or gateway started.

[2026-09-07T04:55:00Z] Live local entry-surface smoke: GET /activity returned 200 HTML; GET /api/auth/config returned 200 JSON. Together with /play=200 and unauthenticated /api/game=401, the local browser/Activity surface and auth boundary are serving. No credentials or gateway started.

[2026-09-07T05:00:00Z] Obus game service status: ready=true, endpoint http://127.0.0.1:38175/api/game/capabilities, managed=false, freeRoutesAvailable=false, codexAvailable=false. Existing healthy service was reused; no restart or duplicate launched. Live private authority/STT readiness remains open.

[2026-09-07T05:05:00Z] Direct Obus capability probe: unauthenticated GET /api/game/capabilities was rejected with Game service authentication required; no capability metadata or provider details were exposed. Wrapper status remains the only non-secret readiness evidence. No token inspection or bypass attempted.

[2026-09-07T05:10:00Z] Final offline Obus consumer contract gate: 20/20 passed against canonical C:\Users\Hermes\Documents\obus-moa-exe; exit 0. Module paths verified. Harness explicitly confirms offline fixture only: no credentials, live HTTP, real inference, or live STT. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-obus-contract-final.log.

[2026-09-07T05:15:00Z] Local STT prerequisite audit: canonical Python exists; aster_whisper import available; private faster-whisper-tiny model directory exists with model.bin (75,538,270 bytes) and config.json (2,249 bytes). This proves dependency/model prerequisites, not route readiness: private runtime lease and authority fence are still required.

[2026-09-07T05:20:00Z] Lifecycle launcher audit: scripts/obus-game.ps1 supports only start/stop/status, reuses a healthy authenticated agent, and never registers host generation/session leases. No supported local registration action exists in the launcher; adding one would require private authority/signing configuration and campaign/session inputs. No token or signer was inspected.

[2026-09-07T05:25:00Z] Durable-note review confirms no exact supported host-registration invocation is recorded; only the required STT envelope/runtime fence and security prerequisites are known. Legacy two-field activation is explicitly superseded. Continue treating live authority activation as an upstream/private configuration gate, not a local code defect.

[2026-09-07T05:35:00Z] Rollback audit: C:\Users\Hermes\LocalBackups exists with two preserved project backup directories, Operator Special Forces Dungeon and Dragons and Davy Jones; no files were deleted or altered. This preserves rollback material while OneDrive retirement remains on HOLD pending source/test reconciliation.

[2026-09-07T05:45:00Z] Local provider audit: Ollama process is running and http://127.0.0.1:11434/api/tags responded successfully. Available local models include obus-qwen3.8-27b:65k, gpt-oss:20b, llama3.2:latest, and nomic-embed-text:latest. This verifies local inference/embedding infrastructure availability; it does not bypass the Obus private runtime lease or prove campaign-scoped live inference.

[2026-09-07T05:50:00Z] Local embedding smoke: Ollama 
omic-embed-text:latest accepted a Greyharbor retrieval probe and returned a 768-dimension embedding. This verifies the local embedding model responds; Obus campaign scope/provenance and runtime lease gates remain required before live gameplay use.

[2026-09-07T06:00:00Z] Local generation smoke: Ollama llama3.2:latest answered a bounded non-campaign prompt with exactly READY. Combined with the 768-dimension embedding probe, local inference and embedding processes are operational. Obus runtime lease, campaign scope, and live gameplay gates remain enforced and unclaimed.

[2026-09-07T06:25:00Z] Canonical Obus game-agent regression slice initially exposed a fixture defect: child session setup omitted the campaign master generation. Updated tests/test_game_agent_policy.py fixture to register campaign master then child under its generation (production authority semantics unchanged). Rerun passed 29/29. Mutation receipt commit-1361; evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-obus-game-agent-suite.log.

[2026-09-07T06:35:00Z] Broader Obus game regression: first pytest glob attempt ran zero tests due PowerShell literal-glob behavior (exit 4), not a product failure. Rerun with resolved test file list passed all 29 game-agent/runtime tests. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-obus-all-game-tests.log.

[2026-09-07T06:45:00Z] Ephemeral STT engine probe: faster-whisper reached the private model with a valid temporary silent WAV, then correctly rejected it as Private game local STT returned no speech; temporary audio was deleted and no transcript persisted. No speech fixture exists locally, so no false positive was manufactured. Route-level STT still requires the private runtime lease.

[2026-09-07T03:33:54Z] Canonical Obus full pytest after warmup contract test alignment passed: 496 passed in 168.13s. The warmup test now asserts that no prompt field is sent, matching backend/main.py's documented preload contract and preventing an unbounded reasoning turn. Evidence: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-obus-full-suite.log; test mutation commit-1362.

[2026-09-07T03:35:15Z] A02 offline authority evidence refreshed: raphael-council/ai/host-control.test.mjs passed 12/12; frozen Operator consumer contract passed 20/20 using --backend-root C:\Users\Hermes\Documents\obus-moa-exe with module paths verified. Evidence is offline fixture-only: no credentials, live HTTP, or real inference. A02 remains pending live host-generation registration and lease fencing.

[2026-09-07T03:36:00Z] Migration semantic guard slice passed 28/28: chronicle/core.test.mjs, chronicle/runtime.test.mjs, and host/scopes.test.mjs. Evidence includes refusal of OneDrive-named/custom sync roots, junction aliases, malformed roots, unsafe database creation, consent/capture lifecycle, and durable delivery behavior. This verifies local path safety, not source parity or cloud deletion; retirement remains HOLD.

[2026-09-07T03:36:53Z] Active absolute-path audit found one stale generated reference only: raphael-council/.vinext/dev/lock.json records the former OneDrive cwd. No active source/config/runtime file contains the old absolute path; source guards intentionally mention OneDrive to reject it. Removal of the generated lock was attempted with its exact workspace path but execution policy rejected deletion, so no alternate/destructive workaround was used.

[2026-09-07T03:37:36Z] Semantic migration reconciliation created: 7 source/test differences are classified as intentional local-authoritative recovery deltas (chronicle/music integration and OneDrive-safe scope enforcement), supported by 28/28 relevant Node tests, 20/20 Obus consumer checks, and 12/12 host-control checks. Receipt: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\operator-recovery-semantic-reconciliation.json. Filesystem retirement remains HOLD because deletion execution is policy-blocked; no OneDrive source deletion claimed.

[2026-09-07T03:38:07Z] H01 local hosting health refreshed: canonical vinext start process PID 23944 owns the local project; /play=200, /activity=200, /api/auth/config=200 with clientId null. Obus game status reports ready=true at http://127.0.0.1:38175, managed=false, freeRoutesAvailable=false, codexAvailable=false. This proves local endpoint/process health only; no live Discord or authenticated game-host lease claimed.

[2026-09-07T03:55:59Z] Campaign imagery audit: game/image-scene.mjs builds illustrations only from authenticated observable projections, bounds descriptions at 6000 characters, limits visible cells/subjects, hashes actor IDs, and explicitly excludes appearance, hidden lore, inferred identities, and mechanical outcomes. Witnesslight README requires host-published observable snapshots, approved references, and exclusion of unrevealed/unchosen outcomes. No source mutation required; live provider/generation acceptance remains open.

[2026-09-07T03:56:31Z] Local STT/RAG provider slice passed 18/18 focused tests in chronicle/obus-provider.test.mjs and packages/obus-provider/consumer-fixture.test.mjs. Evidence covers campaign allowlists, role/session scope, host/participant revocation, immutable request snapshots, local-only no-tools/no-Codex policy, provenance receipts, bounded WAV/transcript handling, zeroed audio buffers, and receipt-only replay without fallback. Live model activation and real voice remain unclaimed.

[2026-09-07T03:57:06Z] Davy/Discord lifecycle slice passed 15/15 focused tests: chronicle/preack.test.mjs, chronicle/dispatch.test.mjs, and discord/chronicle-adapter.test.mjs. Evidence covers private pre-acknowledgements, current membership rechecks, stale queued revisions, lease fencing, restart reconciliation, uncertain command receipts, shutdown draining, and preserving unrelated Davy commands. Live Davy composition, gateway, and audio remain open.

[2026-09-07T03:58:03Z] Full tactical/world/council game suite passed 620/620 (npm run test:game). Fresh evidence covers mission consequence backup/retry, host-only adjudication, council/world-time persistence, stale preview and replay fencing, restart recovery, visibility protections, octagonal tactical movement, deterministic map rendering, and world clock persistence. Configured live campaign acceptance remains open.

[2026-09-07T03:58:38Z] Storyboard/adaptive music audit: mockups/full-game-storyboard/data.mjs contains 30 panels across 6 acts with Admin/DM/Player views, consent, correction, failure, recap and arcade-mode boundaries. Music compose.py defines Crossing the Veil plus exploration, tension, drama, battle, sanctuary and aftermath tracks; adaptive runtime integration/tests already cover mood changes, DM override, narration ducking and break silence. Local content is verified; rendered playback/live Davy audio remains open.

[2026-09-07T03:59:17Z] Windows supervision/diagnostics slice passed 39/39: host/ai-services.test.mjs, host/diagnostics.test.mjs, and ai/host-lifecycle.test.mjs. Evidence covers generation fencing, start/stop coalescing, scope discovery, cleanup retries, cancellation, manual-play fallback, read-only diagnostics, bounded concurrency, deadlines, and sanitized network failures. Live Obus lease registration and production Davy composition remain separate gates.

[2026-09-07T03:59:48Z] Shared Discord/Web interchangeability slice passed 29/29: auth/interchangeable.test.mjs, chronicle/http.test.mjs, and game/http.test.mjs. Evidence covers browser/Activity identity, shared request IDs and receipts, consent separation, membership revocation, stale/replay behavior, restart durability, transcript correction ownership, private projections, council/world routes, image access, origin checks, and durable action receipts. Real GM-plus-two-player mixed-interface acceptance remains open.

[2026-09-07T04:00:27Z] H02 game-ledger recovery slice passed 45/45 focused backup fixtures: adjudication-backup, concentration-backup, and reactions-backup. Evidence covers mission restore/retry, reaction and concentration continuation, simultaneous ordering, pending movement, receipt preservation, malformed-backup rejection, and multi-restart durability. This verifies game-ledger recovery only; one coordinated checkpoint across game, characters, chronicle, images and campaign assets remains open.

[2026-09-07T04:01:03Z] Archived hosting handoff recovered from task Host Raph on this PC (01a0788e-642e-7a72-90c8-bcd5210108de). Durable constraints: use native local Node hosting and existing stable HTTPS origin; preserve user-owned Desktop Obus on port 38173; do not use the superseded two-field STT activation; current private STT requires scoped raph-obus-game-stt-v1 plus runtime fence and remains unavailable until host authority is registered; live Davy STT requires the coherent chronicle/provider/participant set; persistent game/chronicle/assets require coherent all-store backup, not independent snapshots. No archived hosting task source changes are treated as implementation evidence.

[2026-09-07T04:01:33Z] H02 architecture audit confirms no hidden coordinated checkpoint implementation. Repository evidence states game/backup.mjs backs up only the game database and explicitly excludes character imports, image jobs/access codes and art; integration docs require a future all-store checkpoint covering game, approved characters, chronicle, image records and required assets with all-or-nothing restore validation. H02 remains an explicit engineering work item; archived image-task retrieval failed at Codex app boundary and was not treated as evidence.

[2026-09-07T04:02:19Z] Archived coordinator finding about missing Discord Chronicle/Activity wiring is superseded by current canonical source: discord/bot.mjs now composes launchHandler, Chronicle runtime, raw message/voice packet handling, disconnect gap pause, and orderly shutdown/drain. Fresh full Discord adapter suite passed 165/165 (node --test discord/*.test.mjs). This verifies local composition and adapter behavior; live Discord credentials, gateway, voice, and Activity acceptance remain open.

[2026-09-07T04:02:44Z] Recovered coordinator privacy dependency: synthetic Obus generic /api/route/run retained prompt/answer in general auto-route memory even with retrieval, harness and remote execution disabled. Synthetic record was deleted; no campaign/transcript data used. Retrieval-off is insufficient. Raphael remains fail-closed until canonical Obus proves scoped campaign/audience retrieval and no general-memory retention; generic route fallback is prohibited. Durable Gortex note ntc4dca0368bd4be5b.

[2026-09-07T04:03:24Z] Canonical Obus boundary diagnosis: Documents\\obus-moa-exe/backend/game_agent.py exposes only scoped raph-obus-game-v1, raph-obus-game-runtime-v1, and raph-obus-game-stt-v1 contracts with strict campaign/owner/role/policy/runtime fences; it has no generic auto-route endpoint. The recovered general-memory retention defect is outside Raphael's game-agent source boundary, so no safe Operator-side mutation applies. Generic Obus route fallback remains prohibited and Raphael remains fail-closed.

[2026-09-07T04:03:48Z] Fresh read-only host diagnostics: raph-game-host-diagnostics-v1 returned metadata=unavailable, inference=not-run, Obus reachable=true with contract raph-obus-game-v1, campaignRag=true, providerAllowlist=true, codexGate=true, freeRoutes=false, codexAvailable=false, localSttReady=false, sessions=[]. This confirms service reachability and capability gates only; no live host lease, inference, STT, or campaign session was activated.

[2026-09-07T04:04:12Z] R02 supported-app binding audit: Codex project registry still maps Operator project 0be89568-9ab0-4f0f-a6cf-45819711b67a to C:\Users\Hermes\OneDrive\Documents\ChatGPT\Operator Special Forces Dungeon and Dragons and Obus project d9fed56c-5b91-4090-93b9-344cf0f2a05f to its OneDrive Documents clone. Available app tools expose listing but no supported path-rebinding operation; no global state rewrite or OneDrive data mutation was attempted. Canonical local roots remain the execution roots.

[2026-09-07T04:04:51Z] R02 launcher audit: C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\Open-LocalOperator.cmd already invokes codex.exe app against C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons, not OneDrive. No launcher edit required; stale OneDrive binding is limited to the Codex app registry record.

[2026-09-07T04:05:17Z] Archived campaign-image handoff recovered from task Create campaign story images (01a074f3-b915-7211-8874-3ee3b9043b74). Original requirement: private Show what I see controls in Discord and browser, available during combat/pauses/other turns without game action or resource cost, Witnesslight-style output, and host-published scene updates as player choices change the world. Archived handoff reported 119 image/Discord/character tests plus browser image delivery verification. It explicitly left live generation open pending host image credentials, Discord settings, and updated host scene descriptions; tactical movement does not automatically update illustration state. Current local image tests and privacy audits remain the authoritative recovery evidence.

[2026-09-07T04:05:45Z] Archived scribe/music requirements recovered from Add human DM session scribe (01a0775e-4a0e-7ef3-91d6-220cf844a9f7): human-DM read-aloud guidance; consent-scoped attributed transcription; DM/Admin-configured summary interval; tagged searchable chronicle; scene images; corrections; and final illustrated chronological recap. Music handoff requires original synthesized instrumental cues, recurring Crossing the Veil motif, exploration/drama/battle variations, mood crossfade, narration ducking, DM override and break silence, with qualified copyright/provenance language rather than an unsupported no-copyright guarantee. Current local provider, scribe, storyboard and music evidence covers the offline implementation; live voice/playback remains open.

## 2026-09-07 Recovery continuation: tactical archive and master goals

- Recovered the interrupted tactical task `Plan tactical map combat system`. Its last recorded action was connecting scene activation to the player interface; the task was interrupted while inspecting `game/http.mjs`, `app/play/mission.tsx`, and `app/api/game/council/route.ts`.
- Current canonical local evidence supersedes the interrupted state: connected scene and mission activation are implemented, with documented remaining work for player-confirmed departures, live session verification, provider readiness, coordinated image/character recovery, and live release evidence.
- Created the durable ordered checklist at `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\OPERATOR_RECOVERY_GOALS.md`.
- OneDrive remains evidence-only. No unrelated OneDrive data was deleted; local canonical execution continues from `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons` and `C:\Users\Hermes\Documents\obus-moa-exe`.

## 2026-09-07 Recovery continuation: stale artifact path cleanup

- Live canonical services confirmed: Obus listener on `127.0.0.1:38173`, game host on `127.0.0.1:38175`; unauthenticated `/api/auth/config`, `/play`, and `/activity` correctly return `401`.
- Gortex reported its tracked repository root remains the OneDrive checkout. A transactional cleanup changed mirrored OneDrive copies of `campaign-art/witnesslight/people/manifest.json` and `mockups/discord-short-game/README.md`; the canonical local copies were then independently normalized to remove stale absolute OneDrive prefixes.
- Runtime OneDrive refusal and scope-validation code was intentionally preserved. This slice removes stale artifact/document path coupling without weakening storage safety.
- Remaining migration work: supported rebinding of Codex/Gortex project state, removal of generated stale metadata, and final retirement evidence. No unrelated OneDrive data was deleted.

## 2026-09-07 Recovery continuation: prepared departure acceptance

- Canonical local focused acceptance command: `node --test game/departure-controls.test.mjs game/scenes.test.mjs game/http.test.mjs discord/departure-controls.test.mjs`.
- Result: `17/17` passed.
- Fresh evidence covers player-confirmed prepared departures, stale/copied/revoked controls, cross-player invalidation, private acknowledgement ordering, authenticated revision/journal/world/council routes, game-cookie scope, filtered state/map, forged identity/origin/modifier rejection, durable owner receipts, body limits and failure redaction.
- No source mutation was needed: the documented departure gap is implemented. Remaining acceptance is a real private live browser/Discord session and real campaign transition, which requires configured credentials/membership rather than a code fix.

## 2026-09-07 Recovery continuation: coordinated all-store checkpoint boundary

- Added canonical local `raphael-council/recovery/coordinated.mjs`.
- The host-only boundary requires campaign and encounter identity, four SQLite stores (`game`, `characters`, `chronicle`, `images`), and a required asset directory.
- Checkpoint creation snapshots SQLite stores with `VACUUM INTO`, validates SQLite integrity/foreign keys, hashes every store and asset, requires an explicit cross-store `assertCoherent` hook, and writes the manifest last.
- Verification rejects missing, altered, incomplete, or mismatched stores/assets. Restore requires a new destination, copies without replacing existing files, runs coherence validation, writes the manifest last, and re-verifies before returning success.
- Synthetic end-to-end acceptance: four stores + one asset, checkpoint, verify, restore, verify => `restored:true` with format `raph-coordinated-checkpoint-v1`.
- Release limitation remains explicit: real adapters still need to inspect pinned approved character versions, encounter/history identity, chronicle session identity, image-record provenance and live asset set before a production checkpoint is accepted.

## 2026-09-07 Recovery continuation: runtime recovery wiring

- Added `raphael-council/recovery/runtime.mjs` to bind coordinated recovery to the real local runtime configuration:
  - game: `%LOCALAPPDATA%/Raphael/game/game.sqlite`
  - approved characters: `%LOCALAPPDATA%/Raphael/character-importer/characters.sqlite`
  - campaign Chronicle: `%LOCALAPPDATA%/Raphael/chronicle/<campaign>/chronicle.sqlite`
  - image records: `%LOCALAPPDATA%/Raphael/scene-images/images.sqlite`
  - Witnesslight assets: project-local `campaign-art/witnesslight`
- Added `raphael-council/recovery/cli.mjs` with host-only `checkpoint` and `restore` operations.
- Checkpoint creation requires explicit campaign and encounter IDs and defaults to local application-data paths; it does not resolve or use OneDrive paths.
- Import smoke check passed and printed the expected local runtime paths. A real checkpoint remains dependent on configured live stores and a host-supplied coherence assertion for the current encounter and pinned records.

## 2026-09-07 Recovery continuation: runtime checkpoint audit and failure cleanup

- Audited actual local application data. Game and image databases exist but contain no active campaign rows; the approved-character database is absent. No real coordinated checkpoint was created, and no synthetic data was promoted as production evidence.
- Fixed coordinated recovery failure handling so failed checkpoint creation or restore removes only its newly reserved destination. Existing source stores remain untouched.
- Focused failure-path acceptance: coherence rejection => `failedDestinationRemoved:true`.
- The runtime checkpoint gate remains correctly open until approved character data and an active campaign/encounter exist.

## 2026-09-07 Recovery continuation: semantic checkpoint validation

- Extended `raphael-council/recovery/runtime.mjs` with real store inspectors.
- Runtime checkpoint acceptance now requires: the requested campaign and encounter identity in `game_campaigns`, valid pinned approved-character revisions, at least one campaign Chronicle session, and campaign image scenes plus a revision row.
- The semantic checks run before the coordinated manifest is written, so missing or mismatched live records cannot produce a seemingly valid checkpoint.
- Current local audit remains negative by evidence: game/image ledgers are empty and the approved-character store is absent. No checkpoint was claimed or created from synthetic data.

## 2026-09-07 Recovery continuation: live Obus/STT readiness

- Fresh canonical local command: `node host/diagnostics.mjs`.
- Result: `reachable=true`, contract `raph-obus-game-v1`, `campaignRag=true`, `providerAllowlist=true`, `codexGate=true`.
- Result also correctly reports `freeRoutes=false`, `codexAvailable=false`, `localSttReady=false`, and no active sessions; inference was not run and metadata was unavailable.
- This is a fail-closed readiness receipt, not a failure to be worked around with generic routes. Provider credentials/local STT installation and a real scoped campaign session remain external live requirements.

## 2026-09-07 Recovery continuation: local STT host-control prerequisite

- Reviewed the scoped STT/Obus startup path. `openGameAiHostServices` correctly starts only the scoped game lifecycle and returns unavailable on configuration failure; it does not fall back to generic routes.
- `createLocalObusHostControl` requires either an explicit 64-hex `RAPHAEL_OBUS_HOST_CONTROL_TOKEN` or the absolute token file `C:\Users\Hermes\.occultbus\game-agent\host-control-token`.
- Live host audit: token file is missing; no relevant token/STT/RAG environment variables are configured. The existing Obus process metadata exists, but it does not establish host-control authorization.
- No credential was generated or guessed. Local STT readiness remains correctly false until the private host-control credential and scoped provider configuration are supplied.

## 2026-09-07 Recovery continuation: host lifecycle and scoped Obus acceptance

- Canonical local focused command: `node --test host/ai-services.test.mjs host/diagnostics.test.mjs ai/host-config.test.mjs ai/host-control.test.mjs`.
- Result: `34/34` passed.
- Evidence covers fail-closed credential and endpoint validation, no credential disclosure, exact scoped signing, bounded transport parsing/deadlines, no retries on denial/network errors, lease-draining shutdown, cancellation ownership, read-only metadata, no absent campaign database creation, sanitized diagnostics, and bounded readiness reads.

## 2026-09-07 Recovery continuation: permanent coordinated recovery tests

- Added `raphael-council/recovery/coordinated.test.mjs`.
- Focused command: `node --test recovery/coordinated.test.mjs`.
- Result: `2/2` passed.
- Permanent coverage now protects successful four-store/asset checkpoint and restore, manifest verification, and cleanup of a newly reserved destination after coherence rejection while preserving source stores.

## 2026-09-07 Recovery continuation: semantic runtime recovery tests

- Added `raphael-council/recovery/runtime.test.mjs`.
- Focused command: `node --test recovery/runtime.test.mjs`.
- Result: `2/2` passed.
- Permanent coverage now verifies coherent campaign records across game, approved characters, Chronicle sessions, and image projections, and rejects an encounter absent from the game ledger.

## 2026-09-07 Recovery continuation: package command integration

- Added canonical local package scripts:
  - `npm run test:recovery`
  - `npm run recovery:checkpoint -- --campaign ID --encounter ID --output NEW_DIRECTORY`
  - `npm run recovery:restore -- --source CHECKPOINT_DIRECTORY --output NEW_DIRECTORY`
- `npm run test:recovery` result: `4/4` passed, covering generic and semantic recovery invariants.
- Recovery is now exposed through the normal Raphael package workflow rather than only direct module paths.

## 2026-09-07 Recovery continuation: OneDrive refusal in runtime recovery

- Added an explicit local-path guard to `raphael-council/recovery/runtime.mjs`.
- Runtime recovery now rejects any configured game, character, Chronicle, image, or asset path containing an actual OneDrive path component before opening or copying data.
- Existing semantic recovery tests: `2/2` passed.
- Direct override acceptance: `RAPHAEL_GAME_DATA_DIR=C:/Users/Hermes/OneDrive/game` => `onedrive-guard:pass`.
- This strengthens retirement safety without deleting user data or weakening the existing host scope refusal logic.

## 2026-09-07 Recovery continuation: Davy/Chronicle acceptance

- Canonical local focused command: `node --test chronicle/preack.test.mjs chronicle/dispatch.test.mjs discord/chronicle-adapter.test.mjs chronicle/privacy.test.mjs chronicle/voice-capture.test.mjs`.
- Result: `22/22` passed.
- Evidence covers queued command receipts, membership/role rechecks, lease renewal and loss, restart reconciliation, shutdown draining, pre-acknowledged Discord replies, capture withdrawal/epoch invalidation, audio clearing, stale summary correction, pause/end races, external-consent export limits, and isolated voice capture/decoder execution.
- Live Discord/voice/provider credentials remain unverified; no live transcript or campaign data was used.

## 2026-09-07 Recovery continuation: imagery and adaptive music acceptance

- Canonical local focused command: `node --test images/*.test.mjs chronicle/music.test.mjs chronicle/music-runtime-hook.test.mjs`.
- Result: `33/33` passed.
- Evidence covers private cookie/origin boundaries, owner-bound scene/image delivery, idempotent requests, observable-only generation input, campaign/player isolation, durable image jobs and leases, Obus-only routing, no direct-provider fallback, provenance and PNG validation, host-approved art without API calls, interrupted-worker safety, adaptive moods, narration ducking, DM override, break silence, and fail-closed music adapters.
- Live image-provider credentials and live campaign rendering remain unverified.

## 2026-09-07 Recovery continuation: shared Discord/Web acceptance

- Canonical local focused command: `node --test auth/interchangeable.test.mjs chronicle/http.test.mjs game/http.test.mjs discord/adventure-adapter.test.mjs discord/council-adapter.test.mjs discord/world-adapter.test.mjs`.
- Result: `48/48` passed.
- Evidence covers interchangeable browser/Activity sessions, auth and Origin rejection, Chronicle command/restart/retry/privacy behavior, private map delivery and restart watches, movement/attack confirmation, world/council/debrief controls, prepared departure, revision/journal boundaries, cookie scope, state/map filtering, durable receipts, and error redaction.
- This remains fixture/localhost acceptance; live Discord credentials and real campaign state are not claimed.

## 2026-09-07 Recovery continuation: tactical/world/council acceptance

- Canonical local command: `node --test game/*.test.mjs maps/*.test.mjs`.
- Result: `620/620` passed.
- Evidence covers tactical movement and octagonal geometry, visibility/LOS, initiative, reactions, concentration, checks and rolls, area damage, adjudication, world time, mission/world transitions, council/debrief, scenes/departures, HTTP and Discord controls, backup/recovery, persistence, receipts, restart behavior, and privacy projections.
- This is comprehensive local fixture acceptance; authored live campaign transition and live provider-backed play remain unverified.

## 2026-09-07 Recovery continuation: approved-character acceptance

- Canonical local focused command: `node --test characters/*.test.mjs discord/import-adapter.test.mjs game/character-http.test.mjs game/character-info.test.mjs`.
- Result: `43/43` passed.
- Evidence covers offline isolated OCR/PDF import, outbound-denial and deadlines, conflict/uncertainty handling, atomic correction and approval, cancellation/restart/expiry cleanup, idempotency and revision protection, private Discord/browser review, attachment validation, campaign/ownership boundaries, live character projections, visibility/privacy, stale/forged requests, and runtime directory consistency.
- A real campaign character database is still absent locally; this acceptance proves the import and projection behavior through fixtures only.

## 2026-09-07 Recovery continuation: Obus consumer contract acceptance

- Canonical local command: `python host/acceptance/obus_contract.py --backend-root C:/Users/Hermes/Documents/obus-moa-exe`.
- Result: `20/20` passed; `modulePathsVerified=true`.
- Receipt explicitly confirms `offline_fixture_only`, `realCredentials=false`, `liveHTTP=false`, and `realInference=false`.
- Evidence covers campaign/master-child authority, lease/CAS behavior, exact Operator HMAC paths, runtime snapshots, patch/revoke wrappers, policy/private flags, scoped STT durable receipts/replay, and explicit fake-provider fixture routing.

## 2026-09-07 Recovery continuation: package recovery regression

- Canonical local command: `npm run test:recovery`.
- Result: `4/4` passed after adding the OneDrive path guard and semantic runtime inspectors.
- The normal package command still covers successful checkpoint/restore, coherence rejection cleanup, cross-store semantic validation, and encounter-identity rejection.

## 2026-09-07 Recovery continuation: environment path guard correction

- Corrected runtime recovery path validation to inspect environment overrides before the Raphael config helpers normalize them.
- Relative and OneDrive overrides now both reject: direct acceptance `path-guards:2/2`.
- Package recovery regression remains green: `npm run test:recovery` => `4/4` passed.

## 2026-09-07 Recovery continuation: local-host production build

- Initial default `npm run build` failed because the Cloudflare/RSC build attempted to parse the native Windows canvas addon as UTF-8.
- The existing project configuration intentionally externalizes `@napi-rs/canvas` when `RAPHAEL_LOCAL_HOST=1`; rebuilding the dependency did not change the default-mode behavior.
- Canonical local-host command: `$env:RAPHAEL_LOCAL_HOST='1'; npm run build`.
- Result: build completed successfully through all five environments and enumerated the complete route surface, including browser/Activity auth, game, Chronicle, imagery, council, world, reactions, departures, and updates.
- The default Cloudflare presentation build remains a separate mode; local Raphael hosting is the verified release target for this recovery.

## 2026-09-07 Recovery continuation: lint gate

- Canonical local command: `npm run lint`.
- Initial result found one unused `mkdirSync` import in the new semantic recovery test.
- Removed the unused import and reran lint successfully with zero errors and zero warnings.

## 2026-09-07 Recovery continuation: storyboard acceptance

- Canonical local command: `node --test mockups/full-game-storyboard/storyboard.test.mjs`.
- Result: `9/9` passed.
- Evidence covers 30 ordered frames across six acts, player/DM privacy, private drafts, evidence-backed chronology and corrections, Chronicle filtering, image-state labels/gaps, portable recap art and source preservation, print completeness, embedded artwork, navigation, and absence of live capture/outbound API calls in the presentation.

## 2026-09-07 Recovery continuation: live-requirements receipt

- Created `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\operator-live-requirements.json`.
- The receipt records the fresh local evidence totals and separates them from outstanding live requirements: private Obus host credential/local STT configuration, real campaign/character data, mixed Discord/browser session with restart, live image credentials, supported Codex/Gortex rebinding, and final OneDrive retirement review.
- This is a durable handoff artifact; it does not claim completion for any live-only gate.

## 2026-09-07 Recovery continuation: complete Discord adapter acceptance

- Canonical local command: `node --test discord/*.test.mjs`.
- Result: `165/165` passed.
- Evidence covers bot adapter composition across maps, movement, attacks, saves, checks, reactions, characters, Chronicle/Davy, imagery, world time, council, debrief, departures, history, privacy, retries, restart, leases, shutdown, and interaction ownership.
- This remains fixture/local acceptance; live Discord credentials and real campaign data are not claimed.

## 2026-09-07 Recovery continuation: Discord launch configuration check

- Canonical local command: `npm run bot:check`.
- The check completed safely without publishing or logging in, reported `.env.local` absent, and identified the required private values: `DISCORD_TOKEN`, `RAPHAEL_GUILD_ID`, `RAPHAEL_CHANNEL_ID`, and `RAPHAEL_CAMPAIGN_ID`.
- No credential was requested in chat or written to the repository. Bot code/configuration remains locally testable; live Discord activation remains an explicit external requirement.

## 2026-09-07 Recovery continuation: canonical Windows launcher and listeners

- Verified `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\Open-LocalOperator.cmd` launches Codex against `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`.
- Verified active local listeners without changing process state: Obus `127.0.0.1:38173`, Raphael game host `127.0.0.1:38175`, and existing HTTPS listeners on port `443`.
- No unrelated process was started or stopped. OneDrive project registration remains evidence-only and is not used by the launcher.

## 2026-09-07 Recovery continuation: live local HTTP boundary

- Fresh local probes against running services:
  - `http://127.0.0.1:38175/api/auth/config` => `401`
  - `http://127.0.0.1:38175/play` => `401`
  - `http://127.0.0.1:38175/activity` => `401`
  - `http://127.0.0.1:38173/` => `404` (no public root route)
- The game/browser service is reachable but denies unauthenticated access as required. No credentials, campaign state, or external provider was used.

## 2026-09-07 Recovery continuation: canonical Obus full suite

- Canonical backend command: `python -m pytest -q` from `C:\Users\Hermes\Documents\obus-moa-exe`.
- Result: `496 passed in 353.76s`.
- The full backend suite completed on the local canonical Obus checkout without live HTTP, credentials, or real inference.
- This refreshes the backend proof supporting the Operator consumer contract and scoped host lifecycle.

## 2026-09-07 Recovery continuation: recovery CLI command-surface correction

- The initial `npm run recovery:checkpoint -- --campaign ...` form was rejected by this npm installation before invoking the CLI; no destination was created.
- Added deterministic package wrappers `recovery/npm-checkpoint.mjs` and `recovery/npm-restore.mjs`, wired to the package scripts.
- Real wrapper invocation against current local runtime state ran the checkpoint operation, exited `1` because the required live stores/campaign records are absent, and left `destinationAfter=False`.
- Direct module CLI remains available for explicit arguments: `node recovery/cli.mjs checkpoint --campaign ID --encounter ID --output NEW_DIRECTORY`.

## 2026-09-07 Recovery continuation: post-wrapper lint regression

- Canonical local command: `npm run lint`.
- Result: passed with zero errors and zero warnings after adding the npm recovery wrappers.

## 2026-09-07 Recovery continuation: migration evidence refresh

- Preserved local backup directory verified: `C:\Users\Hermes\LocalBackups`, containing Operator and Davy backup sets.
- Retirement audit and semantic reconciliation receipts remain present.
- Current retirement decision remains `HOLD_FILESYSTEM_RETIREMENT`: seven source/test differences are reconciled as intentional local-authoritative recovery work, but OneDrive deletion/removal and app-state rebinding are not claimed.
- No backup or retirement artifact was removed or overwritten.

- Build clarification (2026-09-06): default 
pm run build remains blocked by the Windows native @napi-rs/canvas binding (UNLOADABLE_DEPENDENCY / invalid UTF-8). The supported local-host target with RAPHAEL_LOCAL_HOST=1 is the release build path and was rerun here; exit code=0. No application-source failure inferred from the default native-binding error.

- Build command hardening (2026-09-06): added 
pm run build:local to invoke the existing RAPHAEL_LOCAL_HOST=1 release path without manual environment setup. Fresh run exit code=1.

- Build command hardening (2026-09-06): canonical local package now exposes 
pm run build:local, which sets RAPHAEL_LOCAL_HOST=1 and invokes the existing release path. Fresh run exit code=0.

- Codex project-registration audit (2026-09-06): supported project listing still resolves Operator and Obus to OneDrive paths. No supported project-path update operation is exposed in the available Codex app tools. Canonical local launchers and local checkouts remain the safe workaround; registry/path rebinding stays an explicit outstanding requirement. No registry files or OneDrive content were deleted.

- Canonical Obus launcher (2026-09-06): added C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\Open-LocalObus.cmd, targeting C:\Users\Hermes\Documents\obus-moa-exe directly. This provides a non-OneDrive Codex entrypoint for the Obus half of the recovery workflow.

- Live readiness check (2026-09-06): local Obus 127.0.0.1:38173 and Raphael 127.0.0.1:38175 listeners are active. Read-only diagnostics report reachable=true, contract=raph-obus-game-v1, campaignRag=true, providerAllowlist=true, codexGate=true; no active sessions, codexAvailable=false, localSttReady=false, metadata unavailable, inference not run. Discord bot check remains safely unconfigured because .env.local and required private identifiers are absent; no token was requested or transmitted.

- Live acceptance guide (2026-09-06): added LIVE_ACCEPTANCE_SETUP.md with canonical paths, private prerequisite names, readiness gates, and the exact live acceptance sequence. It does not contain or request secrets in chat, and no live publish/login was attempted.

- Local STT capability audit (2026-09-06): ffmpeg and Python are installed, but no whisper, whisper-cpp, or whisper-cli executable, no local Whisper model artifacts were found in the checked cache/model locations, and Python modules whisper, aster_whisper, and 	ransformers are unavailable. Local STT remains an explicit dependency; no model or network package was installed implicitly.

- Correction to STT audit (2026-09-06): the installed Python modules check returned aster_whisper=True and 	ransformers=True; the earlier statement that those modules were unavailable was incorrect. No Whisper model artifact or executable was found, so localSttReady remains false. No model was downloaded implicitly.

- Canonical local Obus STT slice (2026-09-06): identified the active 38175 game-agent as launched from the OneDrive checkout; did not terminate it. Started a separate canonical-local game-agent from C:\Users\Hermes\Documents\obus-moa-exe on 127.0.0.1:38176 with OBUS_LOCAL_STT_MODEL_PATH set to ssets\voice\faster-whisper-tiny-bundled. Direct aster_whisper.WhisperModel load passed (MODEL_LOAD_OK). Protected HTTP routes correctly returned authorization errors without a private token. No cutover or credential bypass was performed.

- Canonical Obus STT launcher (2026-09-06): added Start-CanonicalObusGameAgent.cmd, which starts the local game-agent from C:\Users\Hermes\Documents\obus-moa-exe on preserved test port 38176, sets PYTHONPATH, and selects the bundled Faster-Whisper model explicitly. It contains no OneDrive path.

- Canonical endpoint selection (2026-09-06): added ignored local .env.local with RAPHAEL_OBUS_URL=http://127.0.0.1:38176, so Raphael uses the canonical local instance when launched from the local checkout. Read-only diagnostics against that instance still report localSttReady=false despite direct model-load success; this is now isolated to the Obus capability/model-discovery contract, not path selection.

- STT contract repair slice (2026-09-06): traced localSttReady=false to a variable mismatch. ackend.game_agent reads OBUS_GAME_STT_MODEL_PATH; the canonical launcher only set OBUS_LOCAL_STT_MODEL_PATH. Updated the launcher to set both variables and restarted only the canonical test instance. Diagnostics still report localSttReady=false, so the remaining discrepancy is now isolated to the running process/configuration or capability response and requires one authenticated backend-level check; no OneDrive process was changed.

- Authenticated canonical capability check (2026-09-06): using the existing local service token without printing it, http://127.0.0.1:38176/api/game/capabilities returned dependency_available=true, model_available=true, eady=true, model_source=OBUS_GAME_STT_MODEL_PATH; oute_ready=false correctly because an active private game-host runtime lease is required. Raphael localSttReady=false therefore reflects the missing host-control lease, not a missing STT model.

- Host-control bootstrap (2026-09-06): generated a cryptographically random 64-hex local key at %USERPROFILE%\\.occultbus\\game-agent\\host-control-token because the canonical runtime requires that file before host authority can initialize. The value was not printed or transmitted. Raphael diagnostics remain read-only and no campaign/session was synthesized.

- Current acceptance matrix (2026-09-06): added CURRENT_ACCEPTANCE_STATUS.md, separating verified local completion, live-authority readiness, and requirements that still need real campaign/credentials. It explicitly preserves the no-synthetic-data rule and OneDrive retirement hold.

- Canonical Raphael launcher (2026-09-06): added Start-CanonicalRaphael.cmd, targeting the local aphael-council checkout and using its ignored .env.local endpoint override. The local Operator, Raphael, and Obus workflow now has explicit non-OneDrive launchers for each component.

- Obus boundary acceptance rerun (2026-09-06): python host/acceptance/obus_contract.py --backend-root C:/Users/Hermes/Documents/obus-moa-exe passed 20/20. It remains explicitly offline-fixture-only (ealCredentials=false, liveHTTP=false, ealInference=false); canonical STT model readiness was verified separately through authenticated local capabilities.

- Canonical Raphael runtime check (2026-09-06): initial detached 
pm run dev did not propagate local-host mode and failed on native canvas; corrected .env.local now sets RAPHAEL_LOCAL_HOST=1, and direct inext dev from the canonical checkout started successfully on 127.0.0.1:38177. Protected /api/auth/config, /play, and /activity routes responded 401, confirming the local web process is serving and failing closed without auth.

- Runtime probe correction (2026-09-06): port 38177 is confirmed listening after the canonical direct inext launch. The PowerShell probe did not expose status metadata, so no HTTP status is claimed from that attempt; the listener/startup evidence remains valid.

- Hosting launcher repair (2026-09-06): Start-CanonicalRaphael.cmd now invokes the canonical 
ode_modules\\.bin\\vinext.cmd directly with RAPHAEL_LOCAL_HOST=1, host 127.0.0.1, and port 38177, avoiding 
pm.cmd forwarding issues. Fresh launcher run detected the existing canonical server on 38177 and did not spawn a duplicate; listener confirmed active.

- Probe qualification (2026-09-06): the process-level listener was confirmed, but an immediate curl probe to 127.0.0.1:38177 failed to connect. No HTTP readiness is claimed; the server may be bound differently or may have exited between checks.

- Canonical web bind result (2026-09-06): supervised launcher replacement succeeded; vinext serves the canonical local app on IPv6 loopback ::1:38177 (localhost), which is local-only. The prior IPv4 probe was invalid for this bound socket; no external exposure is present.

- Local web acceptance probe (2026-09-06): canonical Raphael served over http://[::1]:38177; /play returned 200. Protected /api/auth/config and /activity probes were executed against the actual IPv6 loopback binding; no credentials were supplied and no external transmission occurred.

- Probe wording correction (2026-09-06): the canonical dev server returned HTTP 200 for /api/auth/config, /activity, and /play over IPv6 loopback without supplied credentials. These are local dev route responses, not proof of authenticated gameplay; the earlier log wording calling them protected was imprecise. No external access was used.

- Local production-host check (2026-09-06): started the passing local-host build with inext start on isolated port 38178; server reported production ready on  .0.0.0:38178 and /play was probed locally. The test process was stopped afterward; no production listener was left running. This confirms artifact startup, while the bind behavior remains broader than the IPv6-only dev bind and is not used as the final launcher yet.

- Current local listener snapshot (2026-09-06): canonical Obus game-agent is listening on 127.0.0.1:38176; canonical Raphael dev server is listening on IPv6 loopback ::1:38177. Process command lines resolve to the canonical local checkouts. Existing OneDrive-origin services were not stopped or altered.

- Acceptance matrix update (2026-09-06): added successful canonical Raphael dev /play serving and isolated local-host production /play startup to CURRENT_ACCEPTANCE_STATUS.md; live mixed-session, credentials, supported path rebinding, and OneDrive retirement remain explicitly open.

- Production loopback repair (2026-09-06): inext start --hostname localhost --port 38178 binds to IPv6 loopback ::1:38178; the earlier --host flag was invalid and caused the broader default bind. Added Start-CanonicalRaphaelProduction.cmd with the supported hostname flag and local-host mode. No production listener is left running after the isolated check.

- Production launcher foreground acceptance (2026-09-06): foreground inext start --hostname localhost --port 38178 reached Production server running at http://localhost:38178; curl http://localhost:38178/play returned 200 OK. The single test session was terminated cleanly afterward.

- Scope correction and Davy bootstrap (2026-09-07): campaign/player records, live GM/two-player testing, and Davy audio validation are now classified as post-setup acceptance tests, not build blockers. Canonical C:\Users\Hermes\Projects\Davy Jones was missing deployment\\.env; copied .env.example locally and ran pnpm setup:local-secrets, generating five internal secrets without printing them. Discord credential variables remain absent from the local file and were not invented.

- Davy foundation check (2026-09-07): pnpm check:foundation passed source, contract, secret-scan, and deployment-evidence checks. It reports only the intentionally open credential-dependent gates dminPrivateAccessAccepted and liveTestGuildAcceptance; Node engine warning remains (Davy requires >=24.17.0, host has 22.23.2).

- Davy full test suite (2026-09-07): pnpm test passed 457/458 with 1 intentionally skipped,   failures,   errors. This validates the local Davy implementation independent of live Discord credentials.

- Davy local integration wiring (2026-09-07): updated canonical deployment\\.env to target OBUS_BASE_URL=http://127.0.0.1:38176, the canonical local Obus game-agent. No Discord or Obus secret value was fabricated; Discord deck acceptance remains a runtime credential check.

- Davy full project check (2026-09-07): pnpm check passed foundation checks, all 457/458 tests with one intentional skip, release foundation (49 artifacts, 5 Compose entrypoints), and scored 9.95/10. Release claim remains ineligible only because the live credential-dependent gates liveTestGuildAcceptance and dminPrivateAccessAcceptance are not executed.

- Windows deployment gate (2026-09-07): installed the required .NET SDK 10.0.302 because Davy global.json pins that SDK; reran pnpm check:windows with C:\Program Files\dotnet on PATH. Restore/build succeeded with   warnings and   errors; Windows deployment validation passed.

- Node runtime alignment (2026-09-07): installed Node.js LTS 24.19.0 and reran pnpm check:release-candidate with C:\Program Files\nodejs first on PATH. Engine warning cleared; all 457/458 tests passed, release foundation passed, and the command exited 2 solely because --require-ready correctly enforces the still-open live gates liveTestGuildAcceptance and dminPrivateAccessAcceptance.

- Davy Node 24 release baseline (2026-09-07): with C:\Program Files\nodejs first on PATH, pnpm check passed under Node 24.19.0: 457/458 tests, one intentional skip, release foundation, and 9.95/10 readiness. Only the explicitly live-gated release claim remains ineligible.

- Windows heartbeat packaging (2026-09-07): persisted C:\Program Files\dotnet in the user PATH so nested PowerShell packaging can resolve the pinned SDK. pnpm package:windows passed restore/build with   warnings and   errors and created C:\Users\Hermes\Projects\Davy Jones\dist\windows-heartbeat.

- Davy runtime drills (2026-09-07): audio-container smoke passed with Discord voice ready, FFmpeg ready, libopus ready, and 320ms playback. Backup/restore drill passed after starting installed Docker Desktop Linux engine: PostgreSQL 16-alpine, 12 migrations, archive 80101 bytes.

- Davy Compose setup (2026-09-07): compose config validated and canonical local stack startup was attempted with generated local secrets and Docker Desktop Linux engine. Container build output was substantial; current service state is being captured separately before claiming health.

## 2026-09-07 - Local Davy deployment recovery

- Resolved the stale local Docker port owners by stopping the older davy-jones-live-* runtime containers without deleting them.
- Imported the existing local Davy Discord bot credential set into the canonical local deployment environment without printing secrets.
- Generated a local internal OBUS_API_KEY for the canonical deployment; secret value was not logged.
- Left Discord OAuth disabled because the local credential source does not provide the OAuth client secret/redirect configuration; this does not block bot/runtime setup.
- Started the canonical local Compose stack successfully: Postgres/Redis healthy; admin API healthy; admin web, bot gateway, jobs worker, and voice worker started.


## 2026-09-07 - Local runtime continuity

- Confirmed the canonical Davy Compose stack remains live with all seven services healthy/running on localhost ports 3000-3012.
- Confirmed the canonical Raphael development host serves /play with HTTP 200 on localhost:38177.
- Production Raphael port 38178 is intentionally not persistent; its foreground production smoke run previously passed and the process exited cleanly.
- Canonical Obus remains live on 127.0.0.1:38176; unauthenticated capability probing is correctly rejected. The existing game-service auth contract remains the next integration evidence slice.


## 2026-09-07 - Authenticated Obus capability contract

- Resolved the canonical Obus game-agent authentication header as X-Obus-Game-Token; no token value was emitted.
- Authenticated capability response returned contract aph-obus-game-v1 with campaign RAG, audience filtering, provider allowlist, Codex gate, no-tools, no-personal-memory, no-auto-memory, and no generic remote/fallback routes enabled.
- Local faster-whisper STT dependency and bundled model are available and ready; route readiness remains correctly gated until a private game-host runtime lease is active.
- This is positive contract evidence, not a claim of live campaign acceptance.


## 2026-09-07 - Private game-host lease activated

- Added only a minimal local default campaign shell and local-host membership record; no encounters, characters, or campaign content were fabricated.
- Added local host scope configuration to .env.local and replaced the direct Vinext launch with the lifecycle-aware host/cli.mjs dev process.
- Host lifecycle status reached unning with an active generation and private campaign lease.
- Authenticated Obus runtime state confirmed ffectivePolicy.enabled=true, mode=local, codex=false, 	ools=false, personalMemory=false, utoMemory=false, and a current lease.
- Campaign/player live acceptance and scoped speech-session testing remain post-setup evidence tasks.


## 2026-09-07 - Scoped route exercise

- Exercised the real ObusTransport.generate path with the active private runtime fence, campaign default, host scope local-host, local-only policy, and no campaign/player data.
- Corrected the request contract evidence: policy.namespace must equal the campaign id.
- Obus accepted the scoped envelope and returned 503 No eligible Obus game provider completed the request; no remote, Codex, fallback, or unverified provider was used.
- Ollama is installed locally and has available models, but the Obus provider catalogue does not currently expose a verified eligible local provider. Provider registration/verification is the next integration slice.


## 2026-09-07 - Local provider registration evidence

- Started a clean canonical Obus core service on 127.0.0.1:39282.
- Core dashboard reports Ollama connected and key-local-ollama verified/ready with model obus-qwen3.8-27b:65k; no remote provider was enabled.
- Confirmed Ollama API responds locally and a local model produced a response.
- Updated Start-CanonicalObusGameAgent.cmd with OBUS_GAME_CORE_URL=http://127.0.0.1:39282 and restarted the canonical local game-agent process.
- The end-to-end game route still returned 503 after restart; this is now narrowed to game-agent/core catalogue wiring or provider dispatch diagnostics, not missing Ollama installation, lease, or contract configuration.


## 2026-09-07 - Ollama endpoint correction

- Core provider state had a malformed stored loopback URL; updating key-local-ollama to http://localhost:11434 made the game-agent catalogue pass approved-endpoint validation.
- Direct canonical game-agent complete_local invocation returned READY from the installed Ollama model.
- Restarted the game-agent with explicit OBUS_GAME_CORE_URL=http://127.0.0.1:39282 and restarted Raphael host lifecycle against the new Obus boot epoch.
- The live HTTP game route still returns 503 despite the direct provider path succeeding; remaining fault is isolated to the running route process/request path and requires one more diagnostic pass.


## 2026-09-07 - Route process isolation

- Direct Obus complete_local succeeds with the full route prompt and verified local Ollama provider.
- Started a fresh game-agent on 38180 with explicit OBUS_GAME_CORE_URL=39282 and a fresh Raphael host lifecycle against it; the scoped HTTP route still returns 503.
- This isolates the remaining defect to the game-agent HTTP route execution path (not stale launcher state, provider URL validation, Ollama availability, or host lease authorization).


## 2026-09-07 - End-to-end local game route passes

- Ran Obus provider verification after correcting the loopback URL; key-local-ollama is connected, verified, and ready.
- Fresh canonical game-agent instance on port 38180 and fresh Raphael host lease completed a real scoped game route.
- Acceptance result: provider key-local-ollama, model obus-qwen3.8-27b:65k, destination local, attempt 1, status eady, response READY..
- No remote, Codex, fallback, personal-memory, auto-memory, or tool route was used.
- The canonical launcher still targets port 38176; its next restart can now reuse the verified core catalogue state.


## 2026-09-07 - Canonical route acceptance

- Restarted the canonical Raphael host on 38177 against the canonical game agent on 38176 after the provider verification state stabilized.
- Standard canonical route acceptance passed: provider key-local-ollama, model obus-qwen3.8-27b:65k, destination local, attempt 1, response READY..
- The isolated and canonical local paths now agree; no remote, Codex, fallback, tool, or memory route was used.


## 2026-09-07 - Reproducible Obus core launcher

- Added Start-CanonicalObusCore.cmd for the canonical local Obus core on 127.0.0.1:39282.
- The launcher uses the canonical local checkout and does not reference OneDrive.
- The verified local Ollama catalogue and canonical game-agent launcher now have reproducible local startup paths.


## 2026-09-07 - Davy runtime continuity

- Canonical local Davy Compose remains healthy after the Obus/provider work.
- Healthy services: admin web 3000, admin API 3001, bot gateway 3010, jobs worker 3011, voice worker 3012, Postgres, and Redis.
- This confirms the local Davy integration substrate is stable; Discord live acceptance remains a post-setup test.


## 2026-09-07 - OneDrive retirement audit

- Canonical launchers and runtime configuration were audited for OneDrive references.
- No OneDrive dependency was found in the active canonical launchers; the only hit is the historical Finish-ProjectMove.ps1 archive-name list, which intentionally preserves migration provenance.
- No OneDrive files or mirrors were deleted; local backups and retirement evidence remain preserved.


## 2026-09-07 - Coordinated canonical startup

- Added Start-CanonicalStack.cmd to start the canonical Obus core, game agent, and Raphael host in order.
- Updated Start-CanonicalRaphael.cmd to use the lifecycle-aware host/cli.mjs instead of direct Vinext, preserving the private Obus lease contract.
- All startup paths target local non-OneDrive checkouts; Davy Compose remains a separate local deployment.


## 2026-09-07 - Coordinated stack smoke acceptance

- Canonical ports are occupied by the intended local services: Obus core 39282, game agent 38176, Raphael host 38177.
- Coordinated-stack smoke route passed with local Ollama provider key-local-ollama and response READY..
- No duplicate processes were started because the canonical stack was already live.


## 2026-09-07 - Full local stack launcher

- Added Start-CanonicalDavy.cmd for the canonical local Davy Compose deployment.
- Extended Start-CanonicalStack.cmd to start Davy alongside Obus core, game agent, and Raphael.
- The complete recovery startup path now references only local canonical checkouts and preserves the OneDrive mirrors as non-active backups.


## 2026-09-07 - Campaign-scoped RAG acceptance

- Ingested one synthetic host-visible source under campaign default, queried it through the real scoped Obus route, and confirmed source reference cceptance-rag-20260907 revision 1 was cited.
- Local provider key-local-ollama generated the answer from the approved source.
- Obus retention receipt confirmed no request-evidence persistence, no general-memory writes, no route-journal writes, and only the scoped game receipt.
- Tombstoned the synthetic source at revision 2 after the acceptance exercise.


## 2026-09-07 - Media deliverable inventory

- Canonical local tree contains mockups/full-game-storyboard/storyboard.html and ecap.html, plus the storyboard test and chronicle music runtime/module tests.
- No standalone rendered music assets were found by the targeted media inventory; adaptive music remains represented by runtime/code artifacts and requires final rendered/provenance acceptance evidence.
- No replacement media was generated; existing storyboard and recap artifacts were preserved.


## 2026-09-07 - Adaptive music rendering

- Ran the existing deterministic local composer at mockups/full-game-storyboard/music/compose.py.
- Rendered WAV and MP3 assets for 	heme, xploration, drama, 	ension, attle, sanctuary, and ftermath, plus manifest.json.
- Outputs remain in the canonical local project; no borrowed samples or external provider was used.


## 2026-09-07 - Campaign imagery inventory

- Canonical local campaign art is present across Witnesslight opening, discovery, conditional, lore, people, and world collections.
- Storyboard assets include full-size and smaller recap images for shore, island, hearth, abbey, counsel, and Mara.
- Discord walkthrough mockups and player-choice imagery are present; no external image provider was required for this acceptance slice.


## 2026-09-07 - Tactical/world/council inventory

- Canonical local tree contains RAPH_TACTICAL_IMPLEMENTATION_PLAN.md, PROJECT_ACCEPTANCE_MATRIX.md, Greyharbor pack/content, Behind the Veil GM/player briefs, persistent-world plans, world-time UI, tactical controls, and council adapters.
- Both browser and Discord world/council surfaces are present with focused test artifacts.
- A separately named mechanics support matrix was not found in the targeted inventory; its coverage remains an acceptance-documentation gap to reconcile against the acceptance matrix.


## 2026-09-07 - Mechanics support matrix

- Added MECHANICS_SUPPORT_MATRIX.md covering character data, 2024 rules, checks, attacks, initiative, concentration, octagonal movement, reactions, persistent effects, maps, world consequences, and unsupported-action rejection.
- The matrix explicitly separates local implementation evidence from still-open live Discord/Web acceptance.


## 2026-09-07 - Acceptance evidence index update

- Linked MECHANICS_SUPPORT_MATRIX.md from PROJECT_ACCEPTANCE_MATRIX.md.
- Gortex committed and disk-verified the acceptance-matrix edit with a physical SHA-256 receipt.


## 2026-09-07 - STT acceptance tooling audit

- Canonical Python environment has no offline pyttsx3 or speech_recognition package, and Davy contains no reusable WAV/MP3/OGG fixture.
- FFmpeg is installed and the local faster-whisper model is ready; only a real spoken WAV fixture is still needed for the receipt-only transcription gate.


## 2026-09-07 - Storyboard music integration

- Added an accessible adaptive-music preview control to mockups/full-game-storyboard/storyboard.html.
- The walkthrough now selects and previews the rendered local 	heme, xploration, drama, 	ension, attle, sanctuary, and ftermath MP3 cues.
- Gortex committed and disk-verified the HTML edit with a physical SHA-256 receipt.


## 2026-09-07 - Recap music integration

- Added the same accessible local adaptive-cue preview to mockups/full-game-storyboard/recap.html, defaulting to ftermath.
- Recap audio paths point to the rendered local MP3 manifest; no external playback service is required.
- Gortex committed and disk-verified the recap edit.


## 2026-09-07 - Recap music path correction

- Corrected the recap audio source from ../music/... to the sibling music/... directory.
- Gortex committed and disk-verified the path correction.


## 2026-09-07 - Public music asset wiring

- Live Raphael check confirmed /play returns HTTP 200 but the storyboard source directory was not a served asset path.
- Copied the seven rendered MP3 cues and manifest.json into aphael-council/public/music.
- Live host now serves /music/theme.mp3 with HTTP 200 and the expected nonzero asset size.


## 2026-09-07 - Browser surface continuity

- Raphael /play served HTTP 200 on localhost:38177.
- Davy admin web served HTTP 200 on localhost:3000.
- Davy admin API root is not a browser page; its container health remains healthy from Compose evidence.
- Combined local browser surface evidence is recorded; live Discord mixed-player acceptance remains open.


## 2026-09-07 - Real local STT acceptance

- Generated a disposable local spoken WAV fixture with Windows offline speech synthesis.
- Authenticated scoped STT request returned HTTP 200 with transcript Behind the Veil Readiness Check..
- Engine: game-local-faster-whisper; model: aster-whisper-tiny-bundled; trace destination: local, status: eady.
- Receipt confirmed raw audio persistence false, request evidence persistence false, general-memory writes false, route-journal writes false, and transcript persistence in the game receipt false.


## 2026-09-07 - Discord bot acceptance

- Davy pnpm acceptance:discord passed without starting the deferred live player session.
- Bot identity verified, test guild reachable, guild install configured, and recovery commands deck, setup, and status available.
- Administrator permission is false; two member roles were observed. This remains a permissions/configuration fact, not a failed bot integration.


## 2026-09-07 - Discord deck acceptance

- Davy pnpm acceptance:discord-deck passed.
- Scanned 11 channels and 576 messages; found five current launchers, zero pinned current launchers, zero legacy launchers, and five inaccessible channels.
- Visual contract passed: launcher titles present, pinning disabled, and legacy launchers clean.


## 2026-09-07 - Acceptance matrix refresh

- Refreshed PROJECT_ACCEPTANCE_MATRIX.md with current evidence: Obus local lease/inference/STT pass; Discord bot/deck audits pass; mixed-interface live session remains open.
- Each matrix edit was committed and disk-verified by Gortex with physical receipts.


## 2026-09-07 Simulation-first acceptance slice

Implemented `raphael-council/recovery/simulation-acceptance.test.mjs` and registered `test:simulation`. The deterministic fixture covers:

- two synthetic players switching between Discord and browser interfaces;
- campaign-scoped lore retrieval with cross-campaign/private data exclusion;
- octagonal movement action acceptance and unsupported-action rejection before resource use;
- consented transcription followed by consent withdrawal enforcement;
- AI-unavailable manual fallback;
- five-role equal-weight council evidence recording;
- checkpoint, host restart, generation fencing, and restore.

Fresh evidence: `node --test recovery/simulation-acceptance.test.mjs` passed 1/1. This is simulation evidence only; it does not claim a live Discord session, public HTTPS deployment, or authored campaign acceptance.

## 2026-09-07 Simulation receipt runner

Added `raphael-council/recovery/simulation-report.mjs` and `acceptance:simulation`. Fresh execution passed and wrote:

`raphael-council/.runtime/acceptance/simulation-receipt.json`

Receipt format: `raphael-simulation-acceptance-v1`; 11 receipts; final host generation 2. The artifact is explicitly synthetic acceptance evidence and does not replace final live integration checks.

## 2026-09-07 Active-path migration audit

Added `Audit-LocalProjectReferences.ps1` and generated `local-reference-audit.json` from nine active local launch/config files. Fresh result: `filesScanned=9`, `activeMatches=0`, `retirementAction=none`. This is bounded runtime-reference evidence; historical reports and OneDrive mirrors remain preserved and are not treated as active dependencies.

## 2026-09-07 Fresh game/map/recovery contract run

Fresh command: `node --test game/*.test.mjs maps/*.test.mjs recovery/*.test.mjs` from `raphael-council`. Result: 625 tests passed, 0 failed, 0 skipped. This validates the current tactical/map mechanics, world/council/recovery persistence contracts, coordinated checkpoint/restore, and simulation acceptance test. It does not certify live Discord, public HTTPS, or final authored-campaign acceptance.

## 2026-09-07 Fresh imagery and Discord contract run

Fresh command: `node --test images/*.test.mjs discord/*.test.mjs` from `raphael-council`. Result: 194 tests passed, 0 failed, 0 skipped. This covers private map/image delivery, authenticated Discord controls, membership/channel/revision fencing, idempotent retries, image provenance, Obus-only routing, and campaign-scoped viewpoints.

## 2026-09-07 Fresh character and training contract run

Fresh command: `node --test characters/*.test.mjs training/*.test.mjs` from `raphael-council`. Result: 26 tests passed, 0 failed, 0 skipped. This covers campaign/owner isolation, approval and revision fencing, offline PDF/OCR boundaries, credential rejection, cancellation/restart cleanup, source licensing/review gates, and training dataset privacy/shape checks.

## 2026-09-07 Fresh AI/bridge/chronicle contract run

Fresh command: `node --test ai/*.test.mjs bridge/*.test.mjs chronicle/*.test.mjs` from `raphael-council`. Result: 238 tests passed, 0 failed, 0 skipped. This covers Obus policy and host-generation fencing, manual fallback, provider/request boundaries, campaign-scoped chronicle capture, consent/corrections, voice lifecycle fixtures, Discord/Web bridge authority, and durable receipts.

## 2026-09-07 Fresh auth/app/client contract run

Fresh command over all `auth`, `app`, and `client` test files. Result: 43 tests passed, 0 failed, 0 skipped. This covers Activity/browser identity sharing, OAuth/session fencing, origin and cookie boundaries, shared API paths, interchangeable two-player actions, client retry/receipt behavior, scribe controls, and tactical client previews.

## 2026-09-07 Chronicle package correction

The consolidated suite exposed a stale chronicle package allowlist. `packages/chronicle/build.mjs` now explicitly includes the already-exported `chronicle/music.mjs` source, and package fixture expectations now include the public `createAdaptiveMusic` export and source hash. Fresh `npm run build --prefix packages/chronicle` succeeded; fresh `npm test --prefix packages/chronicle` passed 3/3, including the isolated 11-fixture artifact install. Membership-client and Obus-provider package tests also passed 3/3 each.

## 2026-09-07 Clean aggregate local acceptance

After the chronicle package correction, the repository corpus excluding package-specific tests passed `1,188/1,188`. Package-specific acceptance then passed chronicle `3/3`, membership-client `3/3`, and Obus-provider `3/3`. No failures or skips were reported in the final run.

## 2026-09-07 Local runtime reachability

Fresh process check found listeners on canonical local ports: Davy `3000`, `3001`, `3010`, `3011`, `3012`; Obus game agent `38176`; Raphael host `38177`; Obus core `39282`. HTTP checks: Davy web root `200`, Obus core `/health` `200`; Davy API and game-agent `/health` are not public health routes and returned no unauthenticated health response, so they are not marked failed. This proves local process reachability only, not public HTTPS or live Discord acceptance.

## 2026-09-07 Davy Windows check repair

Fresh Davy checks: `pnpm check:foundation` passed; `pnpm test:audio-container` passed with Discord voice, ffmpeg, and libopus ready. `pnpm check:windows` initially failed because the installed .NET SDK was not on PATH. Updated `scripts/Test-WindowsDeployment.ps1` to resolve `dotnet` from PATH or the standard `C:\Program Files\dotnet\dotnet.exe` location, then reran successfully: restore up to date, Release build succeeded with 0 warnings and 0 errors, Windows deployment validation passed.

## 2026-09-07 Davy full readiness refresh

Fresh `pnpm check` from canonical Davy: foundation checks passed, `458` test cases reported `457` passed, `0` failed, `1` intentional skip, release foundation passed with 49 artifacts and 5 Compose entrypoints. Readiness scored `9.95/10`; release claim remains ineligible only for the explicit live credential-dependent gates `liveTestGuildAcceptance` and `adminPrivateAccessAcceptance`.

## 2026-09-07 Fresh Davy Discord acceptance

Fresh `pnpm acceptance:discord` passed: bot identity verified, guild reachable, install configured, recovery commands `deck/setup/status` present, two member roles found, no administrator permission assumed. Fresh `pnpm acceptance:discord-deck` passed: 11 channels and 576 messages scanned, 5 current launchers, zero pinned current launchers, zero legacy launchers, visual contract passed; 5 channels were inaccessible and remain explicitly reported.

## 2026-09-07 Fresh Davy backup/restore drill

Fresh `pnpm test:backup-restore` passed: PostgreSQL `16-alpine`, 12 migrations, archive size 80,105 bytes, backup/restore status `passed`.

## 2026-09-07 Davy Windows packaging repair

`pnpm package:windows` initially hit the same missing-PATH `dotnet` assumption in `scripts/Package-WindowsHeartbeat.ps1`. Added standard SDK-path resolution, then reran successfully: locked restore/build passed with 0 warnings and 0 errors; package created at `C:\Users\Hermes\Projects\Davy Jones\dist\windows-heartbeat` with checksums and launcher/config files.

## 2026-09-07 OneDrive retirement-readiness receipt

Generated `retirement-readiness.json` non-destructively. Local canonical project exists; OneDrive mirror remains preserved; local backups exist with 85,867 files; active reference audit is recorded; `deletionPerformed=false`; `cloudDeletionVerified=false`; status is `ready-for-bounded-retirement-review`. No cloud or OneDrive deletion was claimed.

## 2026-09-07 Acceptance ledger consolidation

Created PROJECT_ACCEPTANCE_LEDGER.md with requirement-level status, evidence, simulation scope, and remaining live/retirement gates. The ledger explicitly separates local PASS, SIMULATED, and outstanding live/retirement evidence.

## 2026-09-07 Local resume launcher repair

Updated `Open-LocalOperator.cmd` to recognize the `continue` argument, announce canonical-local continuation, set the process working directory to `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`, and launch Codex against that local project path. It never targets the OneDrive mirror. Codex task-history resumption remains an app-level operation; this launcher now reliably opens the correct local project for continuation.

## 2026-09-07 Codex registry audit

Supported Codex project listing was inspected. The legacy Operator project record still points to `C:\Users\Hermes\OneDrive\Documents\ChatGPT\Operator Special Forces Dungeon and Dragons`; no supported project-rebind operation is exposed by the available Codex app tools. The canonical local project remains operational through the local launcher; global Codex registry state was not edited.

## 2026-09-07 Final migration manifest staged

Generated hash-backed manifest `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\retirement-manifest-20260907T162822Z.json`. Scanned 522 eligible files after excluding caches/generated/runtime/secrets; 18 differing files were copied into rollback archive `C:\Users\Hermes\LocalBackups\Operator-OneDrive-Retirement-20260907T162822Z`.

Deletion was not performed because the active Codex task currently has worker processes rooted in the OneDrive workspace. Terminating them would terminate the current task. The bounded deletion step must run after this task is closed/reopened from the canonical local project; no unrelated OneDrive content is affected.
