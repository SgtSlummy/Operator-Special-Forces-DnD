# Citadel Campaign: RPG-Core D&D Stabilization

## Direction

Implement the audited RPG-Core D&D integration in the local project using a strangler architecture. Preserve RPG-Core content/editor assets, make typed runtime state authoritative, repair critical legacy behavior, connect Unity projections to the Discord client, and prove the full character-creation-to-save/reload vertical slice.

## Active Context

- Status: in-progress
- Current phase: 8 — Discord bridge boundary
- Local project: `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`
- RPG-Core repository: `RPG-Core`
- Base revision: `8512d890126b34478a0fa6ee63a0257aa83566d2`
- Protected tag: `rpg-core-pristine-8512d890`
- OneDrive access: prohibited
- Unity project version: `2021.3.14f1`
- Installed editor: Unity `2021.3.14f1` at `C:\Unity\2021.3.14f1\Editor\Unity.exe`; license and current fixture validation passed

## Phase End Conditions

| Phase | Title | Status | Validator retries remaining | Required evidence |
|---:|---|---|---:|---|
| 0 | Baseline and recovery | complete | 3 | tag resolves; baseline tests recorded; working tree inventory recorded |
| 1 | Typed contracts and state safety | complete | 3 | C# tests pass; mutation isolation and receipt tests pass |
| 2 | Legacy rule repairs | partial | 3 | controlled repairs landed; pinned-editor compilation and compatibility fixtures pass |
| 3 | Combat, turns, and authorization | complete | 3 | forged/stale/out-of-turn commands fail without mutation |
| 4 | Bootstrap and scene lifecycle | partial | 3 | pinned-editor compile passes; full Addressables transition test remains |
| 5 | Live Unity bridge and projections | partial | 3 | assembly compiles and projection fixture passes; live scene events remain |
| 6 | Inventory, equipment, and spawners | partial | 3 | typed inventory isolation and transactions pass; legacy spawner validation remains |
| 7 | Save schema and recovery | pending | 3 | migration, corruption, restart, and rollback tests pass |
| 8 | Discord bridge | partial | 3 | versioned signed client fixture passes; live endpoint wiring remains |
| 9 | Unity vertical slice | partial | 3 | pinned-editor PlayMode fixture passes; full Addressables combat/loot/save/reload flow remains |
| 10 | Classification and rollout | pending | 3 | retain/repair/wrap/rewrite evidence is complete |

## Exit Evidence

Required evidence will be recorded after each phase with command, subject, revision, result, and timestamp. A phase cannot advance on narrative progress alone.

## Decision Log

1. Preserve the original RPG-Core baseline with tag `rpg-core-pristine-8512d890`; do not delete legacy source.
2. Work only in the local project path; do not inspect or modify OneDrive.
3. Use the typed runtime as authority; Unity and Discord are adapters/clients.

## Feature Ledger

| Phase | Change | Evidence | Status |
|---:|---|---|---|
| 0 | Protected baseline tag created | `git rev-parse rpg-core-pristine-8512d890` -> `8512d890126b34478a0fa6ee63a0257aa83566d2` | complete |
| 1 | Typed host and mutation boundary | `dotnet run --project RPG-Core/RpgIntegration.Tests/RpgIntegration.Tests.csproj` -> 16 passed | complete |
| 3 | Authorization, stale revisions, and receipt fingerprints | `TypedHostAuthorization`, `ReceiptReplayDoesNotDuplicateEvents` | complete |
| 8 | Dedicated bridge signing and public/private filtering | `node --test raphael-council/bridge/*.test.mjs game/*.test.mjs maps/*.test.mjs` -> 673 passed | partial |

## Review Queue

- Unity `2021.3.14f1` is installed at the verified editor path above; current licensing, compilation, EditMode, and PlayMode fixture validation passed.
- No separate Hermes reviewer agent is callable in this session; Citadel is the active campaign/review coordinator.
- Gortex is configured against the OneDrive project path, so it was not used to inspect or mutate this local-only implementation.
- Earlier Unity 6 probes were non-authoritative and are superseded for version availability. Verified prerequisite evidence now reports `C:\Unity\2021.3.14f1\Editor\Unity.exe` with file version `2021.3.14.57736`, matching the project metadata revision `eee1884e7226`; licensing, compilation, EditMode, and PlayMode still require direct validation.

## Continuation State

After each implementation phase, record modified files, tests run, failures, checkpoint identity, and the next phase/sub-step here.

## Current Continuation

- Modified areas: typed contracts/runtime host, controlled RPG-Core repairs, Unity bootstrap/bridge adapters, and `raphael-council/bridge`.
- Verified: 16 C# integration tests, 673 Raphael bridge/game/map tests, bridge-local lint, Unity 2021.3.14f1 compilation, 5 EditMode tests, 1 PlayMode test, and diff whitespace checks.
- Open gates: full Addressables scene lifecycle and vertical slice; durable file-backed save migration; live bridge endpoint; legacy per-character inventory/spawner completion; repository-wide ESLint cleanup.
- Classification snapshot: retain RPG-Core databases/Addressables/editor assets and Raphael presentation/security; repair legacy vitals/factions/skills/passives/equipment/inventory/spawner rules; wrap legacy builders/events/object payloads behind the typed host; rewrite authoritative state, commands, receipts, save orchestration, bootstrap, and bridge transport.
- Next action: add a durable versioned save adapter and Unity-compatible EditMode/PlayMode fixtures, then validate the full vertical slice under the pinned editor.
