# Initiative implementation work card

Status: proposed implementation, based on indexed source inspected September 6, 2026. This document adds no executable capability and is not acceptance evidence.

## Requirement and complete boundary

[RAPH_TACTICAL_IMPLEMENTATION_PLAN.md](../../RAPH_TACTICAL_IMPLEMENTATION_PLAN.md), work card 3, requires structured profiles, initiative, saves, resources, reactions, concentration and effect timing. The next source-evidenced initiative gap is the path from reviewed combatants through saved rolls and tie decisions to the first committed turn. Complete that path in the shared game service, Discord and browser. A helper that sorts supplied totals or a browser-only roll does not complete this card.

This card does not redefine the full engine goal. Bonus actions, general feature/slot resources, conditions/death, actor-relative effect timing, authored world expansion and the combined multiplayer/recovery acceptance remain separate requirements.

## Current source evidence

| Boundary | Inspected behavior | Consequence for implementation |
| --- | --- | --- |
| `store.mjs::validateSeed` | Requires integer `initiative`, sorts descending and then by actor ID, initializes `phase: 'combat'`, `round: 1`, `turn: 1`, and `rulesVersion: 'raph-explicit-combat-v1'`. | Existing totals are supplied data, not saved initiative rolls. Preserve their historical meaning during migration. |
| `store.mjs::createCampaign` | Sets the first actor's movement and reaction availability, records creation, then runs `startEffects`. | Rolled encounters need a setup boundary before first-turn resources or hazards run. |
| `combat-profile.mjs::validateCombatCapabilities` | Whitelists attack kind, melee reach and Constitution-save configuration. | Initiative statistics/features require an explicit validated extension or dedicated reviewed profile; they are not present in this profile today. |
| `checks.mjs::requestCheck` | Validates the exact approved 2024 snapshot digest, required corrected statistics, explicit proficiency applicability and adjustments. Stores reviewed d20 modifiers; accepts player characters only and requires check/save kind plus DC. | Reuse sound approval and dice contracts, but do not manufacture a DC or claim this player-only API already resolves NPC initiative or encounter ordering. |
| `scenes.mjs::transitionScene` | Preserves party actors and archived NPCs, validates the destination, assigns `old.turn + 1`, selects a living first actor, refreshes movement, records scene entry and runs start effects for combat. Adjudicated missions enter exploration. | New encounter setup must cover fresh entry and revisits while preserving HP, identities, approved versions and scene history. Exploration entry must remain outside initiative. |
| `scenes.mjs::prepareDeparture` / `enterDeparture` | Preparation calls scene transition in a rolled-back rehearsal; entry later executes the prepared document. | Preparation must consume no randomness and create no external roll requests. Transaction rollback alone cannot undo RNG/provider side effects. |
| `store.mjs::startEffects` / `finishEndTurn` | Start effects use saved continuations. Turn progression refreshes resources, expires effects and can pause for concentration. | Initiative finalization must enter this lifecycle once and retain any resulting concentration interruption without rerunning initiative. |

The rules matrix in `game/README.md` still contains outdated reaction/concentration gaps. Reconcile those entries against current implementation when updating initiative status; do not use old rows to remove existing capabilities.

## Rules and reviewed statistics contract

The existing engine identifier remains `raph-explicit-combat-v1`; approved player checks currently require edition `2024` and use `raph-reviewed-d20-v1`. Preserve these source facts. Introduce a separate proposed receipt/profile identifier, `raph-reviewed-initiative-v1`, only with the implementation and fixtures below. It denotes this explicit initiative contract, not certification of the whole 2024 ruleset. Persist the chosen source edition and reviewed rule reference with encounter setup.

Before implementation, verify the selected 2024 initiative rules in primary rules text and record the exact source/section in the implementation evidence. The official SRD 5.2.1 URL already used elsewhere in this project is a research starting point, not newly verified evidence in this card: <https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf>.

Required reviewed profile:

- Player actor ID, owner, exact approved snapshot version/digest, required initiative ability field and validated numeric value. Read the field prescribed by the selected rules; do not derive it from AC, speed, weapon choice, name or prose. Missing, conflicting or uncorrected uncertain values prevent setup completion.
- NPC identity and an explicit host-reviewed initiative statistic with provenance/reason and profile version. Do not default unknown NPC modifiers to zero or treat the seeded total as a modifier.
- Only explicitly supported proficiency/feature adjustments and advantage/disadvantage sources, with bounded typed values and reviewed reasons. A class name or imported text never silently grants a bonus. Snapshot reapproval cannot retroactively change saved rolls or heal/refresh resources.
- A pinned tie policy. Implement any ordering authority required by the selected rules. Where that version leaves discretion, require an explicit reviewed campaign policy and the authorized decision. The existing actor-ID fallback is legacy behavior, not proof of a rules-authorized tie rule. No silent new random tiebreaker or first-listed default.

Still requiring primary-source and profile evidence: exact ability/modifier applicability; surprise and other initiative advantage/disadvantage rules; special initiative features or substitutions; grouped identical NPC rolls; tied PC/NPC decision authority; and creatures joining an already active encounter. Do not implement these from memory or infer them from this card. Grouped rolls and mid-encounter entry need their own defined lifecycle if included; independent rolls must not be presented as equivalent. Unsupported profile mechanics must remain explicit and actionable to the host.

## Persisted encounter setup and commands

Use an explicit persisted initiative stage before combat activation, with a unique encounter ID distinct from the map ID. A fresh encounter in a revisited map must not reuse an old encounter's roll IDs. Persist the roster and profile versions, roll intents, saved results, unresolved tie groups, reviewed tie policy, setup revision and activation status. Store any reserved first-turn/round values so waiting never advances effect clocks and activation applies the existing scene-entry turn increment once.

New supported rolled encounters enter this stage through actual campaign bootstrap and combat scene entry, including authored destinations. Keep old seeds and existing campaigns readable as explicitly precomputed initiative; do not reroll them on upgrade, restart, projection or page load. Provide a reviewed way to select precomputed results for legitimate existing/external rolls, retaining provenance and distinguishing them from engine-rolled receipts. Do not leave every real entry path silently using legacy totals while only a test helper reaches rolled setup.

Each mutation carries encounter identity, request ID and expected revision. Derive campaign/owner identity from authentication. Prepare reviewed intents without consuming RNG; resolve an intent using the pinned profile; resolve authorized ties; activate combat once all required decisions are complete. The exact transport method names may follow existing services, but query operations are read-only and cannot resolve or activate play.

Players resolve their own valid character requests. Hosts resolve NPC requests and manage reviewed setup; host role alone must not silently roll for a currently authorized player. Recheck membership, current actor ownership and pinned versions at resolution. Explicit recovery can replace invalid/revoked participants or stale unrolled profiles, with an auditable reason and fresh intents. It must not erase an unfavorable saved result, convert a valid player choice into a host action, or regenerate dice through repeated prepare/recover calls.

Roll results save raw, kept/discarded dice where applicable, modifier breakdown, total, profile/rules versions and receipt identity. One transaction commits the result, events, state, receipt and outbox. Identical retries return the immutable saved result without RNG; conflicting request reuse fails; stale or unauthorized new requests change nothing. A later tie decision or first-turn hazard does not rewrite an earlier initiative receipt. Retrying activation cannot refill resources or emit a second first-turn sequence.

## Timing, scene and interruption integration

While initiative is incomplete, movement, attacks, turn ending and other costly mutations cannot bypass setup through another service. Extend the shared pending/phase guards rather than checking only one endpoint. Read-only character, map, reach, image, history and journal queries remain available subject to normal visibility. A scene illustration or distance question does not resolve initiative or spend game time.

Pause must preserve the exact initiative stage and unspent decisions. Current pause/resume code distinguishes combat and exploration; extending it to initiative requires preserving and validating that phase explicitly. Resuming cannot silently switch an unfinished setup to combat. Frozen mutations reject without dice, writes or tie changes.

Finalization establishes the reviewed order and activates the first eligible actor once. Apply first-turn movement/action/reaction behavior according to the selected supported rules and existing continuity, with no hidden reset during approval or scene previews. Apply scheduled expiry/start effects at the documented boundary. If a start hazard creates a concentration save, its first snapshot must already contain the completed initiative order, committed first-turn state and saved continuation. Resolving that save resumes the hazard/turn continuation, not initiative preparation or activation. A lethal start effect must use the existing next-actor/completion lifecycle without duplicating rolls or skipping an additional turn.

Scene-transition receipts retain their original saved outcome even if initiative is resolved later. Replays of prepared departures remain authorized and idempotent. Archiving/revisiting a scene preserves casualties and current party resources; new initiative must not restore NPC HP or resuscitate an actor. Existing pending reactions/concentration must be resolved or validly recovered before a new encounter can replace their state.

## Shared projections and controls

Implement authenticated shared queries and commands plus browser and Discord controls. Both clients show each controlled actor's pending roll, reviewed breakdown when appropriate, saved result, eligible tie decisions, pause state and waiting/activation status. NPC rolls require NPC-host controls. Browser convenience must not become required for a player to roll or participate in a tie decision; Discord needs equivalent commands or interactive controls, with a readable saved card when interaction is unavailable.

Keep hidden NPC identity, raw roll details, profile fields, pending counts and unresolved tie metadata out of unauthorized projections. Public turn order includes only audience-authorized information; generic waiting text must not enumerate hidden combatants. All candidate selection and signed/custom control payloads require fresh server authorization. Reconnect and old controls cannot expose previous ownership data or reroll. Both clients render saved receipts and consume ordered snapshots rather than animating speculative RNG.

## Implementation ownership and likely files

The eventual implementation should own a cohesive initiative service/profile extension and focused fixtures, with narrow integration edits to `game/store.mjs`, `game/bootstrap.mjs`, `game/scenes.mjs`, authored entry/configuration boundaries, phase/pending guards and projections. Reuse shared roll validation where it fits; existing `game/checks.mjs` needs a deliberate contract change before it can represent this flow. Freshly inspect bootstrap and approval field mappings before editing; this card did not inspect their bodies.

Add shared HTTP routes and Discord controls, then mount the browser panel with the active file owners. Review `client/tactical-controls.mjs`, image/observation phase support, narration, outbox, game backup validation and coordinated restore. These are required integration audits, not a claim that every listed module needs an edit. Other agents own shared areas; obtain exact ownership boundaries and preserve their changes. No deployments, real campaign migration, Discord posting or provider calls are part of authoring this card.

## Acceptance gates

1. **Profiles and rules:** independent fixtures cover approved player and reviewed NPC statistics, applicable modifiers and dice selection under the sourced rules. Missing/conflicting/stale data is rejected; seeded legacy totals remain distinguishable and unchanged. Ties follow the saved authorized policy, including mixed actor ownership where supported.
2. **Encounter entry:** actual bootstrap, fresh combat transition, revisited combat and prepared departure reach the correct stage. Exploration bypasses initiative. Preparation/rehearsal produces zero RNG calls and no persisted pending work; activation records each roll and first turn once.
3. **Two owners and host:** two approved player characters resolve independently and the host resolves an NPC. Neither player controls the other's request; host does not substitute for a valid player. Resolve in different arrival orders and obtain equivalent totals/order under the same saved results and tie decisions.
4. **Atomic recovery:** close/reopen after setup, after one roll, during a tie and immediately after activation. Identical requests return original dice/revisions; altered requests fail; stale/unauthorized requests and transaction failures leave state/resources unchanged. Late/out-of-order duplicate requests cannot reroll or activate twice.
5. **Timing and interruption:** a first-turn hazard damages a concentrating actor, suspends for its save and resumes remaining hazards/turn progression once. Include a lethal first hazard, expiry at the activation boundary and an encounter that completes during start effects. Verify all intermediate outbox snapshots, resource budgets and continuation identities.
6. **Phase and privacy:** pause before any roll, between rolls and during a tie; queries remain read-only and resume restores initiative. Revoked membership, changed ownership, stale profiles, hidden NPCs and old control payloads cannot leak or choose outcomes. Recovery preserves already committed receipts.
7. **Both clients:** browser and Discord complete the same roll/tie/activation flow from authenticated sessions. Reload/reconnect shows saved results and the same authorized revision, with keyboard/text access and no browser-only required step. Scene-image and reach requests remain available without initiative or action cost.
8. **Restore and release fixture:** coordinated checkpoint/restore preserves the encounter ID, pinned approved profiles, partial rolls/ties, receipts, outbox and any activation concentration continuation. Missing/mismatched profile references have an explicit outcome. Run the plan's combined two-player tactical fixture through initiative, move/action, interruption, both image types, reconnect/restart, travel and debrief before using this feature as full integration evidence.

Update the rules matrix and engine audit with the actual implemented boundary and measured evidence after these gates pass. A passing pure dice/sort test, this work card, or a proposed API is insufficient proof.
