# Architecture: RPG-Core D&D Stabilization and Integration

> Audit source: Citadel five-pass review of the local RPG-Core integration, legacy Station runtime, Discord client, and map/game harness.
> Date: 2026-09-09
> Repository: `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`
> Scope: repair the runtime needed for a playable D&D vertical slice while preserving RPG-Core content and editor workflows.

## Executive decision

The project should use a strangler architecture.

RPG-Core remains the content and Unity presentation source: ScriptableObject databases, Addressables, character prefabs, scene assets, editor tooling, and the existing visual pipeline remain valuable. Its legacy runtime is not safe to make the authoritative multiplayer/game-state boundary yet. The new integration runtime becomes authoritative for commands, state transitions, persistence, authorization, and Discord projections. Unity adapters translate between the typed runtime and the legacy Station APIs until each subsystem has a tested replacement.

The target flow is:

```text
Unity boot
  -> explicit composition root
  -> typed runtime host
  -> RPG-Core database/content adapter
  -> typed character/scene/state bridge
  -> authoritative command service
  -> immutable event/projection feed
  -> Discord/Web presentation clients
```

The first release target is deliberately narrow:

```text
create one player and one NPC
  -> load one Addressable zone
  -> project a 25x25 tactical map
  -> enforce a turn and faction stance
  -> resolve one typed attack
  -> defeat the NPC
  -> add loot to the player inventory
  -> save
  -> transition away and back
  -> reload
  -> prove HP, inventory, action bar, skills, passives, faction, scene, and spawner state
```

No legacy file is deleted until its replacement has equivalent or stronger tests. A pristine RPG-Core baseline must remain recoverable through a dedicated tag or branch.

## Current baseline and hard gates

### Evidence already established

- The local RPG-Core Unity project is pinned to Unity `2021.3.14f1`.
- The installed editor is Unity `6000.6.0f1`; Unity compile and play-mode validation are therefore still open.
- The additive headless integration harness passes 9 tests.
- The direct Discord/character test command passes 192 tests.
- The direct game/map test command passes 625 tests.
- ESLint passes.
- The package-manager wrapper currently fails before running tests because pnpm refuses ignored native build scripts. This is an environment/dependency-policy failure, not a source-test failure.
- The original Station source contains correctness blockers in vitals, faction mapping, team removal, skill ownership, passive abilities, equipment bonuses, critical-hit calculation, scene restore, and persistent spawner state.
- The Unity bootstrap currently creates a runtime but does not connect live Unity character instances and their events to the typed session or Discord boundary.

### Non-negotiable gates

1. Work only in the local project path above. Do not use or delete the OneDrive copy.
2. Keep the RPG-Core baseline recoverable before modifying legacy code.
3. Do not claim Unity readiness until the exact project-compatible editor compiles the project and runs EditMode and PlayMode tests.
4. Do not allow Discord or a browser client to mutate raw Unity objects or own authoritative combat state.
5. Every mutating command must carry an owner identity, command ID, expected revision, and typed payload.
6. Every accepted mutation must produce one durable revision and a typed event/receipt.
7. Failed commands must not partially spend HP, inventory, movement, actions, dice, or time.
8. All save/load fields required by the vertical slice must round-trip through restart and scene transition.

## File tree: new and modified files

This is the complete planned change surface for the stabilization effort. Existing files not listed here remain unchanged unless a phase records a newly discovered compatibility dependency.

```text
.
├── .planning/
│   └── architecture-rpg-core-stabilization.md                  [new]
├── RPG-Core/
│   ├── RPG_CORE_INTEGRATION_STATUS.md                          [modified]
│   ├── RpgIntegration.Tests/
│   │   ├── Program.cs                                          [modified]
│   │   ├── RpgIntegration.Tests.csproj                         [modified]
│   │   ├── TestVectors.cs                                       [new]
│   │   └── TestAssertions.cs                                    [new]
│   └── station/
│       ├── Assets/
│       │   ├── RpgIntegration/
│       │   │   ├── Contracts/
│       │   │   │   ├── CharacterContracts.cs                    [modified]
│       │   │   │   ├── CommandContracts.cs                      [new]
│       │   │   │   ├── EventContracts.cs                        [new]
│       │   │   │   ├── FactionContracts.cs                      [modified]
│       │   │   │   ├── InventoryContracts.cs                    [modified]
│       │   │   │   ├── SaveContracts.cs                         [modified]
│       │   │   │   └── StateContracts.cs                        [new]
│       │   │   ├── Dnd/
│       │   │   │   ├── DndCharacterBuilder.cs                   [modified]
│       │   │   │   ├── DndDefinitionValidator.cs                [new]
│       │   │   │   └── DndGameComposition.cs                    [new]
│       │   │   ├── Runtime/
│       │   │   │   ├── RuntimeServices.cs                       [modified]
│       │   │   │   ├── CommandAuthorization.cs                 [new]
│       │   │   │   ├── CombatService.cs                        [new]
│       │   │   │   ├── EventJournal.cs                          [new]
│       │   │   │   ├── SceneServices.cs                         [modified]
│       │   │   │   ├── SessionStateRepository.cs                [new]
│       │   │   │   ├── StateTransaction.cs                      [new]
│       │   │   │   ├── TurnService.cs                           [new]
│       │   │   │   ├── VerticalSliceSession.cs                  [modified]
│       │   │   │   └── RpgRuntimeHost.cs                        [new]
│       │   │   ├── Unity/
│       │   │   │   ├── RpgIntegrationBootstrap.cs               [modified]
│       │   │   │   ├── RpgCoreCharacterAdapter.cs               [modified]
│       │   │   │   ├── RpgCoreCharacterProjector.cs             [modified]
│       │   │   │   ├── RpgCoreDndDefinitionSource.cs            [modified]
│       │   │   │   ├── RpgCoreEventBridge.cs                    [new]
│       │   │   │   ├── RpgCoreLegacyGuards.cs                   [new]
│       │   │   │   ├── UnitySceneLoaderAdapter.cs               [modified]
│       │   │   │   └── UnityCoroutineTaskBridge.cs              [new]
│       │   │   └── Tests/
│       │   │       ├── EditMode/
│       │   │       │   ├── LegacyCombatTests.cs                 [new]
│       │   │       │   ├── LegacyFactionTests.cs                [new]
│       │   │       │   ├── LegacyInventoryTests.cs              [new]
│       │   │       │   ├── LegacySkillAndPassiveTests.cs        [new]
│       │   │       │   └── SaveStateTests.cs                    [new]
│       │   │       └── PlayMode/
│       │   │           ├── BootstrapSmokeTests.cs                [new]
│       │   │           ├── SceneTransitionTests.cs              [new]
│       │   │           ├── VerticalSlicePlayModeTests.cs        [new]
│       │   │           └── SpawnerPersistenceTests.cs           [new]
│       │   ├── RpgIntegration.Contracts.asmdef                  [modified]
│       │   ├── RpgIntegration.Runtime.asmdef                    [modified]
│       │   ├── RpgIntegration.Unity.asmdef                      [modified]
│       │   └── RpgIntegration.Tests.asmdef                      [new]
│       └── Assets/Rpg/                                          [legacy files repaired in controlled phases]
│           ├── BaseCharacter.cs                                 [modified]
│           ├── Characters/BaseCharacter.cs                      [modified]
│           ├── Characters/ActionHandler.cs                     [modified]
│           ├── Characters/Builders/PlayerCharacterBuilder.cs    [modified]
│           ├── Characters/Equipment/EquipmentHandler.cs         [modified]
│           ├── Characters/Skills/SkillHandler.cs                [modified]
│           ├── Characters/Stats/StatsHandler.cs                 [modified]
│           ├── Characters/TeamSystem.cs                         [modified]
│           ├── Characters/CharacterCalculation.cs               [modified]
│           ├── Faction/DefaultFactionHandler.cs                 [modified]
│           ├── Scenes & area/RPGSceneSystem.cs                  [modified]
│           ├── Spawner/PersistantSceneSpawner.cs                [modified]
│           └── RpgModels.cs                                     [modified only if combat fix cannot stay in adapter]
├── raphael-council/
│   ├── .env.example                                             [modified]
│   ├── bridge/
│   │   ├── rpg-runtime-client.mjs                               [new]
│   │   └── rpg-runtime-protocol.mjs                             [new]
│   ├── discord/
│   │   ├── bot.mjs                                              [modified]
│   │   ├── board-delivery.mjs                                   [modified]
│   │   ├── adventure-adapter.mjs                                [modified]
│   │   └── rpg-projection-adapter.mjs                           [new]
│   ├── game/
│   │   ├── store.mjs                                            [modified only to consume bridge receipts]
│   │   └── rpg-bridge-boundary.test.mjs                         [new]
│   └── package.json                                             [modified only if a bridge/test script is required]
└── PROJECT_ACCEPTANCE_MATRIX.md                                 [modified]
```

The legacy files listed under `Assets/Rpg` are repaired in place only after the baseline tag, compatibility tests, and rollback procedure exist. They are never deleted as part of this plan.

## Component breakdown

### 1. Contracts assembly

**Purpose:** Define stable, serializable, engine-independent types. No Unity APIs, reflection, global events, Discord types, or `object[]` payloads.

**Responsibilities:**

- Character creation requests and immutable character snapshots.
- Command envelopes and typed command payloads.
- Error codes and success/failure result types.
- Combat requests/results, including attack roll, critical flag, damage, target health, and defeat state.
- Inventory transaction requests/results with capacity and stack outcomes.
- Faction disposition and explicit missing/neutral behavior.
- Save schema with version, revision, scene, characters, inventories, effects, action bars, skills, passives, equipment, and spawners.
- Event envelopes with event ID, command ID, revision, actor, owner, event type, and typed payload.

**Complexity:** High. This is the compatibility seam for every later subsystem.

### 2. Runtime assembly

**Purpose:** Own authoritative game state and state transitions without Unity.

**Responsibilities:**

- Validate commands.
- Authorize ownership, host/DM privileges, current turn, phase, scene, target visibility, and revision.
- Apply each mutation atomically.
- Persist accepted commands/events.
- Return deterministic receipts for retries.
- Publish projections, not mutable domain objects.
- Provide deterministic injectable RNG for tests and a production RNG implementation.

**Complexity:** High.

### 3. D&D rules/content assembly

**Purpose:** Translate RPG-Core database content into typed D&D definitions.

**Responsibilities:**

- Resolve player class and NPC definitions.
- Resolve stable IDs for abilities, skills, passives, factions, vitals, equipment, and Addressables.
- Validate definitions before character creation.
- Normalize invalid/missing data into typed error codes rather than silently inventing content.
- Cache immutable definitions after database readiness and invalidate on explicit content reload.

**Complexity:** Medium/high.

### 4. Unity adapter assembly

**Purpose:** Adapt Unity lifecycle, Addressables, scenes, prefabs, and legacy Station APIs to the typed runtime.

**Responsibilities:**

- Provide the only allowed use of `StationMechanics`, legacy builders, reflection, global events, and `object[]` payloads.
- Initialize players with full default vitals when no save exists.
- Verify configured mechanics actually instantiate characters; fail with a typed error if the base implementation returns null.
- Project live `BaseCharacter` state into deep-copied typed snapshots.
- Convert Unity coroutine/Addressables completion into safe asynchronous results without blocking the main thread.
- Subscribe/unsubscribe legacy events deterministically.
- Translate live state changes into typed events for the runtime host.

**Complexity:** High.

### 5. Discord bridge and presentation

**Purpose:** Make Discord an input/output client, not a second game engine.

**Responsibilities:**

- Submit typed commands with authenticated owner identity and expected revision.
- Display current projections, combat breakdown, actor turns, map images, inventory, character threads, and save/load receipts.
- Never accept client-supplied HP, faction, dice result, target authority, or action cost.
- Retry immutable receipts without rerolling or repeating mutations.
- Use a separate bridge secret, not the Discord bot token, for encrypted private delivery credentials.

**Complexity:** Medium/high.

### 6. Test and verification layer

**Purpose:** Make every critical behavior reproducible outside live Discord.

**Responsibilities:**

- Share canonical test vectors between the standalone C# harness and Unity tests.
- Test pure rules without Unity.
- Test Unity adapters in EditMode.
- Test scene loading, bootstrap, Addressables, spawners, and event projection in PlayMode.
- Test Discord boundary behavior against deterministic bridge fixtures.

**Complexity:** High but essential.

## Authoritative data model

### Command envelope

```text
CommandEnvelope
  commandId: string                  unique retry identity
  ownerId: string                    authenticated Discord/player identity
  actorId: string                    character acting, if applicable
  expectedRevision: long             optimistic concurrency fence
  kind: CommandKind                  typed enum/string schema ID
  payload: typed object               validated before mutation
  issuedAt: timestamp
```

Supported initial command kinds:

- `CreateCharacter`
- `LoadZone`
- `BeginTurn`
- `Move`
- `Attack`
- `UseAbility`
- `Loot`
- `SaveCharacter`
- `ReloadCharacter`
- `EndTurn`

### Game state

```text
RpgGameState
  schemaVersion: int
  campaignId: string
  revision: long
  currentSceneId: string
  phase: Exploration | Combat | Paused | Transitioning | Complete
  round: int
  activeActorId: string
  characters: map<string, CharacterState>
  inventories: map<string, InventoryState>
  equipment: map<string, EquipmentState>
  spawners: map<string, SpawnerState>
  effects: list<EffectState>
  pendingCommand: PendingCommandState?
  consumedCommandIds: map<string, CommandReceipt>
```

### Character state

```text
CharacterState
  characterId: string
  ownerId: string?
  characterType: Player | Npc
  displayName: string
  raceId: string
  classId: string
  genderId: string
  factionId: string
  primaryHealth: int
  primaryHealthMaximum: int
  secondaryHealth: int
  secondaryHealthMaximum: int
  skillRanks: map<string, int>
  passiveAbilityIds: list<string>
  actionBarBindings: map<int, string>
  position: GridPosition
  defeated: bool
  revision: long
```

### Combat result

```text
CombatResult
  commandId: string
  attackerId: string
  targetId: string
  attackRoll: int
  hit: bool
  critical: bool
  criticalChancePercent: int
  baseDamage: int
  damageMultiplier: int
  finalDamage: int
  targetHealthBefore: int
  targetHealthAfter: int
  targetDefeated: bool
  failure: ErrorCode?
```

The rule is explicit: a normalized roll in `[0, 99]` is critical when `roll < criticalChancePercent`. The critical flag is persisted in the result and receipt.

### Inventory transaction

```text
InventoryState
  ownerCharacterId: string
  slotCapacity: int
  stackCapacity: int
  items: ordered list<ItemStack>
  currencies: map<string, long>
  revision: long
```

Every add/remove operation runs against a working clone, validates the entire result, and commits once. A failed transaction leaves the original byte-for-byte equivalent.

### Save schema

The save must persist:

- schema version and campaign ID;
- save revision and last committed command ID;
- current scene and party positions;
- all player and NPC character identity fields;
- current and maximum primary/secondary vitals;
- skills and progression;
- passive abilities;
- active abilities and action-bar bindings;
- equipment and equipment-derived bonuses;
- per-character inventories and currencies;
- spawner identity, spawn definition, position, alive/defeated status, and character state;
- active effects, their source, target, expiry, and remaining payload;
- pending transition/turn state if a save occurs between steps.

Null collections are normalized at deserialization. Unknown future fields are ignored only when schema compatibility permits; unknown schema versions fail closed with a migration error.

## Key decisions and rejected alternatives

### Decision 1: authoritative typed runtime outside Unity

- **Chosen:** Keep authoritative command/state/persistence logic in plain C# and use Unity as an adapter/view host.
- **Why:** It is testable without an editor, makes Discord and browser behavior deterministic, and removes static/global Unity state from the multiplayer boundary.
- **Rejected:** Let Discord call Unity components directly. This preserves legacy coupling, makes retries unsafe, and cannot enforce authority consistently.
- **Rejected:** Keep the current JavaScript-only game authoritative. It already has substantial presentation/test value but would duplicate RPG-Core data and rules.

### Decision 2: explicit composition root

- **Chosen:** `RpgRuntimeHost` owns construction and dependency registration; `RpgIntegrationBootstrap` only creates the host once and supplies Unity adapters.
- **Why:** Startup becomes inspectable, testable, and deterministic.
- **Rejected:** Reflection-created global systems and static event discovery. They hide initialization order and cause null-reference failures.

### Decision 3: optimistic concurrency plus durable command receipts

- **Chosen:** Every mutation requires `commandId` and `expectedRevision`; committed receipts are replayed for the same command ID.
- **Why:** Discord retries, duplicate clicks, browser reconnects, and concurrent players become safe without rerolling or double-spending.
- **Rejected:** UI-only disabled buttons. They do not protect copied, delayed, forged, or retried controls.

### Decision 4: patch legacy defects before replacing the full subsystem

- **Chosen:** Repair high-impact legacy paths behind typed adapters and retain the original baseline/tag.
- **Why:** It gets the vertical slice playable while preserving content and reducing the size of the rewrite.
- **Rejected:** Rewrite all Unity runtime systems before proving one slice. That creates a large unvalidated project and discards useful editor behavior.

### Decision 5: one canonical state projection

- **Chosen:** Unity and Discord consume deep-copied immutable projections from the same authoritative state/event stream.
- **Why:** It prevents mutable DTOs from bypassing revisions and makes private/public filtering explicit.
- **Rejected:** Expose `CharacterSnapshot` objects directly through `IReadOnlyDictionary`. The dictionary is read-only, but its values are mutable.

### Decision 6: exact Unity version first, upgrade second

- **Chosen:** Validate under Unity `2021.3.14f1` before considering an isolated Unity 6 upgrade branch.
- **Why:** The project is pinned to the older editor and the current Unity 6 open attempt hit package-manager compatibility/locking behavior.
- **Rejected:** Claim compatibility from the installed Unity 6 binary alone.

## Detailed implementation phases

### Phase 0: Baseline, recovery, and audit ledger

**Goal:** Establish a reproducible starting point and protect the original project.

**Files:**

- `PROJECT_ACCEPTANCE_MATRIX.md`
- `RPG-Core/RPG_CORE_INTEGRATION_STATUS.md`
- `RPG-Core/RpgIntegration.Tests/Program.cs`
- `RPG-Core/RpgIntegration.Tests/TestVectors.cs`
- `RPG-Core/RpgIntegration.Tests/TestAssertions.cs`

**Work:**

1. Create a git tag or protected branch named `rpg-core-pristine-8512d890` at the imported baseline.
2. Record Unity version, package lock state, package-manager policy, installed editor paths, and test commands.
3. Export current standalone test output into a dated local audit record.
4. Convert the existing vertical-slice test inputs into shared canonical vectors.
5. Record each Citadel critical finding as an issue ID with severity, owner subsystem, and blocking phase.
6. Separate “local test passes” from “Unity/live Discord acceptance” in the acceptance matrix.

**End conditions:**

- [ ] The pristine tag resolves and can be checked out in a disposable clone.
- [ ] The 9 C# tests, 192 Discord/character tests, 625 game/map tests, and ESLint result are recorded.
- [ ] No source, save, or art data is stored in OneDrive by the implementation workflow.
- [ ] Shared test vectors produce the same expected combat, faction, inventory, and save outcomes in the standalone harness.

### Phase 1: Contract and state safety foundation

**Goal:** Remove unsafe mutable/untyped boundaries before repairing behavior.

**Files:**

- `Contracts/CommandContracts.cs`
- `Contracts/EventContracts.cs`
- `Contracts/StateContracts.cs`
- `Contracts/CharacterContracts.cs`
- `Contracts/InventoryContracts.cs`
- `Contracts/SaveContracts.cs`
- `Runtime/RuntimeServices.cs`
- `Runtime/SessionStateRepository.cs`
- `Runtime/StateTransaction.cs`
- `Runtime/EventJournal.cs`
- `Dnd/DndCharacterBuilder.cs`

**Work:**

1. Add typed command/result/error contracts.
2. Add explicit validation for null requests, IDs, negative quantities, invalid health, duplicate IDs, invalid action slots, and unsupported character types.
3. Make snapshots and projections immutable from callers’ perspective. Internally use mutable domain state, but return copies or read-only value records.
4. Add `SessionStateRepository` with one commit boundary and one revision increment per accepted mutation.
5. Add `EventJournal` with command ID deduplication and replayable receipts.
6. Normalize save collections on load and deep-clone nested records.
7. Preserve atomic inventory behavior while replacing repeated public mutable state exposure.
8. Make character creation reject duplicate IDs rather than overwriting.

**End conditions:**

- [ ] Null character requests return typed failures instead of throwing from registry lookup.
- [ ] Duplicate creation is rejected without changing existing character or inventory state.
- [ ] A caller cannot mutate runtime state through a returned projection.
- [ ] Replaying the same command ID returns the original receipt and does not increment revision.
- [ ] Failed inventory operations leave all fields unchanged.
- [ ] Standalone tests pass with no new warnings.

### Phase 2: Repair core rules and character initialization

**Goal:** Make the rules required by the vertical slice correct in the original runtime and typed runtime.

**Files:**

- `Assets/Rpg/Characters/Stats/StatsHandler.cs`
- `Assets/Rpg/Characters/CharacterCalculation.cs`
- `Assets/Rpg/RpgModels.cs` if required by the damage path
- `Assets/Rpg/Characters/Skills/SkillHandler.cs`
- `Assets/Rpg/Characters/ActionHandler.cs`
- `Assets/Rpg/Characters/Equipment/EquipmentHandler.cs`
- `Assets/Rpg/Characters/Builders/PlayerCharacterBuilder.cs`
- `Assets/Rpg/Characters/Builders/DefaultNpcBuilder.cs`
- `Assets/Rpg/Characters/BaseCharacter.cs`
- `Assets/Rpg/Faction/DefaultFactionHandler.cs`
- `Assets/Rpg/Characters/TeamSystem.cs`
- `Assets/RpgIntegration/Unity/RpgCoreCharacterAdapter.cs`
- `Assets/RpgIntegration/Unity/RpgCoreCharacterProjector.cs`
- `Assets/RpgIntegration/Dnd/DndCharacterBuilder.cs`

**Work:**

1. Register secondary health as `SecondaryHealth`, and add tests proving primary and secondary values remain independent.
2. Normalize critical-hit probability once. Set `IsCritical` explicitly. Test 0%, 1%, 50%, 99%, and 100% thresholds.
3. Validate base damage, critical multiplier, target health, defeated status, and damage saturation.
4. Assign `SkillHandler._owner` during setup and make skill add/remove events safe.
5. Implement passive ability setup, removal, and reapplication after load.
6. Return actual equipment bonuses from the three equipment getters and recalculate dependent stats exactly once per equipment change.
7. Map neutral before ally/enemy and define missing faction behavior as explicit neutral or typed configuration failure.
8. Change team removal to remove the character and make repeated removal idempotent.
9. Initialize new player vitals to full defaults when `VitalStatus` is absent; initialize NPC vitals consistently.
10. Normalize stable action-bar IDs; never use display text as a runtime identifier.
11. Return typed projection errors when required vital state is absent instead of converting exceptions to zero.

**End conditions:**

- [ ] Primary and secondary health tests pass independently.
- [ ] Critical-hit threshold tests pass for every boundary.
- [ ] Neutral, ally, and enemy stance tests pass, including missing faction IDs.
- [ ] Skills can be added and removed without null-reference errors.
- [ ] Passive abilities survive setup, save, load, and reapplication.
- [ ] Equipment bonuses affect derived stats and vitals.
- [ ] Team removal actually removes the character.
- [ ] New players begin with valid full vital state.
- [ ] The pristine baseline remains recoverable even if the repaired legacy branch is rolled back.

### Phase 3: Turn, combat, and authorization services

**Goal:** Prevent arbitrary or out-of-turn mutations and make combat authoritative.

**Files:**

- `Runtime/CommandAuthorization.cs`
- `Runtime/CombatService.cs`
- `Runtime/TurnService.cs`
- `Runtime/VerticalSliceSession.cs`
- `Runtime/RpgRuntimeHost.cs`
- `Contracts/CommandContracts.cs`
- `Contracts/EventContracts.cs`
- `RpgIntegration.Tests/Program.cs`

**Work:**

1. Require an authenticated `ownerId` for player commands.
2. Allow host/DM commands only through explicit role capability.
3. Map each player character to its owner and reject foreign actor IDs.
4. Reject attacks when the attacker is defeated, the target is defeated, the scene is not active, the phase is wrong, the actor is not active, or the revision is stale.
5. Reject ally attacks and resolve missing faction configuration according to the explicit faction policy.
6. Make all RNG injectable and persist the exact roll in the command receipt.
7. Add turn start/end events and deterministic skipping of defeated actors.
8. Ensure combat, defeat, loot availability, and turn advancement commit in one transaction when required.
9. Expose projections only after commit.
10. Add bounded command payload sizes and allowlists for action IDs.

**End conditions:**

- [ ] Forged owner, actor, turn, target, and revision inputs produce no state change.
- [ ] Same command ID cannot reroll or double-apply damage.
- [ ] Attacks against allies, dead targets, or out-of-turn actors are rejected.
- [ ] Combat receipts expose exact roll, critical result, damage, and target health transition.
- [ ] Turn state remains correct when an actor is defeated.
- [ ] All headless combat/authorization tests pass.

### Phase 4: Scene loading, bootstrap, and dependency graph

**Goal:** Replace implicit startup and blocking scene operations with explicit, safe lifecycle control.

**Files:**

- `Runtime/SceneServices.cs`
- `Runtime/RpgRuntimeHost.cs`
- `Unity/RpgIntegrationBootstrap.cs`
- `Unity/UnitySceneLoaderAdapter.cs`
- `Unity/UnityCoroutineTaskBridge.cs`
- `Assets/Rpg/Scenes & area/RPGSceneSystem.cs`

**Work:**

1. Make `LoadZoneAsync` the only Unity-facing scene-load path.
2. Remove `GetAwaiter().GetResult()` from Unity execution paths.
3. Wrap Addressables/SceneManager operations in a coroutine or completion-source bridge that resumes safely on the Unity main thread.
4. Track the active load operation and ensure timeout/cancellation cannot publish a false loaded scene.
5. Explicitly dispose or release failed/abandoned Addressables handles.
6. Replace reflection/global system discovery in the integration bootstrap with constructor-created services and registered adapters.
7. Add startup guards for missing save data, empty player saves, invalid last-zone IDs, missing loading-screen assets, and missing scene definitions.
8. Keep a single persistent runtime host across scene transitions.
9. Make bootstrap register the character adapter, scene adapter, projection bridge, event journal, and command endpoint.
10. Fail early when `StationMechanics.InstantiateCharacter` is not overridden/configured instead of returning null silently.

**End conditions:**

- [ ] A scene load completes without blocking the Unity main thread.
- [ ] Timeout returns a failure and does not later publish a success event.
- [ ] Missing save data enters character creation safely.
- [ ] Invalid saved zone returns a recoverable error.
- [ ] Bootstrap creates exactly one runtime host and survives a scene transition.
- [ ] Unity EditMode bootstrap and scene-service tests pass.

### Phase 5: Live character bridge and state projection

**Goal:** Connect the typed runtime to real RPG-Core objects without leaking legacy state to clients.

**Files:**

- `Unity/RpgCoreCharacterAdapter.cs`
- `Unity/RpgCoreCharacterProjector.cs`
- `Unity/RpgCoreEventBridge.cs`
- `Unity/RpgCoreLegacyGuards.cs`
- `Unity/RpgIntegrationBootstrap.cs`
- `Contracts/StateContracts.cs`

**Work:**

1. Build a typed `CharacterBuildContext` internally, then translate to the legacy payload in one adapter method only.
2. Validate race, gender, class, NPC, faction, prefab, ability, and skill IDs before touching Unity objects.
3. Initialize all player fields, including full vitals, faction, skills, passives, active abilities, and action-bar IDs.
4. Subscribe to legacy damage, death, skill, equipment, and action events through `RpgCoreEventBridge`.
5. Unsubscribe on character destruction and scene unload.
6. Project only deep-copied state records; never expose `BaseCharacter`, `Vital`, `RuntimeAbility`, or legacy collections.
7. Use stable IDs from database entries, never display names.
8. Detect and report missing/invalid vital state instead of returning zero.
9. Reconcile live Unity state to authoritative runtime state at explicit boundaries; do not allow unsolicited Unity changes to silently bypass a command receipt.
10. Define conflict handling when an external legacy event arrives without a matching command ID: reject, quarantine, or record as a host/system event according to policy.

**End conditions:**

- [ ] Creating a player produces one live Unity character and one typed projection with matching identity, vitals, skills, passives, faction, and action bar.
- [ ] Creating an NPC produces stable ability IDs and faction data.
- [ ] Damage/death/equipment events produce typed projections and revisions.
- [ ] Destroying/unloading a character removes all subscriptions.
- [ ] No Unity object or mutable legacy collection crosses the bridge boundary.

### Phase 6: Inventory, equipment, loot, and spawner persistence

**Goal:** Make the complete state needed for loot and reload durable and per-character.

**Files:**

- `Contracts/InventoryContracts.cs`
- `Contracts/SaveContracts.cs`
- `Runtime/RuntimeServices.cs`
- `Runtime/SessionStateRepository.cs`
- `Assets/Rpg/Items/Container/Systems/PlayerInventorySystem.cs`
- `Assets/Rpg/Items/Container/ItemContainer.cs`
- `Assets/Rpg/Characters/Equipment/EquipmentHandler.cs`
- `Assets/Rpg/Characters/BaseCharacter.cs`
- `Assets/Rpg/Spawner/PersistantSceneSpawner.cs`
- `Assets/Rpg/SaveModules/SpawnerSave.cs`
- `Unity/RpgCoreCharacterProjector.cs`

**Work:**

1. Implement per-character inventories; do not silently fall back to a shared container.
2. Normalize new container state before constructing an `ItemContainer`.
3. Enforce stack capacity, slot capacity, quantity bounds, and item allowlists.
4. Make loot a command authorized to the acting character and current defeated target/encounter.
5. Serialize equipment and recompute equipment bonuses on load.
6. Implement `BaseCharacter.GetState()` with entity ID, type, position, rotation, vitals, faction, and relevant runtime identity.
7. Make persistent spawner save/restore idempotent and keyed by stable spawn identity.
8. Replace unfinished random spawning with a deterministic, seedable selection path for tests and a production seed recorded in state.
9. Ensure a failed save cannot clear or partially rewrite spawner/inventory state.

**End conditions:**

- [ ] Two players have isolated inventories.
- [ ] Stacking and capacity boundaries pass.
- [ ] Failed add/remove transactions produce no partial mutation.
- [ ] Equipment changes survive save/load and affect derived values.
- [ ] Spawner state survives scene unload/reload with identity and position intact.
- [ ] Random spawn tests are reproducible from a saved seed.

### Phase 7: Save schema, migration, and recovery

**Goal:** Make saves versioned, complete, atomic, and recoverable.

**Files:**

- `Contracts/SaveContracts.cs`
- `Contracts/StateContracts.cs`
- `Runtime/SessionStateRepository.cs`
- `Runtime/EventJournal.cs`
- `Runtime/StateTransaction.cs`
- `RpgIntegration.Tests/Program.cs`
- `Unity/Tests/EditMode/SaveStateTests.cs`
- `Unity/Tests/PlayMode/SpawnerPersistenceTests.cs`

**Work:**

1. Introduce explicit save schema versions.
2. Add migrations for current local save shapes.
3. Save through a temporary record and atomic replacement/checksum path.
4. Store command/event revision and last receipt so retries after restart are safe.
5. Persist all fields listed in the save schema, including current vitals, passive abilities, skills, action bar, equipment, per-character inventories, scene, effects, and spawners.
6. Validate semantic consistency before accepting a save: duplicate IDs, negative health, invalid references, impossible revisions, missing owners, and unknown ability IDs.
7. Restore in dependency order: definitions, characters, vitals, skills/passives, equipment, inventory, effects, spawners, turn/scene state, projections.
8. If a save is invalid, preserve the prior known-good save and return a typed recovery error.

**End conditions:**

- [ ] Save/load round trips preserve every vertical-slice field.
- [ ] Restart recovery replays a committed command without rerolling.
- [ ] Invalid saves fail closed without destroying the previous save.
- [ ] Schema migration tests cover the existing local save format.
- [ ] Unity PlayMode can unload/reload a zone and restore the same state.

### Phase 8: Discord bridge integration

**Goal:** Connect the existing Discord experience to the authoritative runtime while retaining its tested presentation behavior.

**Files:**

- `raphael-council/bridge/rpg-runtime-client.mjs`
- `raphael-council/bridge/rpg-runtime-protocol.mjs`
- `raphael-council/discord/bot.mjs`
- `raphael-council/discord/board-delivery.mjs`
- `raphael-council/discord/adventure-adapter.mjs`
- `raphael-council/discord/rpg-projection-adapter.mjs`
- `raphael-council/game/store.mjs`
- `raphael-council/game/rpg-bridge-boundary.test.mjs`
- `raphael-council/.env.example`

**Work:**

1. Define a versioned bridge protocol for projections, commands, receipts, health, and restart status.
2. Add request signing with a dedicated `RAPHAEL_GAME_BRIDGE_SECRET`; do not derive encryption keys from `DISCORD_TOKEN`.
3. Submit command envelopes with Discord owner identity and expected revision.
4. Translate typed runtime events into the existing map/card/thread presentation model.
5. Keep detailed character threads private and keep shared-channel cards limited to authorized public projection data.
6. Preserve all existing stale-control, copied-control, membership, channel, origin, and receipt protections.
7. Make retries fetch the same receipt and never submit a new random roll automatically.
8. Make the tactical map use the authoritative map projection and render generated art only as a visual layer.
9. Add health/readiness reporting that clearly distinguishes headless runtime, Unity bridge, Obus, Discord login, and campaign readiness.
10. Keep the old JavaScript campaign path disabled as authoritative gameplay; it may remain as a fixture or fallback only when explicitly selected.

**End conditions:**

- [ ] Discord commands cannot change state without runtime authorization.
- [ ] Private character data is filtered by owner and campaign membership.
- [ ] Map updates show current actors, terrain, effects, round, and active turn.
- [ ] A lost Discord response can be recovered from the immutable receipt.
- [ ] The same attack is never rerolled by delivery retry.
- [ ] Bridge tests pass with Unity unavailable and with simulated Unity receipts.

### Phase 9: Unity vertical slice and long-run verification

**Goal:** Prove the complete flow in the actual Unity project and across scene transitions.

**Files:**

- `Unity/Tests/PlayMode/BootstrapSmokeTests.cs`
- `Unity/Tests/PlayMode/SceneTransitionTests.cs`
- `Unity/Tests/PlayMode/VerticalSlicePlayModeTests.cs`
- `Unity/Tests/PlayMode/SpawnerPersistenceTests.cs`
- `PROJECT_ACCEPTANCE_MATRIX.md`
- `RPG-Core/RPG_CORE_INTEGRATION_STATUS.md`

**Work:**

1. Run under Unity `2021.3.14f1` first.
2. Boot an empty scene and verify the explicit composition root.
3. Resolve a player class, race, gender, skills, passives, faction, and Addressable prefab.
4. Resolve an NPC and verify stable identity/action IDs.
5. Load one zone asynchronously.
6. Render/project the 25x25 tactical map with top-down visual art beneath the authoritative grid.
7. Start combat and verify turn ownership.
8. Resolve a critical and a normal attack with deterministic test RNG.
9. Defeat the NPC, create loot, and add it to the player’s isolated inventory.
10. Save, unload the zone, load another scene, return, and reload.
11. Verify current HP, secondary health, faction, skills, passives, action bar, equipment, inventory, scene, spawner state, round, and receipt history.
12. Repeat the same commands through Discord/Web fixtures and verify projection equivalence.
13. Run a soak test with repeated scene transitions and command retries.

**End conditions:**

- [ ] Unity EditMode tests pass.
- [ ] Unity PlayMode tests pass.
- [ ] The full vertical slice survives a real scene transition and process restart.
- [ ] Discord/Web projections match the authoritative runtime state.
- [ ] No critical audit finding remains open.
- [ ] Acceptance ledger distinguishes verified, partial, and blocked items with evidence paths.

### Phase 10: Classification and controlled rollout

**Goal:** Decide what remains on RPG-Core and what is replaced, based on measured evidence.

**Work:**

1. Run the same contract vectors against repaired legacy paths and typed replacements.
2. Classify every subsystem:
   - `retain` when it passes tests and has acceptable lifecycle behavior;
   - `repair` when a localized defect is fixed and regression-tested;
   - `wrap` when useful content exists but the API remains unsafe or untyped;
   - `rewrite` when lifecycle, authority, persistence, or concurrency cannot be made reliable locally.
3. Produce a migration report with evidence, performance observations, and rollback path.
4. Keep the pristine baseline and repaired branch available until one full campaign has completed.
5. Only then consider an isolated Unity 6 upgrade branch.

**End conditions:**

- [ ] Every subsystem has one classification and an owner.
- [ ] No deleted legacy source lacks an equivalent passing test.
- [ ] A rollback from the typed runtime to the last known-good checkpoint is documented and tested.
- [ ] Unity version migration, if attempted, is a separate branch with its own compile/play-mode evidence.

## Phase dependency graph

```text
Phase 0 Baseline
  -> Phase 1 Contracts/state safety
  -> Phase 2 Legacy rule repairs
  -> Phase 3 Turn/combat/authorization
  -> Phase 4 Scene/bootstrap lifecycle
  -> Phase 5 Live Unity bridge
  -> Phase 6 Inventory/equipment/spawners
  -> Phase 7 Save/migration/recovery
  -> Phase 8 Discord bridge
  -> Phase 9 Unity vertical slice
  -> Phase 10 Classification/rollout
```

Safe parallel work after Phase 1:

```text
Phase 2  ||  Phase 6 contract-focused inventory work  ||  Phase 8 bridge fixture work
       -> Phase 3
Phase 3 + Phase 4
       -> Phase 5
Phase 5 + Phase 6 + Phase 7
       -> Phase 8 production connection
       -> Phase 9
```

Phase 9 is the release gate. No live campaign should be treated as running on the repaired architecture before Phase 9 succeeds.

## Fix matrix by audited defect

| Defect | Corrective action | Phase | Verification |
|---|---|---:|---|
| Scene load deadlock | Async/coroutine bridge; remove blocking wait | 4 | PlayMode scene test |
| Null character request | Validate before dictionary lookup | 1 | Unit test |
| Duplicate character overwrite | Reject or explicit revisioned replace | 1 | State transaction test |
| Player vitals absent | Initialize full defaults or load explicit saved values | 2/5 | Character creation test |
| Unity bootstrap disconnected | Register host, adapters, projections, event bridge | 4/5 | Bootstrap smoke test |
| Secondary health registered as primary | Correct enum and add independent vital tests | 2 | EditMode stats test |
| Team removal adds member | Replace add with remove and make idempotent | 2 | Team test |
| Skill owner missing | Assign owner during setup | 2 | Skill event test |
| Neutral stance unreachable | Check neutral before ally mapping | 2 | Faction matrix test |
| Missing persistent character state | Serialize identity/transform/vitals/state | 6/7 | Spawner PlayMode test |
| Unknown faction null dereference | Validate before same-faction lookup | 2 | Missing faction test |
| Passive abilities empty | Implement setup/reapply/remove | 2/7 | Save/load passive test |
| Equipment getters zero | Return cached maps and recalculate dependencies | 2/6 | Equipment stat test |
| Critical comparison inverted | Normalize roll and persist flag | 2/3 | Boundary probability test |
| Unsafe saved-zone restore | Guard empty/missing save and invalid scene | 4/7 | Startup recovery test |
| NPC display names as IDs | Resolve stable ability IDs | 2/5 | Definition test |
| Mutable projections | Deep copies/immutable records | 1/5 | Mutation isolation test |
| Arbitrary attack API | Owner/turn/phase/revision authorization | 3 | Forged command test |
| Null save collections | Normalize on deserialize and clone | 1/7 | Malformed save test |
| Per-character inventory absent | Allocate keyed containers and persist them | 6/7 | Two-player isolation test |
| Legacy object arrays | Contain translation in one Unity adapter | 5 | Boundary inspection/test |
| Raw exception disclosure | Stable error codes and sanitized logs | 2/8 | Error projection test |
| Inventory clone overhead | Single transaction clone/commit; profile before optimizing further | 1/6 | Allocation/performance test |
| Bot token used as bridge key | Add dedicated rotatable bridge secret | 8 | Configuration/security test |

## Risk register

1. **Unity version incompatibility:** Unity 6 may change Addressables, serialization, or package behavior. Mitigation: validate under 2021.3.14f1 first; isolate any Unity 6 migration branch.
2. **Regression in existing functionality:** RPG-Core has broad editor/content behavior. Mitigation: preserve baseline tag, add EditMode coverage before each legacy edit, and run the existing standalone suites after every phase.
3. **Dual state authorities:** Unity and the new runtime may diverge. Mitigation: make the typed runtime authoritative and treat Unity changes without command receipts as quarantined/system events.
4. **Async scene race:** A timed-out load may finish later. Mitigation: operation IDs, cancellation-aware completion gates, handle release, and a scene revision fence.
5. **Save corruption:** A partial write could destroy the last good campaign. Mitigation: atomic save replacement, checksum/schema validation, backup retention, and restore tests.
6. **Discord duplicate delivery:** Interaction retries may repeat a mutation. Mitigation: command IDs, durable receipts, and no reroll-on-retry policy.
7. **Legacy global events:** Static events may fire after unload or duplicate subscriptions. Mitigation: explicit subscription registry, lifecycle tests, and cleanup assertions.
8. **Content ID drift:** Display names or renamed ScriptableObjects may break saves. Mitigation: stable IDs, alias/migration tables, and definition validation.
9. **Concurrency:** Two players may issue commands against the same revision. Mitigation: optimistic concurrency, serialized commit, and stale-command rejection.
10. **Hidden security boundary:** A client may submit a valid-looking character/target ID belonging to another owner. Mitigation: authorize against server-side ownership and visibility before any lookup or projection.
11. **Performance regression:** Deep copies and map rendering may become expensive with large parties/maps. Mitigation: revision-based caching, bounded projections, and measured allocation tests after correctness is stable.
12. **Test drift:** Standalone, Unity, and Node tests may encode different rules. Mitigation: shared canonical vectors and a release gate requiring all three layers to agree.
13. **Package-manager policy failure:** pnpm may refuse native build scripts. Mitigation: document approved dependency policy separately and run direct test binaries in CI only after the policy is explicitly reviewed.
14. **Unfinished legacy subsystems:** AI, random spawning, interaction, and equipment may expand scope. Mitigation: block only the vertical-slice dependencies first; classify nonessential systems as follow-up retain/repair/wrap/rewrite work.

## Performance and observability plan

Measure only after correctness gates pass.

Required metrics:

- command validation latency;
- commit latency;
- scene load duration and timeout count;
- projection generation time;
- inventory transaction allocations;
- map render time and output size;
- event journal growth;
- save/load duration;
- duplicate/replayed command count;
- stale revision rejection count;
- Unity bridge errors by adapter and error code;
- Discord delivery retries and expired private cards.

Every event and error should carry campaign ID, command ID, revision, subsystem, and stable error code. Never log Discord tokens, private interaction credentials, raw save paths, private character data, or hidden DM facts.

## Deployment and rollout strategy

### Development

- Use the local project path only.
- Run the C# harness, Node test suites, and ESLint before Unity.
- Run Unity tests under the exact pinned editor.
- Use local Obus/Stable Diffusion services only through existing localhost boundaries.
- Keep Discord credentials in a local `.env.local` outside source control.

### Staging

- Run the bridge against a disposable campaign database.
- Use synthetic Discord identities and deterministic RNG.
- Simulate lost responses, duplicate clicks, stale revisions, scene timeout, process restart, and invalid saves.
- Verify private/public projection filtering.

### Limited live campaign

- Use one GM/host and two test players.
- Run only the vertical-slice scene and content set.
- Keep a known-good save checkpoint before each transition.
- Do not enable the old JavaScript runtime as a competing authority.
- Record every acceptance step and receipt ID.

### Rollback

1. Stop new command intake.
2. Drain or replay in-flight receipts.
3. Preserve the current state database and event journal.
4. Restore the last validated save checkpoint.
5. Switch clients to the previous validated bridge/runtime revision.
6. Re-run state/projection consistency checks before resuming.
7. Never delete the failed state or pristine RPG-Core baseline during rollback.

## Release checklist

- [ ] Citadel audit has zero critical findings.
- [ ] Warnings are either fixed or explicitly accepted with evidence.
- [ ] Unity exact-version compile passes.
- [ ] Unity EditMode tests pass.
- [ ] Unity PlayMode vertical slice passes.
- [ ] C# standalone tests pass.
- [ ] Node Discord/game/map tests pass.
- [ ] ESLint passes.
- [ ] Save migration and restart tests pass.
- [ ] Security tests reject forged owner, target, channel, revision, and receipt inputs.
- [ ] Map projection includes terrain, actors, active turn, effects, and public/private filtering.
- [ ] Per-character inventory and equipment state round-trip.
- [ ] Spawner state round-trips.
- [ ] Separate bridge secret is configured and rotatable.
- [ ] No credentials appear in source, logs, or chat.
- [ ] Retain/repair/wrap/rewrite classification is recorded.
- [ ] Rollback checkpoint is tested.

## Citadel handoff

---HANDOFF---
- Architecture: RPG-Core D&D Stabilization and Integration
- Document: `.planning/architecture-rpg-core-stabilization.md`
- Phases: 11 including Phase 0 baseline and Phase 10 rollout classification
- Estimated complexity: high
- Next: approve the plan, then execute Phase 0 and Phase 1 before touching legacy runtime code
- Reversibility: green for this document; delete this planning document only if the user explicitly requests it
---
