# Persistent concentration and resumable damage

Status: implemented and locally verified, including actual backup/restore and independent HTTP sessions, September 6, 2026. This is the concentration integration after persistent opportunity reactions. It does not certify live multiplayer deployment or complete the full tactical/world plans.

## Completed implementation and evidence

- `game/concentration.mjs` persists one reviewed source per actor, exact effect bindings, a pinned private Constitution save and immutable receipts. Registration records an already reviewed ongoing effect; it does not grant a free spell cast. Current member, actor and reviewer authority are rechecked before decisions and replay.
- `game/store.mjs`, `game/reactions.mjs` and `game/checks.mjs` save the first HP write together with pending concentration and serialized remaining work. Ordinary attacks, ordered reactions, enter/start/end hazards and checked damage all use the shared hook. Resolution resumes stable effect identities, confirmed reaction order, movement and turn stages once.
- The browser concentration panel and Discord concentration adapter expose the same registration, private save, voluntary ending, reviewed recovery and saved-result information. Map/history projections never promise mutation authority. Distance and image requests remain free, including off-turn or during a pending save; actual movement and attacks wait for the decision.
- The combined AI, auth, Discord, game, chronicle, maps, images, characters and client suite passed **929/929 tests** on September 6. The 55 focused concentration/core-continuation tests passed again after adding the persistence validator. TypeScript passed after the final AI panel fix; the production build and targeted Play lint had also passed. These checks do not certify live provider or Discord connections.
- A disposable production browser walkthrough registered a reviewed ward, stopped player movement after one 2-HP hazard hit, displayed the private DC 10 save, saved d20 14 + modifier 4 = 18, and resumed the remaining route once. Reload preserved HP, position, remaining movement, action and the same roll. Voluntary ending then removed only the bound ward. Database inspection confirmed the original stopped movement receipt stayed unchanged and the first damage snapshot contained the pending save and remaining work.
- That walkthrough also exposed and fixed a null-policy crash in the companion AI panel. Host policy writes now use the current boot epoch, generation and policy revision; unavailable AI leaves manual play usable. This is independent of concentration mechanics.
- Actual backup/restore coverage passed: 12 new cases in `game/concentration-backup.test.mjs` cover ordered reactions, overlapping hazards, turn timing, checked damage, malformed current/historical records and revoked authority. All 69 focused recovery tests passed. Validation accepts legitimate stale ownership/effect context, actual reaction frames without an `id`, and historical empty stacks. It rejects malformed schemas/fingerprints. These tests exposed and fixed a final-snapshot mismatch: when remaining work finishes without another gameplay event, `GameStore.save` records `continuation_settled` before committing the final state and receipt.
- After the recovery fixes, all 515 game/reaction checks and 196 auth/Discord/client checks passed. These groups overlap; their counts are not an additional distinct combined-suite total. The generic Gortex risk warning remains recorded, and its tracked-diff detector omits these untracked files; actual test runs and guarded disk-write receipts provide the change evidence.
- `game/concentration-multiplayer.test.mjs` runs a real loopback HTTP server with independent player A, player B and host TCP connections. It demonstrates private waiting, permission denial, server/SQLite restart, unchanged original movement replay, an intentionally lost committed save response, reconnect/retry without rerolling or repeated damage/movement, matching map revisions and revoked-cookie rejection. The two network tests plus HTTP integration passed 12/12. The network regression also fixed malformed concentration action fields returning retryable 503; they now return 400/INVALID without a write or RNG call. Authentication in this harness is fixture cookie authentication, so live Discord OAuth and deployment acceptance remain outstanding.

## Original pre-implementation baseline

The following evidence describes the starting point for this work card; references to synchronous behavior or absent concentration below are historical, not current runtime status.

### Existing evidence at the start

- `game/combat-profile.mjs` validates reviewed Constitution-save ability/proficiency/adjustments and contains `concentrationSaveDC`. `game/bootstrap.mjs` derives the source statistics from approved fields and requires explicit proficiency review. This is metadata, not an active concentration system.
- `GameStore.attack` is the common ordinary/reaction attack HP writer. `GameStore.triggerEffects` is the enter/start/end hazard HP writer. Both record post-damage snapshots, but callers currently continue to later work immediately.
- `game/check-consequences.mjs` supplies the checked-save HP write. The physical `CHECK_CONSEQUENCES.md` contract, SHA `7184a5ca7242085da4be79bb838660d14469dd434634fec7516d4d1c4a7a290b`, defines `result.consequence.appliedDamage` as damage after mitigation and before zero-HP clamping. That is the concentration input; `hpBefore - hpAfter` is not.
- Checked-save resolution records both `check_resolved` and `save_damage_applied` after the same HP write. Neither consumers nor a new concentration listener may apply damage again for each snapshot. The original receipt's revision remains its final committed revision.
- `game/reactions.mjs` persists private declarations, explicit simultaneous order and suspended movement. Its current settlement loop completes every authorized attack and resumes movement synchronously. It must become resumable before concentration can interrupt it correctly.

## Required behavior

A reviewed concentration source belongs to one actor and explicitly binds the effects it sustains. Do not infer concentration, proficiency, spell definitions or defenses from sheet prose. Registration must validate current authority, actor/profile version, effect identity and existing effect ownership. Replacement ends the previous source atomically. Voluntary ending costs no action; ending, replacement and reads need explicit Discord and browser equivalents.

Damage greater than zero creates one concentration save for the damaged concentrating actor unless an authoritative terminal condition already ends concentration. The reviewed SRD 5.2.1 rule is a Constitution save with `min(30, max(10, floor(damageTaken / 2)))`. Use the existing reviewed save profile. Zero damage requires no save. Death/incapacitation, replacement and failed saves terminate exactly the bound effects. The engine's current defeated-token handling is not proof of complete D&D unconsciousness/death rules; those conditions need explicit state semantics before claiming their full lifecycle.

Damage, resource spending, the pending save and the suspended continuation must be recorded in the same transaction and first post-damage snapshot. A failure rolls all of them back. An original attack/check command keeps its immutable receipt. The later save has its own stable request and receipt; recovering either receipt never rerolls or reapplies damage.

## Continuation contract to implement

Use serialized, server-created continuation data rather than callbacks or re-running the original command. Validate it at persistence/restore boundaries. Every stage must say which work has already committed and what remains. Bind it to campaign, map, turn, actor, source profile and damage identity.

| Interrupted work | Required resume boundary |
| --- | --- |
| Ordinary attack | After the one attack/resource/damage record, before completion/turn handling that depends on the save |
| Opportunity attack | Retain `pendingReaction`, declared choices, confirmed order and next attack cursor; save and consume the resolved reactor only once before pausing |
| Enter hazard | Retain the remaining effect IDs for this crossing and the remaining movement path; revalidate each still-existing effect and route cell on resume |
| End-turn hazard | Retain old actor and end-turn stage; do not advance initiative twice |
| Start-turn hazard | Retain the new actor and start-turn stage; do not refresh resources twice or skip a living actor |
| Checked-save damage | Create pending concentration inside the existing single HP write and first resulting snapshot; retain any later defeat/turn work without mutating the original saved check receipt |

An effect array index alone is unsafe: a failed save may remove effects and shift indices. Persist stable remaining IDs/cursors and skip effects that no longer exist. A concentration interruption takes precedence over a retained reaction window; it must not discard declarations, start a fresh window or replay a resolved attack. Once a save resolves, continue only until the next required player decision or the original work is complete.

Centralize damage application so all three writers use one hook. Keep packet identity separate from event-snapshot identity. Do not infer a simultaneous area damage group by combining independent single-target checks: shared-roll multi-target resolution remains its own explicit contract. Mitigation and temporary-HP support must supply actual damage taken when added, rather than relying on clamped HP loss.

## Authority, privacy and recovery

Only the concentrating actor's controller may resolve its save; the host controls an NPC. Private DC, reviewed modifiers, source details and dice remain within the authorized projection and owner-scoped receipt history. Other viewers receive only a generic waiting state, without hidden actor/source identifiers or pending counts. Paused play retains the entire continuation and rejects resolution. Read-only map, image and distance requests remain available and explain that costly actions are waiting.

All mutation entry points need one atomic pending-resolution guard, preserving proven terminal receipt replays. Ownership/profile changes or revoked responders require a reviewed recovery action; expiry/timeouts must not automatically declare a save failed or choose for a still-authorized player. Querying, polling and refreshing must never advance the continuation.

Persist all fields in scene snapshots and backups. Scene departure cannot abandon unfinished work. Existing campaigns without concentration fields retain their existing supported behavior. Keep explicit rule-version and migration compatibility; do not silently reinterpret previously saved rolls.

## Acceptance proof before claiming gameplay support

1. Register, voluntarily end and replace reviewed concentration through both clients, with owner/NPC-host authorization, exact effect binding, revision rejection and repeat-safe receipts.
2. Ordinary, opportunity, enter-hazard, start-hazard, end-hazard and checked-save damage each create exactly one appropriate pending save. Zero/immune damage creates none. Save DC uses post-mitigation damage before HP clamping, including overkill and the cap at 30.
3. Successful and failed saves use the pinned reviewed modifiers/advantage sources. Failure removes only the bound effects; unrelated effects and another actor's concentration remain.
4. A failed concentration save after the first ordered reaction prevents removed effects from influencing the second reaction or remaining route. The next attack cursor and all private declarations survive pause/restart/restore.
5. Multiple hazards use stable IDs. Removed hazards do not fire after continuation; already-triggered hazards do not repeat. Start/end turn counters and resource refresh occur exactly once.
6. Checked-save receipt/history and both same-HP snapshots remain consistent. The original command and concentration resolution each recover their own immutable result after lost delivery without new RNG or HP changes.
7. Two connections, forged ownership, stale profiles/revisions, revoked membership, write failures at every commit stage, saved replays during interruption and old-campaign compatibility are exercised against actual stores.
8. Actual browser and Discord consumers display private choices, generic waits, complete saved results and current authorized map revisions. Images/reach remain free reads. Complete a disposable two-player interruption/reconnect flow before live acceptance.

Continue to coordinate changes to the shared continuation schema across the store/reaction pipeline, checked-save damage, both clients and recovery. The implemented schema is exercised by the integration evidence above; a pure DC or validator test alone does not satisfy this work card. Remaining full-game work includes authoritative initiative, general resource/condition/death handling and the persistent world interval, as recorded in their separate plans.
