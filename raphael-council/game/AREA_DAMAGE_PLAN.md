# Shared multi-target saving damage

Status: the isolated definition and prepare/read/commit service is implemented and verified. It is not connected to live GameStore commands or player transports. Target saves, ordered HP application, concentration handoffs and recovery remain unfinished. This document extends the full Raph integration plan and preserves its multiplayer, recovery and release requirements.

## First implementation card — verified 2026-09-07 UTC

`area-damage-definition.mjs` validates exact reviewed inputs, 2–16 distinct owned targets and the explicit order. It canonicalizes independent copies and pins each target to approved 2024 character stats. `area-damage.mjs` exposes `initializeAreaDamage(db)` and `createAreaDamageService(store, characters, GameError)`, whose methods are `prepare(scope, input)`, `read(scope, intentId)` and `commit(scope, confirmation)`. Preparation requires the host and changes no game revision, dice or resources. Commit requires the actual turn controller, an opaque approval token and the exact proposed order; it spends the supported cost and persists one common roll, parent stage, pending flag, event, snapshot and receipt in one SQLite transaction. Identical request replay survives reopen without additional dice or spending; changed request contents conflict.

Ordering confirmation exposes only visible source/target identities, the declared action cost and damage type. It omits private damage formulas, DCs, defenses and other players' modifiers. Both source and targets must be visible. Confirmation availability rechecks the reviewing host, target membership and approved profiles, context, revision and action availability; membership or import changes need no game revision to invalidate it. Committed history remains readable after its source falls to zero HP. Unknown adapter or storage errors are not swallowed as ordinary ineligibility.

Verification: **10/10 definition tests and 45/45 persisted service tests passed**, plus targeted ESLint. The service tests use real SQLite and reopen the same database. They cover no-RNG preparation/rejection, controller authority, canonical conflict/replay, one common roll/cost, unchanged HP, privacy, current membership/profile validation, spent-action availability, and injected receipt failure rolling back the parent stage, action, pending flag, event and snapshot. Independent review findings for hidden-source disclosure and stale confirmation availability were reproduced failing, then passed after fixes. Source-defeat reads and spent-action rejection also have regressions.

Settled source SHA-256 values: service `a7047cffbc4f5b9f839f4e6ba381d66b232952dd7ed2cb7e0055972b9d17228a`; service tests `bddebc3fb24fc975fa0143f63355f49c9bb6f8b619faa64fb329ef0d7b0a6d5b`; definition helper `f6cd5598790892cc03a9476d2e7f1d4661d8f86c77e505228fb5cf3d60ff3ed8`; helper tests `029dc44c65ca792f8cc9ec1586ff1cf365307c5c3761df9fe596a42aaf3079eb`.

**Integration limit:** the stored `pendingAreaIntentId` is not yet honored by existing game commands. Do not expose this service through a live route until the campaign lock, target resolver, continuation, backup validation and consumer journey are connected. These tests do not certify live transport or multiplayer behavior. Gortex physical write receipts verify the new files; its tracked-diff detector omits untracked files. Post-edit guard checks found no configured violations; the generic factory-size contract warning remains, with its narrow impact reviewed and behavioral tests passing.

## Behavior

One area action has one reviewed definition, one shared damage roll and one supported resource expenditure. Each target has its own approved save and reviewed defenses. Players may respond in either order or reconnect between responses. Response arrival must not determine the order of mechanical consequences.

The official 2024 rules require one damage roll for targets saving against the same simultaneous damaging effect. Separately, the person whose turn it is chooses the order of simultaneous effects. These rules support a shared packet with an explicit ordering decision; they do not by themselves require every target's HP to be written at once. Sources checked through agent-reach/Jina Reader on 2026-09-06: [Playing the Game](https://www.dndbeyond.com/sources/dnd/br-2024/playing-the-game#DamageagainstMultipleTargets) and [Rules Glossary](https://www.dndbeyond.com/sources/dnd/br-2024/rules-glossary#SimultaneousEffects).

The first supported packet uses one damage type, static reviewed saves/defenses, and existing `action` or `none` costs. Spell slots, temporary HP, mixed packets, conditional defenses and complete zero-HP rules remain separate work; do not invent support or treat a free-text reason as executable rules.

## State machine

| State | Required behavior |
| --- | --- |
| `prepared` | Host reviews the source, target profiles, save inputs, defenses, damage formula and proposed target order. No dice, resource spending or game revision change. Obtain confirmation from the correct turn controller where required. |
| `collecting_saves` | Atomically commit the confirmed definition, spend the supported cost once, persist the common damage roll and acquire the campaign mechanical lock. Each target owner submits only parent/target/request IDs. Persist individual dice, modifiers, outcome and receipt; HP is unchanged during collection. |
| `applying_damage` | After every required save exists, process the confirmed order. Validate the current target and reviewed dependencies, apply the saved packet using its saved save, record the linked damage result and HP snapshot, and persist the stage cursor in the same transaction. |
| `waiting_concentration` | Retain the parent lock and unfinished target order while the existing concentration request resolves. Resume the parent at the next unfinished stage. Do not finish the encounter or advance the turn between targets in the committed action. |
| `review_required` | Stop for changed authority, profile or relevant dependency. Re-review preserves the common damage, spent cost and all existing dice/receipts. Any changed interpretation receives an explicit linked adjudication; it never overwrites an immutable roll receipt. |
| `completed` | All target damage and concentration follow-ups are settled. Clear the parent lock and run final encounter/turn/world completion once. Retrying any saved command returns its persisted result. |

Pre-commit cancellation changes no resources. Post-commit recovery must preserve known dice, completed outcomes and expenditure. It must not become an unrestricted cancel/refund/reroll path. If an actor or controller leaves, expose a host recovery decision that preserves evidence; do not let an absent player silently settle another player's save.

## Persisted authority

Separate the immutable definition from mutable progression. Suggested parent data:

```text
AreaIntent
  id, campaign, definitionHash, rulesVersion
  reviewer, sourceActorId, sourceOwner, sourceCharacterVersion
  mapId, turn, preparedRevision, committedRevision
  cost: action | none
  order: turnActorId, decidingOwner, confirmationReceipt, targetIds
  commonDamage: formula, damageType, dice, total, rollId
  targets[]:
    targetId, actorId, owner, characterVersion
    reviewedSave, reviewedDefenses, dependencyFingerprints
    saveReceiptId, damageResultId
  stage, nextTargetIndex, pendingConcentrationId
  resourceReceiptId, finalRevision

GameState.pendingAreaIntentId
Continuation: area_damage, intentId, definitionHash, nextTargetIndex
```

Each target approval binds to the definition and active parent lock, rather than equality with the original global revision. Sibling saves and valid pause/resume transitions cannot stale another target's approval. Recheck current membership, actor identity, character pin and required dependency fingerprints before new resolution or application. Saved receipt replay still requires current authorization.

Block movement, new unrelated actions, turn advancement, profile activation and unrelated concentration registration during collection/application. Keep authorized map/history reads and pause controls available. Paused play rejects new rolls and application while retaining committed receipt replay. The rules state uses game events and persisted continuations; Chronos remains development supervision, not a combat timer.

A first save receipt contains the saved d20 result and a parent damage link; it must not claim that HP has already changed. Later target damage has its own persisted result. Consumers fetch that result and the current audience-filtered map without reapplying HP or rolling. Every meaningful saved transition has a revision so players can request an exact map at each step.

Ordering confirmation must come from the correct controller and use an authorized projection. Do not reveal hidden targets, private DCs, reviews or other players' private sheets to offer a choice. If meaningful order selection cannot be exposed without disclosure, require an explicit reviewed rules decision with recorded authority; never silently substitute the host or network timing.

## Concentration and recovery seams

Current `concentrationDamage` supports one pending concentration record and rejects a second surviving concentrator with `PENDING`. Resolve target damage in the approved order and yield before attempting another pending concentration save. Use a stable packet origin such as `area_damage / intentId / targetId / ordinal`. The existing continuation validator rejects unknown kinds, so the new continuation must be explicitly validated, persisted and restored.

An earlier concentration result can invalidate a later target's reviewed defense. Enter `review_required` when a declared dependency changes, preserving all saved dice. The first supported static packet must reject mechanics it cannot represent rather than assume those defenses remain valid. A source or target reaching zero HP does not automatically cancel the rest of a committed area action.

Coordinate exact existing seams before edits:

- `store.mjs`: global pending guard, command dispatch, continuation drain and deferred final encounter/turn completion.
- `checks.mjs`: approved-stat and roll semantics. Use a dedicated parent-bound resolver; do not broaden ordinary `currentCheckRevision` to accept unrelated events.
- `concentration.mjs`: accepted origin, allowed commands during the parent action and continuation resumption.
- Storage/recovery owner: new records, incomplete-action validation and coherent restore with character approvals/images.
- HTTP/Discord/Play owners: host preparation, controller confirmation, owned pending saves, linked damage results and precise waiting/review states.

## Bounded implementation cards

1. **Definition and packet service.** Add dedicated files for exact request validation, immutable definition hashing, target approval snapshots and the single persisted damage packet. Keep existing single-target requests unchanged. Prove rejection before RNG and one expenditure/roll under duplicate commit/restart.
2. **Parent-bound target resolution.** Add the campaign lock and saved per-target results with an explicit parent transition. Prove opposite response orders, pause/resume, restart between responses, role revocation and exact replay. Save receipt content must accurately distinguish a saved roll from damage not yet applied.
3. **Ordered application and concentration.** Add the validated parent continuation and cursor, defer final encounter completion, and apply each target at most once. Prove two concentrating targets, earlier dependency invalidation, zero-HP handling and injected rollback at HP/receipt/snapshot boundaries.
4. **Consumer and recovery integration.** Mount preparation/confirmation/pending/results in coordinated HTTP, Discord and Play surfaces. Verify the real multiplayer journey and coherent restore of an unfinished action. Engine tests alone do not close this card.

The decisive acceptance fixture has two owned targets sharing one damage roll, responses in opposite orders, a restart between responses, repeated request IDs, concentration before the later target, and changed-defense recovery preserving saved dice. Inject failure during damage application to prove no partial HP, result, snapshot or cursor commit. Check the same packet and separate final HP through both private histories and exact revision maps. No area implementation is complete until this whole fixture and its consumer/recovery paths pass.
