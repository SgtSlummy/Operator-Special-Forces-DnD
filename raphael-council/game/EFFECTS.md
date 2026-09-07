# Timed area hazards

The explicit combat adapter supports host-authored fixed-damage area hazards. This is a bounded runtime mechanic, not a complete D&D condition or spell system. Gameplay, browser maps, private Discord maps and illustrative scene context derive from the same saved state.

## Authoring contract

A reviewed campaign seed supplies an `effects` array. Each record contains a unique `id`, a `name`, one `trigger`, nonnegative integer `damage`, integer `expiresAtTurn`, boolean `visible` and one or more in-bounds `cells` with integer `x` and `y` coordinates. Example:

```json
{
  "id": "burning-floor",
  "name": "Burning floor",
  "trigger": "end_turn",
  "damage": 3,
  "expiresAtTurn": 4,
  "visible": true,
  "cells": [{ "x": 2, "y": 2 }, { "x": 3, "y": 2 }]
}
```

A zone affects an actor when any cell in the actor's footprint overlaps it. Duplicate coordinates describe the same area, not extra sources of damage. Distinct overlapping effects are distinct sources and each can trigger under this adapter.

| Trigger | Resolution boundary |
| --- | --- |
| `enter` | After each committed movement step. Each zone can affect an actor at most once during the current global turn, even if the actor leaves and re-enters. A lethal hit stops the remaining route. |
| `start_turn` | At the initial active turn and after the next actor's turn begins. Expired zones are removed before the new turn's effects. |
| `end_turn` | On End turn for a living active actor, before `turn_ended` and the encounter-completion check. An already defeated actor does not receive another end-turn trigger. |

`expiresAtTurn` is an absolute global turn ordinal, not a round count or a wall-clock time. The first turn is 1; entering turn 4 removes an effect whose expiry is 4 before turn-4 start effects. In the example, the burning floor can trigger at the ends of turns 1 through 3 if the active actor overlaps it. Pause/resume and map requests do not advance that clock. Encounter completion does not invent further turn advances.

Reviewed content packs express `durationTurns`; their preparation service converts it to the destination's global turn boundary. Scene transitions preserve archived scene zones according to the existing scene contract. A scene zone is not an actor-attached condition and does not automatically follow a traveler.

## Persistence and delivery

Each trigger records an `effect_triggered` event with effect ID, actor ID, trigger type, configured damage, resulting HP and global turn. Configured damage may exceed the actor's remaining HP; HP clamps at zero. The adapter does not currently roll hazard damage. It creates no fabricated dice receipt for fixed damage.

The `trigger` event field is additive. Older saved events may omit it; consumers must tolerate its absence rather than rewriting history or guessing a trigger.

The command transaction saves effect marks, HP, events, projection snapshots and its receipt together. A repeated successful request returns its original receipt without reapplying the effect. If a world consequence or persistence write fails, the transaction rolls back the entire command, allowing the same request to be retried safely after the failure is resolved.

Lethal end-turn effects run before the living-team completion check, so the resulting mission outcome sees the updated HP in the same transaction. The limited engine evaluates encounter completion during End turn and after a reviewed saving-throw damage consequence defeats an actor. A start-turn casualty is automatically skipped, including when the next actor is also defeated by a start-turn hazard. This is limited zero-HP handling; death saves, unconsciousness and a broader condition state machine remain separate work. See [CHECK_CONSEQUENCES.md](CHECK_CONSEQUENCES.md) for the reviewed single-target save-damage contract; an individual's successful save never removes an area effect for everyone.

Each trigger and expiry records a map revision. Expiry snapshots already omit the expired effect. Ordered browser catch-up preserves these revisions; Discord delivery can converge to the latest authorized image without repeating gameplay.

## Player visibility

Only authorized projected cells and effects enter the tactical renderer. Player projections omit hidden zones and filter zone cells to current visibility. Host projections may include GM-only zones. Fixed damage values and internal trigger marks are not part of the player map projection.

The precise PNG provides numbered effect labels and a legend showing names, trigger timing and absolute expiry turn. Distinct overlapping zones must remain identifiable, and repeated coordinates within one zone must not imply extra effects. The legend supplements patterned cells; color alone is insufficient. Large maps must stay within the renderer's pixel budget even with the maximum supported number of effects.

## Supported boundary

This adapter does not yet model actor conditions, resistance/immunity, saving-throw consequences, variable damage dice, concentration, dispels, source-dependent removal, per-actor expiry anchors, or stacking policies from arbitrary spell text. Those need structured rules, approved character data and independent fixtures before automatic resolution. Do not translate an unsupported spell into this fixed-damage format merely to make it run.

Focused verification lives in `effects.test.mjs` and `../maps/render-effects.test.mjs`; broader game and map tests retain coverage for entry triggers, footprints, visibility and existing turn behavior. See the root tactical implementation plan for the remaining full-system work.
