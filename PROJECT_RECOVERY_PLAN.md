# Operator project recovery, intended outcome, and execution plan

Recovery date: 2026-09-07 UTC. Status: ACTIVE; migration and full game release are not complete. Current execution evidence is recorded in `PROJECT_EXECUTION_LOG.md`. Goal A01 is complete at the isolated source-contract level: 20 consumer checks and 26 backend regression tests pass; live activation remains A02/A03.

This is the durable continuation record for Operator Special Forces Dungeon and Dragons, Raphael, and the associated Davy Jones/Obus game integration. Resume from the first actionable unchecked goal. An interrupted or archived Codex task is historical evidence, not a reason to abandon its requested feature.

## Canonical locations

| Purpose | Location |
|---|---|
| Operator source, assets, and this plan | `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons` |
| Existing Davy Jones application | `C:\Users\Hermes\Projects\Davy Jones` |
| Canonical Obus backend | `C:\Users\Hermes\Documents\obus-moa-exe` |
| Paired Obus project | `C:\Users\Hermes\Projects\OBus-Thor-Loki-Paired` |
| Preserved old Obus clone | `C:\Users\Hermes\Projects\Archives\obus-moa-exe-from-OneDrive` |
| Other migrated projects | `C:\Users\Hermes\Projects\Voice Chat` and `C:\Users\Hermes\Projects\Tv broadcast` |
| Davy artwork and Obus binaries | `C:\Users\Hermes\Projects\Game Assets\Davy Jones` and `C:\Users\Hermes\Projects\Obus-Artifacts` |
| Migration evidence | `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z` |
| Dated rollback copies | `C:\Users\Hermes\LocalBackups` |
| Private game-agent data | `C:\Users\Hermes\.occultbus\game-agent` |
| Raphael runtime data | `C:\Users\Hermes\AppData\Local\Raphael` |

All new work, builds, logs, assets, databases, and recovery records must use local paths. Preserve these project names. Never replace the canonical Documents Obus repository with the archived OneDrive clone.

## What the user asked to build

1. One complete game usable interchangeably in a Discord Activity and a browser, using the existing Davy Jones application. Characters, maps, turns, world consequences, journals, transcripts, and GM controls share authoritative server state. Players may switch interfaces during a session.
2. Obus as the sole gameplay AI and speech entry point. Local models handle routine work; permitted free providers are the intended fallback. Optional Codex escalation is controlled by the host, defaults off, and resets off after host restart. Developing the project with Codex does not enable Codex in gameplay.
3. Campaign-scoped retrieval of approved lore, rules, characters, confirmed events, corrected transcripts, and council records. Filter by campaign, role, and visibility before retrieval/reranking. Exclude personal memory and other projects. Preserve provenance and revisions; the database remains authoritative.
4. A human-DM companion with private read-aloud scene guidance, editable drafts, delivery notes, and separate secrets. Automated arcade mode remains available. Generated suggestions do not become confirmed events without an authorized action.
5. A session scribe for Discord voice and typed messages: attributed transcripts, separate capture/external-processing consent, pause/resume, corrections, recording gaps, summaries every DM/Admin-configured number of minutes, and a searchable tagged chronicle containing transcripts, summaries, scenes, and images. Finish with an illustrated chronological recap using smaller scene images and cited evidence.
6. A full tactical system with the documented octagonal movement house rule: approved character creation/import, versioned 2024 mechanics, checks/saves/attacks/damage, initiative/resources/conditions/concentration, connected maps, terrain/elevation/visibility, footprints, movement previews, reactions/interrupted movement, persistent effects, and GM adjudication. Publish a mechanics support matrix and reject unsupported actions before spending resources.
7. A persistent Greyharbor / Behind the Veil campaign: exploration, negotiation, rescue, discoveries, staged objectives, factions, relationships, clocks, leads, recovery, consequences, mission transitions, debrief/downtime, save/resume and export/import. Five council roles assess independently with equal votes and recorded evidence. AI recommendations never gain mechanical or player-decision authority.
8. Campaign illustrations and images for future player choices, alongside deterministic tactical snapshots. Approved existing images remain usable when generation is unavailable. Illustrations must not disclose hidden state or imply invented mechanical outcomes.
9. A 30-panel cinematic storyboard and clickable Admin/DM/Player walkthrough of Behind the Veil: Saltglass Shore, courier rescue, patrol, Abbey, and debrief. Include printable presentation, sample dialogue, actions, transitions, consent, corrections, failures, and illustrated recap. Treat example story content as a demonstration, not live campaign history.
10. Original adaptive music reflecting visible gameplay moods, including dramatic/exploration cues and exciting rock battle music, a recurring Crossing the Veil theme, transitions, DM mood override, narration ducking, and break silence. Avoid borrowed samples/recordings. Document provenance and actual usage terms; do not make an unsupported guarantee that generated work has no copyright anywhere.
11. Local Windows hosting with start/stop/status/diagnostics, coordinated backup/restore, reuse of healthy Obus services, one existing bot gateway, and an HTTPS game endpoint for Discord and browser access. Keep model administration, databases, and provider credentials private. Preserve manual play if every AI service is unavailable.
12. Consolidated execution across the interrupted project tasks, preserving prior work and its evidence. The current user explicitly requests a summary, ordered plan, goal list, continuation, and removal of this project's OneDrive dependence.

## MemPalace project and gameplay memory

September 9, 2026: the user authorized MemPalace for both Codex project memory and live gameplay memory. [Integration, library, isolation and operating notes](docs/memory/MEMPALACE.md) describe the two separate stores.

Developer recall is available through the existing local MemPalace MCP connection, scoped to `operator-dnd-development`; the imported research retains its proposal and not-run labels. Project AGENTS.md defines the ongoing recall/checkpoint workflow. Native Codex, Codex Coordinator, Chronos and Gortex retain their existing responsibilities.

The canonical Obus retrieval layer now contains a private MemPalace adapter that ranks currently authorized source IDs, rechecks source access/revisions, and retains existing retrieval fallback. The private configuration is enabled and the local embedding model is present. Production service activation remains pending because the app's execution policy rejected the service-start action; no running production usage is claimed. Verification passed all 197 selected adapter and game regression checks, including 15 memory checks and the real backend in a disposable store. The gameplay memory cache retains vectors and opaque identifiers without duplicating source or query text. The latest regression also hydrates accepted ranking results from the authoritative database and deduplicates references. A malformed-worker score-boundary reproducer passes 4/4 after the overflow-safe range-guard correction. CodeRabbit's latest review of the four changed files completed with zero findings. This does not close the existing A05/Q01 goals or execute the 48 proposed D&D acceptance cases.

## D&D Gameplay Research — DM Procedures & Acceptance Tests

Documentation imported September 9, 2026 into this existing project:

- [Research index, limitations, and provenance](docs/research/dnd-gameplay/README.md)
- [Research and proposed play contract](docs/research/dnd-gameplay/Operator_Special_Forces_Dungeon_Research_and_Play_Contract.md)
- [Acceptance specifications (JSON)](docs/research/dnd-gameplay/Operator_Special_Forces_Dungeon_Acceptance_Specs.json)

Both supplied materials are preserved unchanged. The 48 Given/When/Then cases (G01–G48) are proposals, not executable tests: aggregate status remains `not_run_against_project`; every case remains `not_run`, with no observed result or evidence artifacts. Import checks are not gameplay acceptance. These documents do not establish implemented features, verified defects, or completion of any existing goal.

Retain the research limitations: no completed full-video/transcript or channel audit, no exact repository or D&D JSON corpus audit by the research author, and no game certification. Craft advice remains distinct from official rules; the rescue and numeric examples remain illustrative, not campaign canon. The JSON's `rules_family: null` does not override this plan's stated 2024 direction or migrate a campaign.

These materials can inform later consideration under T01/T02 (mechanics and procedures), W01 (world continuity), and Q01 (integrated acceptance). Mapping cases to verified project/campaign rules and collecting actual evidence remain future work. The instructions within the imported documents are proposed handoff content; this import does not dispatch that work or change existing implementation or acceptance statuses.

## Evidence recovered so far

Read directly: the migration launcher and `RECOVERY.md`; the local `raphael-council/OBUS_INTEGRATION.md` through Gortex; the accepted Discord/Web plan; the scribe/storyboard/music requests; and the newest coordination history. The archived task inventory was obtained through Codex native tools. Some older task pages remain to be recovered; this document does not claim their full histories were inspected.

| Existing task title | Task ID | Recovered scope / evidence |
|---|---|---|
| Plan Discord activity with Web UI | `01a077b2-2000-7e11-b320-ef4938c02261` | Accepted six-phase integrated game plan and interrupted implementation |
| Coordinate project threads | `01a077d3-b940-75e0-be6f-96006e4970ab` | Central integration decisions; newest ten turns recovered; older pages remain |
| Plan tactical map combat system | `01a0772e-83f5-7171-a4c2-be7340d8e196` | Tactical/world implementation; retrieved output included journal and private Discord refresh evidence; original roadmap needs bounded recovery |
| Add human DM session scribe | `01a0775e-4a0e-7ef3-91d6-220cf844a9f7` | Scribe, 30-panel walkthrough/presentation, and adaptive music requests |
| Create campaign story images | `01a074f3-b915-7211-8874-3ee3b9043b74` | Inventory identifies campaign artwork and future-choice imagery; detailed handoff remains to retrieve |
| Host Raph on this PC | `01a0788e-642e-7a72-90c8-bcd5210108de` | Inventory identifies local hosting and hosting-option evaluation; detailed handoff remains to retrieve |
| Coordinate Operator dungeon work | `01a077f6-d4cf-7321-ab35-177eb243cf52` | Davy integration ownership; local integration document supplies portable package contract; detailed task handoff remains to retrieve |
| Integrate ChatGPT Share | `01a074cf-b7a0-7180-a4ed-aafac3076701` | Inventory identifies a referenced shared specification; preserve as unresolved requirements-recovery item |
| Adopt multi-agent framework | `01a073dc-2452-7a31-aadf-dcc2c2a21dd4` | Inventory identifies Raphael collaboration framework request; detailed accepted decision remains to retrieve |
| Create Ghidra analysis skill | `01a073ba-e4a2-7b12-abb0-0a3127000d35` | Related tooling request; installed skill is available, but completion evidence has not been audited here |
| Continue current task | `01a067e3-f1dd-7b51-8c5c-829f3be70c3f` | Existing Obus task; inspect only game-integration/migration obligations relevant to this release |

Do not mix unrelated finances, appointments, other personal projects, or general Obus feature requests into Operator release acceptance merely because they appear in the same sidebar.

## Implemented versus still unproven

The local integration document reports implemented shared `/play` and `/activity` screens, Discord/browser authentication and proxy-aware requests, deterministic game services, an authenticated private Obus adapter, a shared chronicle API/panel, durable browser-to-bot commands, consent/corrections, and portable Chronicle/Obus/membership packages. It records substantial fixture, package, build, and type/lint evidence. These are historical results, not fresh runs in this recovery task.

The migration checkpoint reports matching ordinary Operator/Davy contents and working-tree status, restored package links, verified Voice/TV copies and immutable game packages, four consistent SQLite backups with restore smoke checks, and 69 focused migration-related Node checks. It explicitly does not certify the full game.

The latest consumer compatibility checkpoint is 16 failing / 4 passing isolated tests in `raphael-council/host/acceptance/obus_contract.py`. Backend PATCH/runtime response corrections were staged before migration, with no live restart claimed. Remaining recorded issues include Host-prefixed HMAC headers, runtime effective policy/requirements/counts, master policy/CAS and lease ownership, durable receipt-only STT replay, runtime fencing, and the 6000-character transcript contract. Preserve the frozen consumer harness; do not weaken it to match defects.

Current source-stage policy is strict local processing, external export off, and Codex off. Local-plus-free is the intended later default, not proof of present route readiness. Earlier synthetic inference predates the current host-generation lifecycle. Local STT provisioning was reported, but the newest documented capability snapshot still says `route_ready:false`. Fresh generation, real voice, semantic retrieval, eligible free routes, full bot composition, and multi-player acceptance remain open.

The storyboard task previously reported all 30 presentation slides complete. Its adaptive music request was interrupted during rendering/integration. Preserve existing outputs and establish what is actually present before generating replacements.

Two wider-test issues were reported in the coordinator's last update: a privacy assertion possibly matching button IDs, and Greyharbor content validation failure. These are investigation leads, not independently confirmed diagnoses in this recovery.

## Why the restart workflow did not resume the project

`Open-LocalOperator.cmd` runs `codex.exe app` against the Projects folder. It neither processes the supplied `continue` argument nor resumes an archived task. Merely opening that folder did not change this task's working directory.

The last observed desktop project list and the current task environment still point to OneDrive. Earlier supported backend root updates used different project IDs from the desktop's legacy records. Do not directly rewrite Codex databases/global-state JSON or relax trust/reviewer settings to hide this discrepancy.

Gortex has a local repository named `operator-local`. A supported cross-project symbol query resolves `createGameHttp` into Projects, and `read.file` with `operator-local/raphael-council/OBUS_INTEGRATION.md` successfully reads the local copy. Selecting `operator-local` as an active project failed; a raw absolute-path task filter was rejected. Use supported repo-prefixed operations and explicit local working directories. Do not restart the daemon or read indexed source through shell fallbacks.

Large historical task retrieval calls were interrupted repeatedly. Their cause has not been established. Use one small page at a time, exclude tool outputs, extract only user requests, accepted plans and final handoffs, and persist progress after each bounded result. Do not repeatedly load entire execution histories or infer an application crash cause from an aborted tool call.

## Ordered goal list

A goal is complete only when its acceptance evidence is recorded. `Pending` includes partially implemented work whose full acceptance is open. Independent goals may proceed while a live acceptance requirement is unavailable.

| ID | Status | Goal and next concrete action | Depends on | Completion evidence |
|---|---|---|---|---|
| R01 | In progress | Persist this recovery plan and fill remaining requirements from small archived-task pages | None | Every relevant task has scope, source, current state, and disposition; no interrupted request silently dropped |
| R02 | In progress | Reconnect desktop project/task records to approved local roots through supported app operations | R01 | Backend binding receipt and local Gortex resolution are proven; native desktop project listing still points to OneDrive and needs supported correction |
| R03 | In progress | Audit active launch/config/package paths and finish local dependency checks; deployment scripts and project asset references have been localized | R01 | Remaining active references audited and syntax/dependency checks recorded; archives/historical text distinguished from runtime references |
| R04 | In progress | Reconcile fresh source/local/backup evidence and preserve all unique work/history | R01 | Fresh local scan is clean; source comparison has classified differences and requires final manifest reconciliation before retirement |
| R05 | Pending | Resolve paired worktree metadata and preserve inaccessible cache directories | R04 | Honest worktree status; 18 inaccessible caches retained or independently backed up without fabricating Git metadata |
| R06 | Pending | Hand off the standalone OneDrive Obus executable safely to its local copy | R03 | Process identity, saved state, local launch and health established without duplicate user-owned runtimes |
| R07 | Pending | Retire only the identified project originals from OneDrive after local acceptance | R02,R03,R04,R05,R06 | Bounded source retirement receipt; backups local; no active process/task rooted in retired paths; cloud and recycle-bin state separately established |
| A01 | Complete | Reproduced and repaired frozen Obus consumer failures in canonical backend | R01 (sufficient integration evidence recovered) | Unchanged consumer suite 20/20 PASS; backend regressions 26/26 PASS; see execution log; no live activation claimed |
| A02 | Pending | Establish shared host-generation authority and finish GM runtime-policy payloads | A01 | HMAC/CAS/replay/lease/disable/restart fencing proven; stale requests cannot dispatch or spend resources |
| A03 | Pending | Verify actual strict-local generation through the game adapter | A02 | Synthetic request under a current authenticated host generation records true local provenance and bounded output |
| A04 | Pending | Finish scoped local STT activation and benchmark | A02 | Actual Davy audio, attribution, capture epoch, consent withdrawal, restart/replay and measured performance pass |
| A05 | Pending | Complete campaign source synchronization, correction invalidation and local embeddings | A02 | Cross-campaign/GM/private data excluded before retrieval; sources update correctly; reproducible quality/performance evidence |
| A06 | Pending | Enable only verified free routes and optional tool-free Codex escalation | A03,A05 | Unknown-cost/paid/nested routes excluded; default-off/restart-off/cancel/provenance/consent tests pass |
| D01 | Pending | Complete existing Davy gateway composition using immutable portable packages | A01 | Existing commands preserved; one gateway; correct private acknowledgements; current membership; shared voice/music ownership |
| D02 | Pending | Finish read-aloud/scene/report controls and uncertain-send reconciliation | D01 | Private drafts stay private; durable delivery receipts, bounded retries, corrections and post-session edits verified |
| D03 | Pending | Prove Discord/browser interchangeability under the actual Activity proxy | D01 | Two players can switch interfaces with identical authorized revisions and receipts; revocation/stale/retry behavior passes |
| T01 Tactical reach and image snapshot behavior - VERIFIED: canonical local selected Node tests passed (exit 0). | Recover tactical support matrix and fix reproduced content/privacy regressions; distance/reach inquiry behavior is now recovered from archived requirements | R01 | Greyharbor validation and privacy checks pass for the right behavior; original accepted mechanics accounted for |
| T02 | Pending | Complete versioned mechanics, reactions, movement and persistent effects | T01 | Independent fixtures; pending reaction survives restart; unsupported mechanics reject before resource use |
| W01 | Pending | Complete mission/world consequences, council/counsel, debrief and downtime | T02,A05 | Full mission commits consequences once, survives restart, and drives next mission; five equal votes retained |
| V01 | Pending | Reconcile campaign imagery outputs and future-choice generation workflow | R01 | Existing assets preserved; bounded authorized prompts; no hidden-state leaks; usable fallback imagery |
| V02 | Pending | Reopen and assess the 30-panel storyboard and presentation locally | R03 | All panels, role views, controls, assets, mobile presentation and print output work from local paths |
| V03 | Pending | Finish original adaptive soundtrack and game/storyboard integration | V02 | Rendered assets, provenance/terms, mood mapping, crossfade, ducking, pause and override verified without revealing secrets |
| H01 | Pending | Finish local service supervision and production entry points | R03,A02,D01 | Managed process identity; start/stop/status/restart; one bot/Obus instance; readable diagnostics; manual mode works |
| H02 | Pending | Implement coordinated game/character/chronicle/image backup and restore | H01 | Disposable restore validates a consistent checkpoint with all-or-nothing acceptance; live stores preserved |
| H03 | Pending | Configure game-only HTTPS and existing Discord application integration | H01 | Correct OAuth/Activity mappings; no private service exposure; stable endpoint available |
| Q01 | Pending | Run integrated authored-mission acceptance and independent review | D02,D03,T02,W01,V01,V03,H02,H03 | GM plus two players, mixed interfaces, voice, restart and local/free/Codex/no-AI scenarios; defects reconciled |
| Q02 | Pending | Deliver player/GM/operator instructions and final release evidence | Q01,R07 | Reproducible local installation/recovery; supported mechanics documented; no unsupported completion claims |

A01 is complete with 46 passing checks. Continue R01-R04 and A02 next. Recover one remaining requirements handoff at a time while completing the local setup. Do not wait for every optional integration or live test account before doing fixture-based implementation. R07 can occur once migration acceptance is met; it does not require waiting for the entire game release.

## OneDrive retirement boundaries

The removal request is applied to project-related source, runtime artifacts, launch references, and dependencies identified by migration records. It is not a blanket deletion of unrelated personal documents, photographs, or account contents. Keep dated rollback copies outside OneDrive. Resolve and inspect every absolute retirement target, retain unique files and history, and never recurse through saved symlink backups.

Current evidence does not prove cloud/recycle-bin removal. The prior report observed a signed-out OneDrive browser. Local source absence and actual cloud deletion must be reported separately. Existing `Finish-ProjectMove.ps1 -Finalize` is disabled; do not bypass that guard or run the rejected draft. The user has authorized continuation and project cleanup; implement a bounded, reviewable migration step with evidence rather than requiring another generic restart.

## Continuation procedure

1. Read this plan and the last execution receipt, then inspect only the next required source through Gortex.
2. Select one bounded goal slice, state its files and expected evidence, and preserve existing edits.
3. Before source mutation use Gortex impact; use signature verification if applicable; apply guarded edits and record the mutation receipt.
4. Run the relevant contract/guard/test checks. Record exact new results separately from historical results above.
5. Update status and remaining work after each completed slice. A passing subset or generated artifact never marks the full release complete.
6. If a tool is unavailable, continue other authorized work where possible and record the exact failure. Never claim a worker is running, a migration is finished, or a live test passed without tool evidence.

At creation of this record, no application source has been changed, no live Discord commands/messages have been published, and no OneDrive source has been deleted by this recovery task. This plan is the first durable recovery deliverable; implementation remains active.
