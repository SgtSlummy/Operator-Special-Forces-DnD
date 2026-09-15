# Fleet: Operation Hollow Lantern

Status: active
Goal: Complete the accepted DMD Arcade implementation and live readiness criteria.
Canonical root: C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons
Related authorized root: C:\Users\Hermes\Projects\Davy Jones

## Fixed decisions

- Human user is DM; three independent AI party members. Opus optional.
- New campaign; existing saves remain unchanged. Continuous rehearsal with ordered visual evidence.
- Unity/RPG-Core is the only gameplay writer. No fallback to JavaScript mutations.
- Native Discord Components V2, dropdowns for grouped actions, screenshot-led music-card hierarchy and SSOD-inspired inventory usability.
- Developer workers are not blind validators. Blind runs require enforced filesystem/network/credential/context isolation and real visual inputs.
- Work stays outside OneDrive. Gortex MCP rejects canonical requests because it remains bound to the stale task directory; native fallback is in use after observed integration failure.
- Parent Coordinator claim covers child workers. Preserve shared dirty work; no worktree/branch changes while other task claims exist.

## Work queue

| ID | Work | Owner | Status | Depends on |
|---|---|---|---|---|
| E | Authoritative C# rules, persistence, bridge, Unity adapter and tests | hollow_engine | active | none |
| U | Discord components, scoped interaction adapter, renderers and tests | hollow_discord_ui | active | E protocol |
| I | Bridge client, live host integration, assets, campaign packet and source research | root | active | E, U |
| V | Enforced isolated rehearsal and visual/action evidence | root | pending | E, U, I |
| R | Davy coordinated deployment and real Discord verification | root | pending | V |

## Required exit evidence

| Subject | Gate | Status | Evidence |
|---|---|---|---|
| E | Deterministic mechanics, atomic receipts, authorization, privacy, restart | pending | |
| E | Pinned Unity actual scene/load/save cycle | pending | |
| U | Actual component handlers, dropdowns, privacy, masked pixels, mobile/desktop | pending | |
| I | Existing Davy single client and music preserved, engine bridge used | pending | |
| V | Full mission on real engine plus isolated visual participants | pending | |
| R | Actual Discord delivery, user-visible play controls, coordinated recovery | pending | |

## Continuation

Do not infer readiness from a storyboard, enum, mock result or this ledger. Record exact executed evidence. No live campaign has been created by this implementation yet.
