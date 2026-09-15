# Discord campaign engine integration

Status: implementation in progress. No public launch or completed integration is claimed.
Accepted plan: Design Discord camp run template, 2026-09-12.
Research: C:/Users/Hermes/Projects/DND Discord Research/2026-09-11/report.html
Player design: .planning/design/discord-campaign-run-template/player-walkthrough.html

## Approved 2D direction and current evidence (2026-09-13)

This section incorporates the user's subsequent design decisions without narrowing the full delivery requirements below. Every player-facing surface is entirely 2D, including onboarding, characters, exploration, combat, camp, inventory, journal and maps across native Discord messages, Activity, web and any retained Unity client. Three-dimensional models may be artwork references or rendered image inputs; playing never requires a 3D environment or camera. Rich mechanics and information access remain required.

One Play / Resume entry opens the authorized campaign and character; multiple valid seats require a chooser. Scene / Tactical / Dungeon remains a stable, personal, read-only view switch. Arrival prioritizes painted atmosphere; engagements prioritize legal movement and actions; puzzles and investigation prioritize readable observed facts. Players may override the suggested view. A turn change or refresh must not discard a draft or interrupt open details.

Scene art, overhead tactical layout and dungeon room vignettes must use consistent authored room geometry. The dungeon connects discovered room vignettes with stylized line-art passages. Undiscovered rooms and links are absent from images, menus, labels, alt text and attachment metadata. Private discoveries remain private; a remembered room does not expose its unseen current occupants. Looking at a map never moves a character.

Movement selection previews the engine's legal destination, path and cost; explicit Move submits one recoverable command. Read-only inspection spends nothing. Checks, puzzle attempts, rest, item use and advancement follow their actual authority and resource rules. Pending requests stay visibly pending; ambiguous network outcomes resolve the existing request rather than resubmitting it. Camp must distinguish choosing a rest, requesting it, awaiting a ruling and confirmed effects.

Use one readable image at a time with native Discord buttons/selectors and text outside the image. Verify actual phone rendering, keyboard navigation, non-color status cues and image-failure fallbacks. No essential action requires pixel hunting, hover, a tiny map label or an external browser. Human-GM and private AI-DM modes, with live and asynchronous participation, retain the same rules and player-owned decisions.

Design references only: `C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/2d-design/saltglass-2d-hybrid-design-v1.pdf` and the four-state camp concept `C:/Users/Hermes/.codex/generated_images/01a093b5-34c6-7643-b0e2-ab54b8df52a2/exec-765ff115-e434-4e66-b428-f363949e66bd.png`. Neither establishes implemented controls or Discord compatibility.

Verified resume slice: `HollowLanternBootstrap` now resolves an omitted campaign from loaded state and exposes the chosen CampaignId; the existing local GM diagnostic view uses that identity. Unity 2021.3.14f1 compiled the canonical `RPG-Core/station` project and passed both `HollowLanternPlayModeTests` tests, covering default/custom saved Saltglass resume with unchanged save bytes and the existing command/restart/replay flow. Evidence: `C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/unity-resume/results-v2.xml` and `editor-v2.log`. This does not validate the existing 3D diagnostic renderer as a 2D client. The running Unity 6 editor was observed on the separate `C:/Users/Hermes/Projects/Operator-Unity6/station` project; these changes are not proven integrated there.

The Gortex post-edit detect operation subsequently ran successfully on 2026-09-13, but its result covers a truncated set of tracked unstaged files and does not prove coverage of the Unity source. Targeted signature verification passed; guards reported none, contract allowed the change, and graph test mapping found no targets. The actual Unity results above provide runtime evidence for this slice only.

## Non-negotiable constraints

- Separate human_gm and ai_dm modes; live and asynchronous participation in either.
- No new spending; free personal noncommercial public beta on existing hardware.
- Gameplay inference uses private providers through an enforced Obus allowlist. No cloud/Codex fallback.
- C# authority commits rules and resources. Discord, browser and Unity consume authorized projections.
- Preserve GmId, old command fingerprints, committed receipts, existing campaigns and unresolved player choices.
- Only authenticated web/API ingress becomes public; development services remain private.
- All project and game data remain outside OneDrive.

## Delivery requirements and proof

| ID | Requirement | Required evidence | Current status |
| --- | --- | --- | --- |
| BASE-01 | Preserve current source/config and prove recovery | Snapshot manifest, restore comparison, baseline test output | Pending |
| ENG-01 | Persist directorMode, authorityEpoch and scoped AI identity | Save/reload and legacy-save tests | In progress |
| ENG-02 | Atomic handoff with fixed human owner | Mode race, paused transition and stale epoch tests | In progress |
| ENG-03 | Preserve receipts and pending choices | Old replay, collision, resource-once and unresolved-choice tests | In progress |
| ENG-04 | Consistent authorization at all three engine gates | AI capability and forbidden admin/player-action tests | In progress |
| APP-01 | Authenticated campaign registry with isolated stores | Two-campaign isolation and restart tests | Pending |
| APP-02 | Recoverable presentation events | Commit/crash/replay tests across adapters | Pending |
| RUN-01 | Versioned Saltglass run template and rules pack | Complete human-GM run, valid character and advancement checks | Pending |
| UX-01 | Functional 34 original plus 11 added states, entirely 2D | Desktop/mobile/keyboard walkthrough evidence for every state | Pending |
| UX-02 | One Play / Resume entry and stable Scene / Tactical / Dungeon views | Correct seat selection; read-only view changes; draft preservation; arrival, engagement and investigation walkthroughs | Approved design; implementation pending |
| UX-03 | Consistent room art, tactical geometry and discovered dungeon map | Cross-view geometry comparison; hidden-node/link non-disclosure in images and metadata; private/shared knowledge and save/reload tests | Approved design; implementation pending |
| UX-04 | Fast actions, clear checks and complete camp/character mechanics | Legal movement preview and exactly-once commit; stale/unknown-result recovery; actual rest, items and advancement; phone, keyboard and missing-image checks | Approved design; full verification pending |
| AI-01 | Private structured Obus gameplay adapter | Provider allowlist, engine validation and network-boundary tests | Pending |
| AI-02 | One-worker fair queue, cancellation and handoff | Two-table scheduling, timeout, stale completion and restart tests | Pending |
| AI-03 | Scoped knowledge and memory | Secret, cross-campaign and shared-memory isolation tests | Pending |
| VOICE-01 | Consent, transcription review and interruption | Real Discord voice session under current voice requirements | Pending |
| DESIGN-01 | Native Figma draft/components/45 states/mobile layouts | Created file URL, inspected editable nodes and requirement mappings | Blocked: create_new_file rejects exact whoami plan key |
| UNITY-01 | Entirely 2D client using the same engine contract and audience filtering | Replace 3D diagnostic rendering and launch composition; command/projection parity and real 2D client session | Saved-campaign resume verified; 2D client pending |
| UNITY-02 | Separate Unity 6.3 LTS migration | Compatible packages, baseline parity, original-save recovery | Pending |
| TOOLS-01 | Citadel requirements and delivery gates | This ledger plus implementation evidence and harness linkage | In progress |
| TOOLS-02 | Coordinator ownership | Current active board and exact task claims at each edit boundary | Used for bounded edits; inspect current board instead of relying on historical revisions |
| TOOLS-03 | Gortex guarded changes | Impact, physical edit receipt, detect/tests/guards/contract output | In progress |
| TOOLS-04 | Obus/Hermes development boundaries | Integration check without public campaign secrets in shared memory | Pending |
| TOOLS-05 | Reuse Chronos Governor | Verified single governor recurrence and no duplicate worker schedules | Pending |
| TOOLS-06 | Official compatible software/plugin updates | Before/after version matrix and smoke checks; no cache patching | Pending |
| RESEARCH-01 | Dated source/version ledger | Verify Discord, licensing, models and deployment at release gates | Existing report; release refresh pending |
| BETA-01 | Free HTTPS public web/API with private backends | Verified eligible Funnel configuration, OAuth and permissions | Pending |
| BETA-02 | Conservative capacity limits | Two tables, six players/table, one inference worker; load evidence | Pending |
| BETA-03 | Export/delete and recovery | Verified export, deletion, restore and minimal-log checks | Pending |
| ACCEPT-01 | Full real sessions in both director modes | Exploration, ruling, encounter, camp, recap, restart and handoff | Pending |

## Engine interface decisions

`gm_director_mode` is human-owner-only. Payload: `mode` (`human_gm` or `ai_dm`) and `aiDirectorId` when delegating. Persisted authority epoch changes atomically with delegation. AI commands carry top-level integer `authorityEpoch`. Human legacy requests retain their existing fingerprint shape. Previously committed receipts remain replayable after mode changes. Newly dispatched commands from a stale AI epoch fail. Pending player choices survive handoff and remain controlled by their player.

New campaigns will pin a validated rules/content version; existing campaigns must not silently migrate rules. Public campaign selection must resolve authenticated membership before a per-campaign runtime is constructed. Presentation retries must never repeat authority commits.

## Verified implementation checkpoints

- CHECKPOINT-2026-09-12-AI-RUNTIME.md records the engine authority and initial private AI runtime slice, including prior C# and Discord/service checks.
- CHECKPOINT-2026-09-12-DURABLE-RECOVERY.md supersedes its memory-only recovery limitation: private SQLite restart recovery and optional text-only AI DM passed a final combined 76 Node tests. Graph postchecks were incomplete because indexing timed out.
- CHECKPOINT-2026-09-12-PLAYER-RECOVERY.md records the authenticated campaign registry and human recovery route/UI. Local browser evidence covers resolving campaign A while remaining at campaign B; two live engine stores and public multiplayer acceptance remain unproven.
- The engine now uses authoritative WAL state and durable command fences for explicit unknown-command resolution. Automatic backup rollback is no longer the recovery design. Full engine recovery tests and actual engine-to-Node committed/cancelled wire checks are recorded in the player recovery checkpoint. Long-running journal performance and compaction remain open.
- CHECKPOINT-2026-09-12-AI-RECOVERY.md records isolated-browser resolution, durable director recovery, and the native Discord private GM recovery control. Davy Jones already owns the campaign AI; its existing startup is now deduplicated and its shutdown drains any late-created controller. A real adapter was exercised through the gateway registration with a synthetic AI instance: 23 gateway tests and 38 adapter/director tests passed. This does not establish a live Discord session.
- Historical Coordinator claim revision 25 was used for the earlier engine work; it is not evidence of current ownership. The later bounded Unity resume claim was completed and released after its tests passed. The completed Davy gateway wiring claim was released. Obus source was two commits ahead and zero behind upstream; no source pull was required. The managed private service on port 38176 was checked ready. Neither fact proves all named desktop applications are updated.
- RUN-01 and UX-01 remain unverified. The player walkthrough explicitly labels character sheets, rolls, rewards and checkpoint outcomes as illustrative. Functional template pinning, complete human-GM play, advancement, and every desktop/mobile/keyboard state require separate executable evidence.

These checkpoints refine the table's broad status entries; unverified requirements remain open.

## Delivery order

Baseline/recovery -> engine authority -> campaign isolation -> human-GM run -> private AI-DM -> full experience/voice/design/Unity -> public beta and completion audit. Every implementation phase requires focused tests and no new baseline regressions. Documentation or a narrow passing suite cannot mark the whole objective complete.

## Current external evidence

- 2026-09-12: Figma whoami reports one Starter plan with View seat. Creating the approved new draft with its exact returned key failed `INVALID_ARGUMENT: Invalid planKey`. No draft exists from this attempt. This is an integration response, not proof a paid seat is required.
- Working checkout has extensive pre-existing modified and untracked source. Preserve it; no broad stage, reset, cleanup, branch switch or overwrite.
- The old broad readiness claim was released only after exact native task evidence showed it interrupted. Inspect the current Coordinator board before each new edit boundary; historical claims in this document do not reserve files.

## Completion rule

Keep the goal active until every requirement above has authoritative current evidence. Record failures and limitations honestly. Do not count mockups as functioning gameplay or local checks as proof of public multiplayer readiness.
