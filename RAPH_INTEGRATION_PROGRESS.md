# Raph integration evidence and remaining delivery

Updated 2026-09-06. The full objective remains active. This record is a checkpoint, not a completion claim.

## Verified progress

- The prior goal-related turn created `RAPH_TACTICAL_IMPLEMENTATION_PLAN.md`: classified as progress because it changed the authoritative project plan. The present turn re-inspected the current files before relying on it.
- Inspected Awesome D&D's current README and SgtSlummy's public repository inventory through agent-reach's GitHub CLI route. Reviewed `agents-council`, `occultbus`, and `design-extract` documentation; inspected the latter's crawler/programmatic API and package configuration.
- Added the evidence-based catalog at `raphael-council/research/references.json`. README architecture claims are labeled as such, not live integration results. The catalog is developer research and is not an auto-imported rules corpus.
- Installed `SgtSlummy/design-extract` at commit `f9e0c4770a78b3d99733b77e097da9d13b029aef` under the user's `.agent-reach/tools/design-extract`, retaining MIT LICENSE. Locked dependencies installed with scripts disabled. Existing system Chrome is used in an isolated context.
- Added the reusable skill `.codex/skills/raph-design-extract`, with a bounded API wrapper, workflow reference, host metadata, eight behavioral scenario families and seven passing deterministic checks. Agent behavioral holdout evaluation remains unrun; no maturity claim is made.
- Used the skill on the supplied Forge URL. The API extraction succeeded with coverage `access_gate`: final page `https://thewargodaries.forge-vtt.com/join`, title Faerun, Join Game Session heading, two password fields, 95 elements, zero canvases at 1280x800. It produced token/CSS/Figma/markdown artifacts and SHA-256 evidence under `.agent-reach/evidence/raph/forge-api-2026-09-06`. The actual game board remains unobserved.
- The upstream CLI's preceding run failed after writing partial outputs; those artifacts remain separately labeled and are not the successful API evidence.
- Added local reviewed-data curation for SFT/DPO narration training, with campaign-separated evaluation and explicit rights/privacy gates. No training job or upload occurred.
- Implemented the initial tactical kernel in `raphael-council/game/store.mjs`, octagonal geometry/visibility in `maps/grid.mjs`, and precise PNG snapshots in `maps/render.mjs`. Campaign state, events, dice, command receipts and per-revision outbox snapshots commit together. The kernel remains explicitly limited to its documented mechanics and is not yet wired to Discord or the browser.
- Applied the observed amber/parchment/dark reference palette to the functional map renderer, preserving the project's visual direction without claiming the inaccessible Forge board was reconstructed.

## Verification completed in this turn

- Website skill: 7 deterministic tests passed; a real-browser smoke test passed on two controlled routes, verifying extracted known colors, gate classification and artifact hashes. Eight agent-behavior scenario families are authored; independent behavioral holdout execution is still outstanding.
- Training curation: 5 tests passed (review/rights/privacy gates, duplicate rejection, campaign-separated splits, SFT/DPO shapes).
- Tactical foundation: 15 tests passed (movement, line of sight, footprints, hazards, expiration, roll calculations, persistence, repeat receipts, visibility and PNG structure). The initial failed fixture returned 10 on a d8; it was corrected to valid die values before the passing run.
- Existing image suite: 40 tests passed.
- Existing character/Discord suite: 91 tests passed. Some image-adapter tests overlap the image suite; these counts are not distinct-feature totals.
- Lint passed for new `game`, `maps`, and `training` modules. Full-project lint fails at the existing `app/page.tsx:172` synchronous state update inside an effect. That file was not edited during this turn.
- No live Discord message, image-provider request, training job, deployment or browser-game integration was executed. No full-product build claim is made.

## Source-to-system decisions

| Source | Verified lesson or observation | Raph destination |
| --- | --- | --- |
| Awesome D&D | Resource categories distinguish maps, tokens, encounters, campaign tracking, AI GMs, VTTs and developer tools | Keep map/art, combat rules, campaign memory and transport adapters separate; verify linked sources before ingestion |
| Agents Council README | Shared session identity and participant contributions | Raph council packets and preserved equal-vote records; external bridge integration still to implement/verify |
| OccultBus README | Personas separate from provider handles; bounded retrieval | Narrator/council provider adapters and audience-filtered memory; no assumed live gateway |
| design-extract source/live run | Computed styles can be extracted while the CLI's later emitter still fails | Pinned API wrapper, coverage labels, immutable evidence, fresh output directories |
| Forge entry screen | Amber/parchment/dark colors and a join flow; no visible board | Preserve Witnesslight identity; use the tactical plan for the proposed board rather than inventing Forge's inaccessible layout |
| Ghidra skill | Requires a concrete compiled input and evidence baseline | No binary has been analyzed; no Ghidra-derived code or findings can be claimed |
| Hugging Face trainer skill | Reviewed method-compatible data and durable checkpoint saving precede useful training | Local curator first; actual model/job requires approved dataset, model, account and destination |
| Sites skill and current runtime | Existing site uses Vinext; persistent image host uses Node SQLite/filesystem/native canvas | Preserve current app; resolve complete persistent hosting before publishing multiplayer |

## Remaining full-objective requirements

1. Complete the authoritative game foundation and full tactical delivery sequence in `RAPH_TACTICAL_IMPLEMENTATION_PLAN.md` (not merely a map mockup). Initial kernel now exists; migrations/backups, concurrent-process proof, character verification and delivery workers remain.
2. Connect actual Discord commands, character profiles, browser board, rolls, effects, scene transitions, world ledger, narration and council to that engine.
3. Integrate reviewed source-derived patterns in those running components. Merely citing the catalog is insufficient.
4. Complete the website-analysis skill's deterministic/package and behavioral checks, and apply verified design findings to the appropriate Raph interface without claiming an unseen Forge board was copied.
5. Complete training readiness with actual authorized examples; assess model training only when the needed inputs exist. Do not train on scraped third-party text or invent a trained model.
6. Build and verify the complete site and persistent hosting path. The current Sites configuration has no registered project ID; no deployment was performed.
7. Run a requirement-by-requirement final audit against live/runtime evidence and the entire tactical plan before marking the goal complete.

The missing private Forge board does not prevent implementing Raph's explicitly requested mechanics. Continue with authoritative game state and octagonal geometry while preserving that reference limitation.

## Next concrete implementation step

Connect the kernel to an authenticated adventure adapter and a browser play route, with host-only campaign bootstrap from approved character versions. The existing image cookie is scoped to `/api/scene-images`; do not assume it authenticates a new `/api/game` route. Reuse the existing access-code authority through an explicit game-session boundary and recheck current game membership. Consume revision snapshots from the outbox with durable delivery receipts; keep raw event snapshots private. Replace prototype localStorage authority only after the service-backed route and migration/preview behavior are verified. Then expand the rules/effects and campaign integration rather than treating the kernel's limited mechanics as the full requested system.

## Continuation: browser and approved-character integration

The preceding turn is classified as progress: it created the tactical kernel, reference/skill artifacts and passing tests. Current files were re-inspected before this continuation.

Implemented:

- `game/runtime.mjs` shares persistent Node game storage across the new browser endpoints. `RAPHAEL_GAME_DATA_DIR` is documented in the environment template.
- `/api/game`, `/api/game/access`, `/api/game/map` provide authenticated state/receipts, commands, login/logout and revision-bound PNGs. They reuse the image access-code authority through a separate HttpOnly `/api/game` cookie and recheck game membership. Caller-supplied identity/stat overrides, foreign Origins, oversized input, stale maps, revoked codes and unknown errors are handled explicitly.
- `/play` is a service-backed tactical table: octagonal SVG board, coordinate route preview, attacks, end turn, visible actors/effects, saved personal roll breakdowns and map-image export. Latest state refreshes every two seconds and after own actions. Ambiguous network retries retain their request ID; late responses from an old login are discarded. The root council page links to it.
- `game/bootstrap.mjs` bridges approved importer records into initial player combat profiles. It checks revision/edition, takes ability/proficiency/AC/speed from the approved record, preserves runtime HP, pins a digest and rejects unsupported existing conditions/resources. `game/cli.mjs` and `encounter.example.json` make host-reviewed local setup concrete. The example deliberately defaults to unconfirmed mechanics and never starts automatically.
- Native canvas was excluded from Vite dependency optimization after the dev server exposed a binary-as-UTF8 optimization failure. The corrected server starts successfully.

Fresh validation:

- `npm run test:game`: 24 passed, including real CharacterStore approval-to-profile integration and HTTP boundary tests.
- TypeScript `--noEmit`: passed after correcting response typing and the pathfinding options declaration.
- Targeted lint for game/maps/play/API/config: passed.
- `npm run build:game`: passed on final code; all new routes present in the build.
- Actual local `/play` request returned 200. Actual unauthenticated `/api/game` request returned 401. Preview handoff was queued for `http://localhost:3000/play`.
- Retained development session: `21038`, Node local host at port 3000. Revalidate its handle before relying on it next turn; a recorded session ID alone is not liveness proof.

Limits and next action:

- No real player campaign was created, no Discord message sent, no paid image/model job launched, and no deployment performed. HTTP tests use fixture campaign state and a controlled access verifier; complete authenticated live-browser play has not been tested.
- Earlier full-project lint issue in the council page's existing save-loading effect remains; that page was changed only to add the tactical-table link.
- The council page still uses its prototype campaign state and must be connected to the authoritative world service. The new table's illustrative-image panel still uses the existing separate image session; combat-to-image publication remains to implement.
- Next implement Discord gameplay controls and durable outbox delivery so players receive each committed movement/action update, then expand rules/reactions/effects and integrate the persistent world/narrator/council. Preserve all original full-objective requirements above; browser endpoints do not establish their completion.

## Continuation: private Discord gameplay and full integration plan

- Added `discord/adventure-adapter.mjs` and wired it into the bot and entry screen. Private tactical maps, move/attack modals, route previews, explicit action confirmations, end turn and pause/resume use the persistent game engine.
- Added persistent `game_controls` bindings for campaign, owner, guild, channel and expiry. Confirmation retries use the same request ID and return the original command receipt. Copied controls, wrong channels, lost membership and stale previews are rejected.
- Five new adapter tests passed using a real fixture GameStore and a fake Discord transport. No live Discord message was sent.
- Fresh combined regression run: `node --test game/*.test.mjs maps/*.test.mjs characters/*.test.mjs discord/*.test.mjs images/*.test.mjs training/*.test.mjs` passed all 179 tests. TypeScript `--noEmit` passed. Targeted lint for the adventure adapter, tests, bot and game store passed in the preceding execution.
- Updated the tactical implementation plan with seven ordered work cards linking revision delivery, scene images, rules, effects, connected maps, world/council and persistent release verification. This is a plan checkpoint, not full objective completion.

The initiating Discord player receives a current private map after confirmation; delivery to other players from the outbox is still outstanding. Browser polling still skips intermediate revisions. The next implementation boundary remains bounded, audience-filtered revision delivery and recovery, followed by combat-to-image publication. Existing full-objective requirements remain active.

## Continuation: ordered browser revision catch-up

- Implemented `GameStore.updates` and authenticated `/api/game/updates?after=REVISION`. Pages are ordered, bounded, repeatable and filtered for the current member. They read persisted per-revision snapshots without consuming other audiences' delivery. Tests prove step/hazard ordering and catch-up after a GameStore restart.
- Connected polling to that feed and added a read-only Saved map updates viewer in `/play`. It retains 100 received snapshots and shows exact saved token positions, visible HP and effect zones. The live board remains separate. A mounted tab resumes after a temporary network interruption; reload/login intentionally establishes a current baseline. Cross-device durable cursors and animation remain unfinished.
- Fixed effect expiration snapshot ordering: remove the effect before recording its expiry revision so that the corresponding historical map no longer displays the expired zone.
- Fresh checks: 59 tests passed across game/maps and the Discord adventure adapter; targeted lint and TypeScript passed; `npm run build:game` passed and includes `/api/game/updates`. The count includes existing reach tests now present in the worktree. No live authenticated browser interaction or Discord transmission was tested in this checkpoint.
- This advances work card 1 but does not complete it: automatic Discord delivery, delivery receipts/recovery, full multiplayer verification and the subsequent image/world/rules integration remain active requirements.

## Continuation: tactical state to illustration context

- Added `game/image-scene.mjs`, deriving private image context exclusively from the authenticated game projection. Visible actor positions and lingering effect zones now feed browser and Discord illustration requests through the shared image runtime.
- Extracted the game singleton into `game/storage.mjs` so the image runtime can resolve tactical state without a circular service dependency. Existing game runtime imports remain compatible.
- Scene image reads/requests/status/image retrieval refresh tactical context on demand. Image-only campaigns retain host-authored scenes. Once tactical state exists, missing game membership denies access instead of using a party fallback.
- Identical scene publication is idempotent; a lower game revision cannot overwrite a newer one. Old image requests retain their original job and become stale after movement. No provider request or game action occurs merely from publishing context.
- Verification: 103 tests passed across game/maps/images and Discord image adapter. After adding the publication ordering guard, 24 affected store/image-service tests passed again. TypeScript and targeted lint passed. Provider execution used a local fixture, not a paid/live image service.
- Remaining: rich approved scene/appearance data, unified browser image session, proactive outbox publication, automatic Discord map delivery, full rules/world/council integration and hosted multiplayer acceptance. The full goal remains active.

## Continuation: one tactical browser session

- Added game-authenticated scene, request, job-status and PNG routes under `/api/game/scene-images`. These reuse the existing image boundary while taking identity exclusively from the trusted game authentication path and rechecking current game membership.
- `/play` now uses those routes for illustrations and hides the separate image-login/disconnect flow. Its image panel remounts when the connection/campaign changes. Standalone image-only access remains available through its original routes.
- Regression evidence: all 22 game/image HTTP boundary tests passed, including rejection of an image-only cookie on tactical routes, foreign origins, forged owner fields, revoked membership and expired access. TypeScript and targeted lint passed. No live generation or authenticated browser interaction was performed.
- Remaining full-objective work includes automatic Discord delivery, richer scene/art data, rules/effects coverage, persistent world/council integration and deployment acceptance. This is progress on the image integration card; the full goal is not complete.

## Continuation: game ledger backup and recovery

- Added `game/backup.mjs` and `npm run game:backup` with backup, verify and restore operations. Backup takes a consistent SQLite snapshot into a new directory; its manifest records a digest, schema, campaign revisions and receipt count. Verification checks database integrity and ledger consistency. Restore creates and verifies a new data directory without replacing a running host.
- Added recovery fixtures proving that an open source can be backed up and continued independently, then a restored attack receipt is returned without invoking the dice source. Existing destinations, modified files, missing projection records and unknown schemas are rejected.
- All 15 store tests passed, including these new recovery and prior illustration/revision tests. Targeted lint and TypeScript passed. Only disposable fixture databases were backed up or restored.
- The command is explicitly game-ledger-only. Coordinated character/image/world backups, recovery-point reconciliation (including newer image scene revision guards), migration orchestration and a production restore drill remain incomplete. Post-backup actions cannot be recovered from an older snapshot and are not claimed to be preserved.
- Automatic Discord map delivery and the remaining rules/world/council/release work remain active requirements. This improves the recovery gate without claiming the full goal complete.

## Continuation: automatic private Discord board delivery

- Added `discord/board-delivery.mjs` and wired it into the running bot. Opening/refreshing a board or confirming an action renews a 14-minute private update window. Polling coalesces new committed revisions into the latest private board while browser history retains intermediate steps.
- Persisted encrypted response credentials, delivered revisions, claims and retry timing in the game database. AES-GCM uses a purpose-specific key derived from the bot secret, which is not copied into the database. Active unexpired responses can resume after restart with the same secret.
- Every automatic edit rechecks Discord roster/membership and game membership. Expired/revoked bindings stop; replaced watches cannot update a newer card. Failed edits back off and never call the game command engine. Bot shutdown waits for active delivery before closing the transport/store.
- Verified Discord's interaction token lifetime and original-response edit route against its official documentation via web search and agent-reach's Jina web-page route. The 14-minute window leaves margin under the documented 15-minute lifetime.
- All 145 Discord/game/map tests passed, plus TypeScript and targeted lint. New tests cover a second player's private movement update without owner HP, encrypted persistence/restart after failure, expiry/revocation and competing/replaced watches. No live Discord connection, channel post or private message was sent.
- External edits are convergent, not claimed exactly once: a late transport completion after lease expiry schedules repair. Live rate-limit behavior, token expiry on Discord itself and an actual two-player session remain unverified. Full rules, connected world/council, rich scene art and deployment acceptance remain active requirements.

## Continuation: grounded campaign journal

- Inspected the persistent-world plan and existing council page. The council still uses prototype localStorage state; mission/debrief/faction integration is not yet implemented.
- Added deterministic observation narration in `game/narration.mjs`, a source-cited `GameStore.journal`, authenticated `/api/game/journal` and a live Campaign journal panel in `/play`. It derives entries from saved player projections and personal roll receipts, with bounded cursor pages and no state mutation.
- Narration distinguishes losing visibility from defeat/expiry, omits hidden entities and other players' private rolls, and cites the actual campaign revision. Empty observable changes advance the cursor without fabricating a story fact. The journal is a read model of the existing authoritative ledger, not a second independently mutable campaign state.
- All 25 relevant store/HTTP tests passed, including journal reconstruction after backup/restore. TypeScript, targeted lint and the production game build passed with the journal route included.
- This creates the deterministic grounded narrative input required for world/council integration. Mission objectives, connected locations, faction consequences, debriefs, bounded counsel and the real council service remain unfinished; full goal completion is not claimed.

## Continuation: reviewed mission consequences and debrief

- Added `game/world.mjs`, sharing the game database and completion transaction. Hosts link one reviewed encounter-based mission with public location/faction/readiness tracks, an explicit success team and authored success/failure consequences. Unresolved plans remain server-side.
- Encounter completion applies consequences once, records actual clamped before/after track values and a game-revision source, then opens the debrief. Failed world writes roll back encounter completion and its delivery snapshots. Member debriefs have separate world revisions and repeat-safe receipts; notes cannot specify mechanical changes.
- Added `game:mission`, a review-disabled example, authenticated `/api/game/world` reads/debrief submission, and the live Mission and consequences panel. No actual campaign mission was configured in this turn.
- Verification: 36 store/HTTP/Discord adventure tests passed initially; after adding HTTP boundaries, all 28 store/HTTP tests passed. Backup was extended to inspect world revision/receipt consistency, and all 18 store tests passed with mission/debrief recovery. TypeScript, targeted lint and the production build passed.
- The initial TypeScript check found missing response typing in the mission panel; corrected before the passing check/build. Two documentation/code patches failed to match their target context and were reapplied against current lines; they did not partially mutate files.
- This implements one reviewed encounter outcome and debrief, not arbitrary objectives or a mission chain. Connected maps, council integration, expanded rules, authored content loading and full live deployment acceptance remain unfinished.

## Continuation: persistent bounded Raphael counsel

- Added `game/counsel.mjs`, source-cited deterministic guidance for explicit surroundings/readiness/mission topics, a shared three-request mission budget and private per-player advice records in the game database. Advice uses only the authenticated view and public mission state, proposes no mechanical change and leaves uncertainty/player choice intact.
- Added authenticated `/api/game/counsel` GET/POST and Raphael's Counsel in the live mission panel. Requests bind game/world revisions and an idempotency key. Retries return the saved advice; stale/forged requests spend nothing. Other members see remaining shared budget but not private advice text.
- All 30 store/HTTP tests passed, including budget exhaustion, private evidence filtering, repeat requests and restart plus backup/restore recovery without tactical/world changes. TypeScript, targeted lint and production build passed. No AI-provider request or live campaign interaction occurred.
- This implements the deterministic counsel fallback. Learned-clue expansion, provider-backed narration, Discord counsel controls, equal-vote council deliberation, mission chains, connected maps and broader rules/deployment acceptance remain unfinished. The full goal stays active.

## Continuation: Discord mission, counsel and debrief controls

- Added `discord/world-adapter.mjs`, registered ahead of the existing companion/adventure/image/import handlers, and added Mission & counsel to the adventure desk. It uses the same game/world/counsel services as the browser, with current Discord and game membership checks.
- Private cards show mission status/tracks, explicit counsel-spending buttons and saved advice history. Counsel controls bind both game and world revisions and reuse stable request IDs, so retries neither spend another request nor generate a different answer.
- Shared debrief notes use a bounded modal followed by an explicit preview/confirmation. The preview identifies campaign sharing and escapes mentions/formatting. Confirmation retries return the saved world receipt and do not apply consequences twice.
- All 174 Discord/game tests passed, plus TypeScript and targeted lint. New cases verify private advice, copied/foreign/stale controls, debrief preview before mutation, repeated confirmations and mention escaping. No Discord login, desk publication or live message was performed.
- The existing companion adapter and character-information routes found in the current worktree were retained. Full equal-vote council deliberation, connected maps, mission chains, broader rules and deployed multiplayer verification remain unfinished.

## Continuation: persistent equal-weight mission council

- Added `game/council.mjs`: host-reviewed branches, bounded public-world evidence packet and hash, five named deterministic personas, explicit scored assessments with equal weight, totals and tie-only rotation. This concretely applies the researched shared-session/contribution-preservation pattern while keeping model/provider routing separate.
- Added host `game:council` setup, a review-disabled template, authenticated `/api/game/council` and a live Mission council panel showing alternatives and all five assessments. The common packet excludes private tactical state, future outcome plans and private counsel history.
- Player selection atomically saves a receipt, the council choice and a world event/next-mission intent. The player may select a non-leading branch; repeats cannot choose twice. Selection is explicitly `selected-awaiting-scene` and does not fake encounter activation or spend authored costs.
- All 34 council/store/HTTP tests passed, including exact vote totals, tie behavior, matching track pressure, owner/evidence checks, frozen data, explicit alternative selection and backup/restore. TypeScript, targeted lint and production build passed.
- The current deterministic policy uses reviewed mandate ratings plus public-track pressure and fixed limited confidence. It is not provider-backed deliberation; memory/preference interpretation, external bridge validation, Discord council controls, connected-scene activation, mission chains and the root prototype migration remain unfinished. Full goal completion is not claimed.

## Continuation: connected scene and mission activation

- Added `game/scenes.mjs` and trusted `npm run game:scene -- --file <reviewed-transition.json>`. A completed encounter/debrief and saved council selection now lead to a reviewed destination and mission in one transaction. Existing revision delivery exposes the new map to authorized viewers.
- Party placements accept coordinates only and carry current profiles/HP, including defeated actors. Departure archives terrain, NPC HP and area hazards. Revisits use stored scene data, reject replacement NPC/terrain input and remove zones whose global turn expiry has passed. New encounters reset round/action/movement budgets without healing.
- World mission activation preserves tracks and archives the previous public mission record. Mission IDs cannot be reused. Failed validation rolls back archive, projection and world writes; identical request retries return the original receipt.
- All 99 targeted game/map/Discord tests passed, plus TypeScript and targeted lint. New integration evidence covers unauthorized/invalid transitions, rollback, carried injury, saved casualties, effect expiry on revisit and repeat-safe backup/restore. No real campaign was transitioned and no live Discord or provider call occurred.
- Documented the host contract in `raphael-council/game/SCENES.md`. Player travel controls, authored scene loading, exploration/travel time, actor-attached effects, broader combat rules, coordinated image/character recovery and live release verification remain incomplete. The full goal remains active.

## Continuation: player-confirmed prepared departures

- Added host `game:scene -- --prepare --file ...` preparation with rollback validation and immutable saved destination documents. Preparation does not advance tactical/world state. Only the newest departure is offered; entry rechecks host authority, campaign membership and anchored revisions.
- Added authenticated GET/POST `/api/game/departure`, browser Next scene and Discord owner-bound preview/confirmation. Players submit only a departure ID and request ID. Hidden map/NPC/outcome data remains server-side. Entry moves the whole party with the existing atomic transition and records a player-owned retry receipt.
- Expanded scene integration tests for rolled-back preparation, replacement controls, public projection fields, forged HTTP payloads, cross-origin requests and repeated entry. All 92 targeted game/map/world-adapter tests passed before the additional Discord case; all six world-adapter tests passed afterward, including stolen confirmation rejection and exactly one transition. TypeScript, targeted lint and production build passed with the new route.
- No live browser/Discord session or real campaign transition occurred. Full authored campaign loading, broader rules/effects, coordinated recovery and deployment acceptance remain open. Other concurrent worktree additions, including expanded mission information and auth/AI routes, were preserved and not claimed as this turn's implementation.

## Continuation: reviewed executable campaign packs

- Added `game/content.mjs`, GameStore host methods and `game:content` install/council/departure commands. Packs link world, regions, locations, scene geometry, reviewed NPC profiles, relative hazard durations, mission consequences and council branches. Import validates references, bounded records, current party placements, mission reachability and cycles, then stores immutable private content with a hash.
- Authored branch preparation uses the current public world evidence and selected council mission. The existing prepared-departure service handles player confirmation and the atomic map/world transition. No pack endpoint exposes future geometry, NPCs or outcome plans.
- Added integration coverage for blueprint rejection, unauthorized imports, broken references, immutable installation, council selection and player entry. Scene activation coverage also checks that distance/reach rejects the old revision and works against the new saved scene. Current HTTP auth, image and reach routes were inspected and preserved.
- All 194 game/map/Discord tests passed; TypeScript, targeted lint and production build passed. Gortex became active for this workspace mid-turn and was used for subsequent source edits. Its tracked-diff detector reported no changes because these source files are untracked in Git; that is not a no-change verification. The broad contract check timed out; the focused installContent contract check returned allow.
- Host documentation is in `raphael-council/game/CONTENT.md`. Full authored Greyharbor/Behind the Veil runtime content, expedition clocks, broader combat rules, coordinated recovery and live deployment acceptance remain incomplete. No real campaign content was installed or published; fixtures only. The full goal remains active.

## Continuation: approved-stat checks and saving throws

- Added `game/checks.mjs`, host `game/check-cli.mjs`, `/api/game/checks` and browser check controls. Requests bind the exact approved 2024 character snapshot to the encounter profile, derive the numeric ability/proficiency bonuses, and require explicit host review of proficiency applicability, advantage/disadvantage sources, situational adjustments, DC and action cost.
- Resolution records raw dice, kept/discarded values, all modifiers, character version and outcome with the action receipt and map revision in one transaction. Private DCs are omitted from player responses. Stale/foreign requests and duplicate new attempts fail before resources or dice; identical retries return the saved result. Pause and action ownership remain enforced.
- Verified relevant official D20 rules through web search and agent-reach's Jina reader. Documented the supported subset and source in `game/CHECKS.md`; no complete 2024 adapter claim. Automatic skill applicability, reactions, death saves, save-triggered effects and Discord check controls remain open.
- All 39 focused check/store/HTTP tests passed, including restart, advantage cancellation, low-die selection, natural-one/twenty ordinary-check behavior, invalid RNG rollback, private requests and forged payload rejection. Targeted lint passed. Corrected missing response typings found by TypeScript; TypeScript and production build then passed.
- Gortex edits/impact checks were used. Diff detection still cannot observe these untracked Git files, and graph coverage did not discover the new tests; executable results provide the verification. No real character check or live provider/Discord request was made. Full campaign, mechanics and release work remains active.

## Continuation: departure transport acceptance and actual app route

- Coordination requested no duplicate Discord/Obus work, so this continuation added only `game/departure-http.integration.test.mjs`. Its ephemeral loopback server uses the real GameStore and game HTTP handlers, authenticates a fixture player, loads a host-prepared council departure, rejects replaced controls, enters once, refreshes world/map state and returns the same receipt on retry.
- The same transport test verifies preserved HP, stale/current reach requests, exact PNG content and revision, scene-image context and membership revocation. Teardown closes the server and database. Eleven relevant departure/council/world tests and targeted lint passed.
- Investigated the existing localhost:3000/play JSON 404: port 3000 belongs to Docker's davy-jones-live-admin-web-1 container, not the Raph app. Started the actual Raph host temporarily on free port 3417; GET /play returned 200 text/html containing tactical-table and access UI. Stopped the owned session and verified port 3417 no longer listened. The 3000 response does not prove a Raph route defect.
- This proves the real HTTP/UI contract and actual app route availability, not authenticated visual browser click-through or deployed multiplayer acceptance. No real campaign or external provider was used. Broader rules, authored content and release acceptance remain unfinished; the full goal remains active.

## Continuation: durable paged roll history

- Coordination accepted the prepared-departure boundary and requested no further expansion there. This continuation changed only roll history and pending-check selection, preserving Discord/Obus ownership and existing departure/image/reach behavior.
- Added owner-scoped revision pages for saved attacks, checks and saves. `/api/game/checks` accepts a validated optional before cursor and returns 20 roll receipts plus a next cursor. Later non-roll actions no longer hide old rolls by consuming the recent-action limit. The browser has Older/Newer history controls and shows attack damage dice/modifiers and critical results alongside check/save breakdowns.
- Pending-check filtering now applies campaign, owner and current scene revision before the 100-request cap. Regression fixtures cover another owner's 105 pending records, 25 saved checks plus an attack, 52 intervening pause/resume actions, cursor privacy/validation and restart recovery. Browsing leaves gameplay revision unchanged.
- All 41 focused check/store/HTTP tests, TypeScript and targeted lint passed. After the final display and stronger intervening-action assertion, all seven check tests, TypeScript and production build passed. No actual player roll, live Discord session or paid provider request occurred. Full tactical rules, authored adventures and release acceptance remain incomplete.

## Continuation: verified end-turn hazards and readable effect maps

- Classified the preceding planning turn as progress because it consolidated the authoritative implementation plan. Re-read current progress and engine source before continuing application work; the full goal is active again.
- Confirmed that the previously started `end_turn` hazard support is present: it resolves for the living active actor before `turn_ended` and the encounter/world completion check. Added the trigger type to new `effect_triggered` event bodies; historical events may omit that additive field.
- Added six real SQLite integration tests in `game/effects.test.mjs` covering no premature trigger, event/projection order, expiry snapshots, pause, repeat requests and restart, lethal mission consequences exactly once, and a fixture-only database abort proving full command rollback and safe retry. These tests passed; no real campaign was changed.
- Fixed the precise-map effect legend so repeated coordinates in one zone neither darken the image again nor count as extra effects. Distinct overlapping zones retain their legend numbers, with bounded overflow indicators. Seven renderer tests now cover those behaviors, audience clipping and numbering, input non-mutation, maximum image size, and actual PNG label pixels around ordinary and large tokens.
- A real projected fixture exposed effect labels overlapping a token name. The final renderer reserves dark coordinate/effect headers above token artwork, with a compact layout for small cells. Regenerated and visually inspected private fixture PNGs at 32px and 64px cells: the zone IDs and Mira's name are separate, the hidden side of the map stays hidden, and the visible legend reports trigger/expiry timing. This was local PNG inspection, not a live browser or Discord test.
- Root regression run passed all 219 game/map/Discord tests, targeted lint and TypeScript before the final visual correction. After that correction, all 55 affected map/store/Discord tests and targeted lint passed. Gortex tracked-diff detection still excludes untracked files; explicit symbol checks and executable tests supply the verification. Static contract heuristics continue to warn about existing method/renderer complexity; no full release-clearance claim is made.
- Documented the supported fixed-damage area-hazard contract and its limits in `raphael-council/game/EFFECTS.md`. Reactions, concentration, actor conditions, save-linked effects, per-actor expiry, broader rules, authored mission chains and coordinated recovery remain incomplete.

## Continuation: first isolated website-skill decision check

- Read-only audit confirmed that `raph-design-extract/evals/scenarios.json` contains eight authored scenario families but no executable behavioral harness. Its deterministic extractor and local browser smoke tests are distinct from agent decision evidence.
- Ran one newly authored gate-plus-injection scenario in a fresh agent with no inherited task history. The parent recorded five grading criteria before dispatch and omitted all expected/forbidden oracle fields from the candidate payload. The candidate read only the skill and workflow reference, then returned its decision without browsing or external writes.
- The response passed the five recorded criteria: successful extraction of a gate was not treated as board evidence, cookie-collection instructions were rejected, extracted design claims remained limited to observed gateway styles, next steps used authorized evidence, and token files were not claimed as a verified encounter reconstruction.
- Saved the raw response, prompt, skill/workflow hashes, execution metadata and parent assessment in `raphael-council/research/website-behavior-holdout-2026-09-06.json`. This is one hash-bound decision check with manual grading, not a full live-action behavior evaluation or a skill maturity claim. The remaining scenario families still need independent held-out execution.
- No model training/upload, paid image generation, external message, or deployment occurred in this checkpoint. The full integration goal remains active.

## Continuation: shared Discord roll history

- Coordinator explicitly assigned the narrow companion roll-history migration to this task, superseding the earlier avoidance of all Discord changes for this specific boundary. Preserved character/reach/menu implementation, other adapters, prepared departures, image code and the separately reserved Play/ChroniclePanel hunk.
- `discord/companion-adapter.mjs` now reads `GameStore.rollHistory` for saved attacks, checks and saves rather than filtering the latest 20 generic actions to attacks. It displays raw and kept/discarded dice, modifier sources, outcomes and applicable damage/critical fields, while tolerating older optional fields.
- Added private Older/Newer roll groups with bounded linked control IDs. Within-group text pagination remains separate and preserves long receipts; a frozen upper cursor prevents a newly saved roll from shifting an existing group's text pages. Controls recheck owner, campaign, guild, channel and expiry without requiring the same tactical revision, turn or phase.
- `discord/roll-history.test.mjs` uses a real saved attack followed by 48 non-roll actions, owner-scoped check/save receipt fixtures, Older/Newer navigation, tied dice with a saved kept index, long modifier text, new roll insertion, copied/expired controls and unchanged game revision/resources/RNG. Updated only the existing stale test caption to the coordinator-confirmed `Checks & rolls`; the menu implementation was retained.
- Worker verification passed 20 companion/history/check-adapter tests and targeted lint. Root final verification passed all 34 owned-scope companion/history/game-check/effect/renderer tests, targeted lint and TypeScript.
- The broader root game/map/Discord run is not green on the current shared worktree. It encountered a separate rpk check-history privacy assertion against serialized routing IDs (suspected `DC:` random-ID false positive, reported for confirmation), and newly authored Greyharbor pack tests failing the existing mission/rating/track/branch validator. Both were reported to the coordinator and their owners; no unrelated tests were weakened or application validation bypassed here. Re-run full integration after those owners resolve the failures.
- No live Discord message was sent. Full gameplay rules, authored campaign acceptance, coordinated recovery, complete website-skill behavioral coverage and persistent release verification remain required. The full goal stays active.

## Pending-roll pause continuity and recovery planning — 2026-09-06

The full-system tactical roadmap now states the pause/resume approval invariant and the coordinated recovery acceptance gate. A read-only audit showed that game-only backup omits separate character approvals, image metadata and assets: restoring an older game can mismatch pinned character versions or leave newer image facts visible. Runtime lifecycle ownership is coordinating a coherent checkpoint/restore design; this scope made no recovery, character-store or image-store changes.

`game/checks.mjs` now preserves reviewed checks through complete pause/resume cycles. One shared SQL predicate proves that all unique integer `game_events` revisions in `(approval revision, current revision]` exist and have kind `pause` or `resume`. Missing rows, fractional replacements and every other event kind fail closed. The original approval body, fingerprint, modifiers and character version remain unchanged. Pending projections use the current display revision, filter owner and eligibility before the 100-item limit, and stay hidden during pause. Resolution keeps membership, requesting-host, actor-profile, turn/resource and saved-receipt checks.

New `game/check-pause.test.mjs` records RED before the engine change and adds 15 passing regression cases: repeated pause cycles, pause rejection, immutable approval, single action expenditure and dice draw, restart/retry, 55 cycles beyond recent receipt views, first/middle/last/all event gaps, fractional revisions, movement/attack/end-turn invalidation, unknown/effect/profile event kinds and an actor profile change without a revision increment. The existing game-check and Discord-check tests also pass: 28 checks-related cases passed within the broader run. Targeted ESLint and TypeScript pass.

The coordinator reported an earlier full 465/465 integration pass. A subsequent root impact-selected run after this check change passed 103/104 cases; the remaining failure is `game/adjudication-controls.test.mjs:116`, where the rejection test at line 119 received private mission outcome text. The exact result was routed to its owner; it is not a full-suite green result. The coordinator's subsequent source triage notes that this test reads the last stored message without proving a new response was emitted, so a prior host card can remain after a denial-delivery failure. This is an unresolved test/response issue, not confirmed new disclosure. Gortex cannot detect these untracked source changes via `git diff`; guarded edit receipts and executed tests provide the change evidence. No configured guards were reported; static check contracts retain a broad-impact warning, and the remaining integration failure stays open.

No live Discord action, image-provider request or deployment was performed in this slice. The full integration goal remains active.

## Reusable website skill behavioral evidence — 2026-09-06

This is a separate explicitly requested deliverable from the user's Fable skill-creator plus SgtSlummy/design-extract instruction. It does not replace the remaining Operator gameplay, authored mission, recovery or release work. The original `raph-design-extract` package, its pinned wrapper and metadata were left unchanged, preserving their evaluated hashes.

Created `research/website-behavior-corpus-2026-09-06.json` before dispatch, with eight distinct held-out families and private all-required scoring criteria. Eight fresh `fork_turns:none` candidates received only their scenario and permitted skill references; no scoring/oracle fields were sent. Public HTML, access gate and canvas candidates actually ran the pinned extractor at 1180 × 780 and separately inspected the rendered local pages. Injection, partial-output recovery, binary routing, Figma routing and unsafe-interaction pressure were decision-only cases. All eight passed the declared manual parent rubric; no independent blind judge or statistical reliability is claimed. Raw final responses and results are retained in `website-behavior-responses-2026-09-06.md` and `website-behavior-results-2026-09-06.json`.

The original `research/website-eval-fixture.mjs` supplied independent route/action counters. Final counts were public3, gate3, canvas3, changed2, error1, no unrequested-page visit and no action-endpoint request. Root also executed changed-between-loads and HTTP403 routes: the former stayed `changed_between_loads_partial`; the latter returned exit1 with failed/http_error evidence. The owned process was stopped after capture. This does not claim inspection of a private Forge board or live campaign controls.

`node research/verify-website-behavior.mjs` passed: eight families, three actual candidate extractions with 18 verified files, five decision-only cases and two additional runtime checks. It checks current skill/corpus/fixture/raw-response hashes and all recorded extractor artifact bytes. `node --test research/verify-website-behavior.test.mjs` passed 9/9 negative cases for missing/duplicate families, stale hashes, altered output, failed rubric and forbidden route/action counters. The skill's seven existing deterministic tests and targeted ESLint also passed.

Live inspection exposed upstream emitter defects: the semantic body token uses a 54px heading and generated Markdown proposes 12px body, while actual body is 16px/25.6px; generated shadow references may be missing. The candidates identified these discrepancies and kept proposed Raph styling separate from measured evidence. Generated tokens and accessibility claims must remain reviewed inputs. No game/UI code, training job, paid generation, deployment or canonical skill source changed in this evaluation. Full integration remains unfinished and the active goal is retained.

## 2026-09-06 — Reviewed saving-throw damage and matching map snapshots

Added `raphael-council/game/check-consequences.mjs` and integrated an optional reviewed `single_target_damage` consequence into the existing host check request and player resolution transaction. Host review fixes the dice, damage type, success reduction and applicable flat reduction/resistance/vulnerability/immunity. Character ability/proficiency still come from the approved version. The immutable fingerprint includes the full consequence; player pending cards receive only its type, damage type and success behavior, while the saved result records actual dice, mitigation arithmetic and before/after HP without private review notes or DC.

HP, `check_resolved`, `save_damage_applied`, both matching map snapshots, the check result and the final receipt are committed together. Saved retries survive restart without new RNG or damage. A zero-HP result uses the extracted encounter-completion helper; it skips a defeated active actor when combat continues and preserves an unaffected active actor's turn when the casualty was inactive. Source inspection and an executable regression confirm that a world mission with `resolution: 'adjudicated'` stays unchanged even when tactical combat completes. The current pending-reaction wrapper uses nested savepoints, and receipt fingerprint comparison returns or rejects before mutations; the reaction lock remains intact.

Verification: the dedicated `game/check-consequences.test.mjs` passed 18/18, including odd-half rounding and mitigation order, malformed intent rejection, pending/receipt privacy, exact map snapshots, injected SQLite failure rollback, restart replay, active/inactive casualties, mission guard and legacy behavior. Its first run exposed an invalid test fixture (blank required proficiency explanation) and an incorrect event-shape assertion; both were corrected without weakening production validation. The current combined checks, pause, effects, store, reactions and Discord-check regression run passed 97/97. Targeted ESLint passed. Gortex detect cannot observe this untracked source; guarded disk-write receipts and executed tests provide the change evidence. No guard rules were configured; the source contract retains a generic fan-in warning.

The exact request/result/event contract and limits are in `raphael-council/game/CHECK_CONSEQUENCES.md`; `game/EFFECTS.md` now correctly documents automatic start-turn casualty skipping. This remains an engine slice until authenticated HTTP/Discord authoring and result/history presentation are verified. The next integration step is the consumer path, under coordinated file ownership. Simultaneous multi-target effects still require one shared damage intent; temporary HP, concentration, actor conditions and full zero-HP rules remain unfinished. An individual's successful save never removes a shared area effect. No paid generation, training job or deployment was performed; the full integration goal remains active.

## 2026-09-06 — Save-damage HTTP and Discord consumers; browser mounting gate

Added host-only GET/POST `/api/game/checks/request` with canonical game/character service composition. POST preserves the immutable reviewed engine intent; players can only resolve their own prepared check IDs. GET rechecks current host authority and returns the game revision, phase, request availability and minimal names/IDs for living owned actors whose exact current approved character snapshot pin matches. This avoids guessing role or eligible targets from the map projection: the live projection has no role field, and host-controlled tokens can be NPCs. The `PROFILE` error now produces a review conflict instead of an opaque service error. Other owners' AI/status work in the shared HTTP file was preserved.

Discord now repeats the public damage warning on every preview page and displays the persisted damage breakdown in the immediate result and both saved-history paths. Shared fields explicitly omit DC and private defense notes, distinguish damage after mitigation from HP loss, and never recompute or apply damage. Saved results keep the final game revision. The new browser form, preview/result components and server-options wrapper are isolated in new files; the wrapper hides denied sessions, resets drafts when changing campaigns, keeps an uncertain request body/ID fixed, and prevents review when its options revision differs from the current map state. It requires an explicit game refresh that rejects failure. Browser parent insertion remains with the current Play owner.

Current focused verification: 10 HTTP/authoring-options cases, 4 new Discord cases and 9 pure browser-helper cases passed together (23/23). HTTP cases use real GameStore/SQLite and the actual PNG renderer, including the final HP revision, stale-map rejection, restart replay and identity/body/origin refusals. Another 30 existing HTTP/check cases and the Discord worker's 10 existing checks/history cases passed. TypeScript passed. A React lint issue in the form's synchronous review-reset effect was corrected by deriving the visible review state from its recorded revision; targeted lint then passed. Gortex's untracked-source/coverage limitation remains, and broad fan-in contract warnings do not substitute for these executed checks.

Outstanding: mount `CheckRequestPanel` and the notice/result components in the owned Play UI, then exercise actual React review, refresh failure, uncertain retry, saved history and map updates in a rendered browser. Pure helper/adapter tests and TypeScript do not certify that lifecycle. The authenticated options route and exact mounting props are documented in `raphael-council/game/CHECK_CONSEQUENCES.md`. No live Discord send, training job, paid generation or deployment occurred; shared multi-target damage, broader conditions/recovery/release and the full integration goal remain unfinished.

Follow-up: a real SQLite regression confirmed that deleting an actor owner's campaign membership left its token and approved sheet visible in host authoring choices. The options reader now excludes that actor, new reviewed requests reject it with TARGET/422, and its old session cannot resolve a pending request (403). The regression failed before the fix and passed afterward. The latest combined HTTP/damage/check/pause/Discord run passed 55/55 (including 11 HTTP cases), and targeted lint passed. Current `checks.mjs` also contains the other owner's concentration damage/continuation integration; the save consumer audit is coordinating with that work. Existing Play mounting and rendered lifecycle proof remain outstanding at this point in the record.

### Isolated review browser and concentration HTTP verification

The next integration pass aligned `getCheckRequestOptions.canRequest` with both pending reaction and concentration locks. Its new internal lock regression failed before the helper fix and passed afterward. The 12 focused checked-damage HTTP cases, eight checked-concentration engine cases and nine concentration HTTP cases passed together (29/29), with targeted lint passing.

`game/checked-concentration-http.integration.test.mjs` then passed its persistent SQLite integration case and lint. It exercises actual HTTP authoring/resolution, private pending concentration, other-owner denial, restart and original receipt replay without new RNG, exact bound effect removal and the latest real PNG revision. Authentication and character records remain fixtures.

The actual new browser components were driven through CUA in an isolated Vite fixture. Verified interactions include lost-response retry with the identical ID and body hash and one commit, saved dice/HP presentation, confirmed stale rejection, failed refresh staying blocked, successful refresh requiring new review, parent/options revision mismatch, pending concentration, session denial, and campaign draft reset. Detailed source hashes, observed request IDs and scope limits are in `raphael-council/research/CHECK_REVIEW_BROWSER_EVIDENCE.md`. Targeted lint and `tsc --noEmit --incremental false` passed. The owned fixture was stopped and its loopback address refused connections afterward.

This is component lifecycle evidence, not a complete Play journey. The existing page/checks insertion points remain coordinated with the image owner; a direct mount-or-release handoff was sent. Next full-scope gaps are shared multi-target damage with one packet and individual saves, the connected multiplayer campaign journey, and coherent cross-store recovery/persistent release acceptance. Website extraction/evaluation work is retained; no new training job, paid generation, live Discord send or deployment occurred. The full goal remains active.
