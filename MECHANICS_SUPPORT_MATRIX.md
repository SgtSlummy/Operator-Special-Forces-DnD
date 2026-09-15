# Raphael mechanics support matrix

Updated: 2026-09-07 UTC

This matrix describes the implemented contract surface and its acceptance boundary. Local test coverage does not claim live Discord or mixed-player readiness.

| Area | Supported behavior | Boundary / evidence |
|---|---|---|
| Character data | Approved character import and versioned projections | Live approved-character upload remains a campaign acceptance step |
| Rules version | Versioned 2024 mechanics and rules metadata | Unsupported rules variants are rejected before mutation |
| Checks and saves | Revision-bound checks, saves, roll history, and receipts | Requires active membership and current revision |
| Attacks and damage | Range, visibility, line of sight, attack rolls, damage, criticals, and concentration effects | Resources are spent only after validation |
| Initiative and turns | Active actor, rounds, turn advancement, movement budget, action/reaction resources | Defeated actors and stale turns are rejected |
| Conditions and concentration | Pending saves, bounded continuations, reaction/concentration gates | Pending resolution blocks unrelated mutations |
| Octagonal movement | Bounded paths, footprints, terrain costs, visibility, elevation, and previews | Hidden or blocked cells are rejected without spending movement |
| Reactions | Opportunity reactions and interrupted movement with resumable continuations | Requires current scoped control |
| Persistent effects | Enter/start/end-turn effects, damage, expiry, and encounter completion | Effects remain authoritative in campaign state |
| Maps and snapshots | Connected map projections, deterministic snapshots, and player-scoped visibility | Hidden state is excluded from player projections |
| World consequences | Exploration, world time, mission transitions, debrief, council, and journal projections | AI output cannot directly mutate mechanics or player decisions |
| Unsupported actions | Explicit command allowlists and pre-mutation validation | Unknown mechanics are rejected before resource spending |

## Acceptance boundary

Local game and map coverage is recorded in the recovery evidence. Live mixed Discord/Web gameplay, restart recovery, and player acceptance remain open in `PROJECT_ACCEPTANCE_MATRIX.md`.
