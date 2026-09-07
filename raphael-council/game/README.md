# Tactical engine foundation

This is an implementation stage of `RAPH_TACTICAL_IMPLEMENTATION_PLAN.md`. It is not yet the complete multiplayer product. `GameStore` provides a shared local SQLite authority for explicit combat profiles, member authorization, canonical request fingerprints, saved dice/results, immutable events, and revision-specific projection snapshots in a transactional outbox. The `/play` browser route, authenticated `/api/game` endpoints and private Discord adventure controls now use this store. The bot also refreshes subscribed private map responses through a bounded delivery worker.

The geometry module uses regular octagons with square fillers, eight logical directions and five feet per step as an explicit house policy. Difficult terrain doubles movement cost. Full token footprints and blocked-corner checks constrain paths. Line of sight uses a conservative cell supercover. Player projections remove hidden actors/terrain/effects and opponent statistics; raw events and outbox snapshots are host-only data. `renderTacticalMap` turns an authorized projection into a precise PNG, independently of image generation.

Supported kernel commands: `move`, `attack`, `end_turn`, `pause`, `resume`. Seeded combat hazards trigger on entry, start of turn or end of turn, at most once per actor/turn, and expire at an absolute global turn ordinal. Lethal entry damage stops the remaining route; lethal incoming turn effects skip defeated actors or complete the encounter within the saved receipt. A weapon profile calculates ability modifier from its supplied score, conditionally adds proficiency and equipment bonus, and records attack and damage dice. Critical/natural-one behavior is explicit. This kernel is versioned `raph-explicit-combat-v1`; it is not complete D&D 2024 rules. Unknown command fields fail before mutation.

Reviewed noncombat missions use `exploration`. Authorized living actors can move outside initiative through a visible, collision-checked path of at most 24 steps; zero speed still prevents movement. Exploration does not consume combat budgets or advance combat turns. Enter hazards apply on boundary crossings, while combat duration anchors remain retained without ticking. Attacks and end-turn commands are unavailable. Pause stores the prior phase; the current host resumes that phase, including when no NPC is available. Old paused records without a saved phase retain combat compatibility.

The host bootstrap bridge reads approved 2024 importer records, checks the expected revision and derives name, HP, AC, speed, proficiency and attack ability from those records. It retains a snapshot digest in `characterVersion`. It refuses unsupported existing temporary HP, conditions and spent spell slots rather than discarding them. Raw `GameStore.createCampaign` remains a trusted low-level entry used by tests and must not be exposed to players. Gameplay commands receive a previously authenticated `{campaign, owner}` scope and recheck membership. Never populate that scope from player-supplied request-body IDs. The host can control NPCs, not another player's hero through normal action commands.

Run `npm run test:game`. Tests cover restart/idempotency, multiple database connections, roll breakdowns, invalid actions, resource use, movement/LOS, token footprints, lethal hazards, expiration, privacy, pause, and PNG dimensions/signature. They are not evidence of live Discord, real simultaneous-process contention, a migrated production database, full rules coverage or rendered visual fidelity.

## Verified kernel baseline and remaining rules

Current source and tests were reconciled on September 6, 2026. This matrix describes implemented contracts, not a full rules or deployment certificate. Detailed integration evidence is in [the engine audit](../research/engine-companion-audit-2026-09-06.md).

| Contract | Current behavior and evidence | Remaining limit |
| --- | --- | --- |
| Movement and range | `store.mjs`, `reach.mjs`, grid/reach/exploration tests: explicit five-foot neighbors, difficult terrain, footprints, occupied cells, visibility and blocked corners; read-only range/route estimates | No automatic flight, elevation, jumping, forced movement or opportunity attacks. |
| Attacks | Explicit approved ability/proficiency/equipment and dice fields; action cost, saved critical/natural-one results, range/LOS, atomic retries in store tests | No general weapon-property, spell or class-feature engine; melee/ranged identity must not be guessed from distance alone. |
| Reviewed checks and saves | `checks.mjs` and checks tests: pinned approved fields, proficiency/expertise, advantage/disadvantage cancellation, raw/kept/discarded dice, total, private history and declared action cost | Checks do not establish general pending spell/hazard consequences or concentration support. |
| Initiative and resources | Reviewed seeded initiative totals, stable order, one action and current movement budget; defeated-turn progression tested | Initiative rolls, bonus actions, reaction resources and general feature/slot expenditure are not established. |
| Effects and pause | Entry/start/end damage, global-turn expiry, lethal boundaries, rollback/restart and pause freeze are tested | Actor-relative anchors, concentration, stacking rules, interruptions and time conversion need explicit supported contracts. |
| Characters | `bootstrap.test.mjs`: approved 2024 snapshot digest, required-stat validation, no healing from import, stale/forged/unsupported-condition rejection | General live resource synchronization and unsupported imported mechanics are not silently enabled. |
| Missions and world | Reviewed combat or adjudicated outcomes, explicit debrief, conditional council branches, prepared departure and scene archives; Greyharbor/recovery tests | Detailed discoveries, calendar/travel, doors/objects, obligations, NPC knowledge and later campaign content remain unfinished. |
| Clients and recovery | Both clients use shared queries/commands; private snapshots, saved roll history, bounded catch-up and game-ledger backup/replay are tested | Live two-player Discord/browser acceptance and coordinated all-store restore remain release gates. |

`game_outbox` preserves each intermediate revision rather than fabricating old maps from the latest state. Browser catch-up reads these snapshots without consuming or marking global pending rows delivered. The required combined 12-by-12 encounter with two approved characters, interruptions, both image types and a full restore is still a separate acceptance gate.

## Revision catch-up

Authenticated `GET /api/game/updates?after=REVISION` returns up to 20 ordered player projections, a `next` cursor, the current revision and `hasMore`. Each call validates current membership and projects historical snapshots for that player; raw events, private opponent statistics and full source snapshots are not returned. A caller may repeat a page without changing state or another player's progress. Cursors ahead of the campaign return a stale-state error. The store-level API allows bounded pages of at most 50.

The browser keeps its live board current and reads revision pages during polling. Its Saved map updates viewer retains the last 100 received frames, including movement steps, hazard damage and effect removal, with a read-only octagonal map and text positions/HP/effects. The first join begins at the current revision; a temporary connection loss in the same mounted tab resumes from its last cursor. Reloading or disconnecting starts a new baseline. No private map history is written to browser storage. This viewer does not yet animate movement, provide a durable cross-device cursor or prove live multiplayer delivery. Discord uses the separate private-board worker described below.

## Private Discord map updates

Opening Tactical table, refreshing its map or completing a confirmed action binds the newest private board for that player. While the bot runs, `discord/board-delivery.mjs` checks for newer committed campaign revisions every two seconds. It rechecks current Discord membership/roster and game membership, then edits only that player's original private interaction response. Rapid changes coalesce into the latest map; the browser revision feed retains individual steps.

Updates last 14 minutes from the originating interaction. Use Refresh map or reopen Tactical table to renew. This leaves margin under Discord's documented [15-minute interaction token lifetime](https://docs.discord.com/developers/interactions/receiving-and-responding). No public board or unsolicited channel post is created.

The game database retains the delivered revision, retry timing, claim and an AES-GCM encrypted response credential. The encryption key derives from the host bot secret with a separate purpose label; the secret is not stored in the game database. Restarting with the same host secret can resume still-valid responses. Rotating the bot secret requires players to reopen their boards. Expired bindings are removed.

Workers claim responses before delivery, back off after transient failures and retry edits without issuing a game command. Replacement bindings prevent an old in-flight authorization from updating a newly opened board. Delayed transport completion after a claim expires schedules convergence again; Discord does not offer a compare-and-set revision guard, so external writes are not claimed to be exactly once. The host waits for active delivery before closing its transport and database.

Tests cover another player's movement update, hidden-stat filtering, expired/revoked access, competing claims, replaced cards, encrypted persistence and recovery after an ambiguous delivery failure. Actual Discord rate-limit behavior and a live two-player session remain release checks.

## Local browser setup steps

1. Approve real player sheets through the existing character desk. Keep the same `RAPHAEL_DATA_DIR` as the importer.
2. Copy `game/encounter.example.json` to a private host file. Replace example member IDs, expected character revisions, positions, initiative totals and weapon mechanics with the reviewed campaign values. Set `mechanicsConfirmed` to true only after review. The template is original fixture material, not a real campaign session.
3. Run `npm run game:host -- --seed YOUR_ENCOUNTER.json`. This creates a new campaign and refuses to overwrite an existing one. `RAPHAEL_GAME_DATA_DIR` selects its local persistent storage outside OneDrive by default.
4. Issue each member their existing private image access code using `npm run images:host -- access CAMPAIGN PLAYER`, or reuse one already issued to that same campaign/player. Never put codes in shared channels. Both services must share the configured image data directory. The code grants a game session only if game membership also exists.
5. Run `npm run dev:game`, then open `/play`. Production-local commands are `npm run build:game` and `npm run start:game`. Enter the private code once in the tactical table. Maps, reach questions and illustrations on this page share that game session. Reading or requesting an illustration refreshes its context from the current authorized game projection.

## Tactical illustration bridge

`game/image-scene.mjs` builds private image scene records from `game.view`, including visible actor positions and effect zones. The shared image runtime uses this resolver for both browser and Discord requests. Campaigns with no tactical state keep their host-authored scene flow. A tactical campaign with missing membership fails closed instead of falling back to party art.

Scene reads, image requests, status reads and image retrieval refresh this context on demand; no paid generation is triggered merely by moving. Identical publications reuse the existing image revision. A lower game revision cannot overwrite a newer publication. Existing request IDs continue to resolve their original jobs, which are labeled stale after the game changes. This bridge never advances game time, spends a resource or changes a token.

Generated-image requests use the scoped Obus game-agent route. Current integration evidence reports that agent has no implemented image capability; approved stored art and deterministic maps remain usable, with no direct-provider fallback. A working text agent does not prove image readiness.

Descriptions contain only bounded observable positions and effects. They do not yet carry authored terrain descriptions, approved appearance mappings or scene reference art. The subject selector exposes at most 20 visible actors; oversized descriptions fall back to an explicitly limited context. Precise deterministic tactical maps remain the spatial authority. Proactive per-event publication and richer approved appearance/scene data remain implementation work.

The tactical page uses `/api/game/scene-images`, its private job-status route and its private PNG route with the existing `raph_game_access` cookie. Every route rechecks game membership. The image panel resets when the table connection/campaign changes, and no second login is shown. The standalone council image panel retains its original image session for image-only campaigns; that cookie cannot authorize tactical image routes.

Game access uses an HttpOnly, SameSite=Strict cookie scoped to `/api/game`; the existing image cookie is unchanged. Connect/disconnect and actions enforce matching Origin, bounded JSON and authenticated ownership. Revoking the existing code also invalidates game reads/actions on their next request. Map PNGs require the current revision and private authentication; stale requests return a refresh response. Action retries reuse the original request identifier; the saved receipt is returned instead of rolling again.

**Distance and reach:** the browser's **How far? Can I reach it?** control and Discord's **Distance & reach** control use `game/reach.mjs`. Authenticated GET/POST `/api/game/reach` and `/api/scene-images/reach` expose only owned-character and visible-target choices, then measure a revision-bound target or coordinate. The service reads `game.view` and never calls `command`, loads hidden state or rolls dice. Its movement estimate uses the same step/footprint rules as the kernel, confined to known visible cells. It reports weapon range separately from line of sight and current action availability. Outside-turn combat questions compare with normal speed for a future turn. Exploration reports known-route distance without a combat budget and distinguishes potential reach from whether movement is allowed now. Paused questions never resume play. See [the player flow and limits](../images/README.md#distance-and-reach-questions).

## Source-cited campaign journal

The journal below records tactical observations. Mission consequences use the separate reviewed workflow described next.

## Mission outcomes and debrief

The host can attach one reviewed mission to an existing encounter with `npm run game:mission -- --file PRIVATE_MISSION.json`. Start from `game/mission.example.json`, replace its campaign/host/map IDs and review the public briefing, success team, outcome summaries and track deltas. The example defaults to `reviewed: false`. Existing mission records cannot be replaced, and configuration after encounter completion is rejected.

The explicit combat mission policy treats exactly one remaining living team matching the reviewed success team as success; other completed combat outcomes use the reviewed failure branch. Reviewed `resolution: adjudicated` missions instead enter exploration and expose configured outcomes only to the host. The host privately reviews their summaries and track changes, then confirms one outcome with exact game/world revisions and a stable request ID. Browser Host mission review and Discord Mission desk -> Full mission record -> Review mission outcomes use `/api/game/adjudication` and the same service. Only the chosen result enters player views. Civic decisions, negotiations and other noncombat outcomes are not inferred from casualties.

Changes to reviewed location, faction, readiness, relationship and attention tracks and their source-cited world event commit in the same transaction as mission resolution. Values clamp to 0–100 and record actual before/after values. The mission then awaits a debrief. `/api/game/world` exposes public mission state and accepts bounded shared debrief notes from a current campaign member. Notes never become mechanical deltas or narrator instructions. Duplicate requests return saved world receipts. The `/play` panel displays the briefing, tracks, outcome and debrief. Unresolved outcome plans stay server-side.

These world tables share the game database and its backup checks. Adjudication receipts validate game and world revisions separately and retain exact replay after restore. Reviewed content connects missions through council choice and prepared departure; scene archives preserve tested casualties and HP on return. Pack installation requires the current root mission to match the already reviewed private plan. The Greyharbor pack remains a host review proposal. General objective predicates, private tracks, automatic rewards, discovery/calendar semantics and later authored content remain unfinished. `/` and `/play` now use the same authoritative Play component; old localStorage fiction is neither imported nor treated as game history.

## Source-cited journal behavior

## Raphael's Counsel

The live mission panel now provides three counsel requests per linked mission, shared across campaign members. Its deterministic fallback reflects on visible surroundings, controlled-character readiness or the public mission record, cites game/world revisions and leaves the decision unresolved. No AI provider or dice roll is involved. Unknown fields, stale revisions and unlinked missions are rejected before spending budget.

`counsel_records` stores each player's private advice and evidence in the game database. Identical request retries return the same record without spending another request. The shared budget and saved advice survive restart and backup/restore; asking, reading or retrying counsel changes no tactical resources, clocks or world track. Advice to another player is excluded from the history response. The `/api/game/counsel` routes use the game session and current membership.

This is the bounded deterministic guidance fallback. Discord counsel controls and the five-member equal-vote mission council use the shared services. Earned-clue expansion and richer model-backed guidance still require current evidence and integration. The topic selector is explicit; the system does not pretend to understand arbitrary questions or provide an optimal move.

## Journal details

## Persistent mission council

After a linked mission's debrief, the host can run `npm run game:council -- --file PRIVATE_COUNCIL.json`. Use `game/council.example.json` as a review-disabled template. Supply the completed world's revision, two to five original branches, their public costs, known track IDs, citations to the ten most recent public world events and reviewed 0–3 ratings for all five mandates.

The offline council uses five named deterministic personas with equal weight. Each branch score is its authored mandate rating times ten plus linked public-track pressure for that persona's matching track kind. The policy is transparent in the saved assessments. Confidence is a fixed limited-input marker (0.5), not a calibrated probability. These are not five live model-provider calls. Memory/party mandates currently use their reviewed ratings; richer memory and preference interpretation remain future work.

All five members use the same bounded public-world packet, saved with a hash, assessments, evidence, scores and totals. No private tactical state, unresolved outcome plan or private counsel history enters that packet. Only a genuine top-score tie invokes round-based rotation; otherwise the highest total leads. Preparing/voting changes no world track, gameplay state or counsel budget.

The live mission panel displays every branch and assessment. A current member explicitly confirms the party's branch through `/api/game/council`; a saved receipt makes retries repeat-safe. The choice and a world event commit together, recording `nextMission.status = selected-awaiting-scene`. The party may choose an alternative to the council lead. Selection does not launch an encounter, spend fictional costs or claim that the new mission has occurred. The host can prepare the reviewed destination; explicit whole-party departure then commits scene transition and mission activation together. Installed content can select different successors from the saved adjudicated outcome.

This implements the researched shared-session/contribution-preservation pattern in Raph's local service and keeps personas separate from future model routing. No external agents-council/OccultBus bridge is invoked. The browser root now uses the shared campaign screen; it does not resolve a separate localStorage council.

## Observation journal implementation

`game/narration.mjs` is the deterministic narration fallback for recorded tactical observations. `GameStore.journal` compares authorized revision snapshots and includes only the requesting player's saved roll receipts. The authenticated `/api/game/journal?after=REVISION` endpoint pages through those observations; `/play` displays the latest 100 entries and their source revisions.

The journal records movement, visible arrivals/departures, owned HP changes, visible effect changes, turn/phase changes and personal attack roll breakdowns. Losing sight of an actor or effect is described only as leaving the visible view, not death or expiry. Entries with no observable facts are omitted while the revision cursor still advances. Reads are repeatable and change no game state. Recovery tests reproduce the same journal from a restored ledger.

This supplies grounded tactical observations alongside the mission/world/council services. Journal reads do not commit objectives, track changes, rewards, debriefs or council decisions; those remain explicit authoritative commands. No AI provider is required for these observations, and no generated prose can mutate state.

## Game ledger backup and recovery commands

Run these host commands from `raphael-council`. The parent of each output directory must exist; the output directory itself must be new.

```powershell
npm run game:backup -- backup --output C:\RaphBackups\session-001
npm run game:backup -- verify --source C:\RaphBackups\session-001
npm run game:backup -- restore --source C:\RaphBackups\session-001 --output C:\RaphRecovery\session-001
```

Backup defaults to the configured game database; `backup --source PATH_TO_GAME_SQLITE` selects another source. It uses SQLite's consistent snapshot operation while the source may remain open. Verification checks the SHA-256 digest, SQLite integrity, supported schema, contiguous event/projection revisions, final projection/state agreement and receipt revision references. A manifest is written last; partial outputs cannot pass verification. The digest detects accidental changes, not malicious replacement of both the database and manifest. Keep these private host files protected like the original game database.

Restore copies into a new data directory and verifies that copy. It never replaces or switches a running host. Before adopting a recovered directory, stop both browser and Discord hosts, compare its recorded campaign revisions against the expected recovery point, and set `RAPHAEL_GAME_DATA_DIR` to the reviewed directory. Use one host configuration consistently; do not run original and recovered campaigns as independent authorities.

This tool backs up the **game database**: game state, events, command receipts, controls, revision snapshots and its linked mission/world records. It does not back up character imports, image jobs/access codes or art. Receipts existing at the backup point remain repeat-safe; actions committed afterward are absent and must not be silently replayed. Restoring an older game ledger alongside a newer image database also requires reconciliation of scene revision guards before play resumes. A coordinated multi-store recovery/reconciliation workflow and production restore drill remain release requirements.

The initial schema is version 1. Newer unknown schemas fail closed. Before any real campaign data is used, migrations must be backed up and independently validated. Existing character/image databases are untouched. Use disposable fixture databases while this kernel is being integrated.
