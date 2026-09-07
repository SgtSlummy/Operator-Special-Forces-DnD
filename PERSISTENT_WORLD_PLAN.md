# Persistent-World Special Operations D&D Auto DM

## Product outcome

Build a local-first, single-party D&D Auto DM named **Raphael** for a fictional fantasy campaign shaped around mission planning, team bonds, intelligence, diplomacy, recovery, and consequences. Raphael is an all-seeing, in-world presence who guides the chosen heroes with timely but incomplete counsel. It is a game about protecting communities and navigating hard choices - not a simulation of real-world special operations.

The first playable version lets a player create a campaign, accept a mission, make choices and dice rolls, complete a debrief, and reload the campaign with its world changed by those decisions.

The authored setting, hidden history, mission arcs, and council storytelling contract are in [WORLD_STORY_FRAMEWORK.md](WORLD_STORY_FRAMEWORK.md). Use [PLAYER_WORLD_PRIMER.md](PLAYER_WORLD_PRIMER.md) for the introduction that can be shared with players. These documents define campaign content; the current prototype does not yet load them automatically.

The Discord-only interaction design is in [DISCORD_PLAY_DECK.md](DISCORD_PLAY_DECK.md), with a [player guide](DISCORD_PLAYER_GUIDE.md) and [component renderer](raphael-council/discord/README.md). It covers 23 cards and 15 natural-language forms. Connecting that deck requires an authenticated Discord adapter and authoritative multiplayer game services; the renderer alone is not a deployed bot or a persistence implementation.

## Source incorporation and boundaries

The optional **Behind the Veil** Nareth expedition is integrated as authored campaign content: [GM guide](BEHIND_THE_VEIL_GM.md), [player briefing](BEHIND_THE_VEIL_PLAYER_BRIEFING.md), and [GM-only JSON blueprint](campaigns/behind-the-veil.json). It adapts the supplied [Campaign Model Writing conversation](https://chatgpt.com/share/6a9ce0e1-bc4c-83e8-8bb1-fc4d07bc22e4) into Avarra without replacing Greyharbor's opening. Its expedition clock, enemy reports, mission outcomes and knowledge boundaries extend the state model below. Content loading and authoritative execution remain implementation work; the current app does not load this blueprint automatically.

| Source | What informs the product | Boundary |
| --- | --- | --- |
| [dnd_ai_dm](https://github.com/msadeqsirjani/dnd_ai_dm) | Keep a distinct world-state model for locations, time, weather, quests, NPCs, and global facts. | Treat it as an architectural sketch only; do not reuse code without a separate license and quality review. |
| [DnD-AI-DM](https://github.com/RidzkyDifa/DnD-AI-DM) | Persist character state and deterministic dice results locally. | Do not reuse code: no repository license was detected during review. Avoid full-transcript prompting. |
| [GameMasterAI](https://github.com/deckofdmthings/GameMasterAI) | Separate campaign preparation, live DM turns, and recap/notetaking; support campaign save/load. | Treat its older stack and state-access design as inspiration, not a security or data-model template. |
| [PEARLS Lab AIDnD](https://pearls-lab.github.io/projects/aidnd/) | Explicitly track personas, relationships, shared-world facts, and long-running story goals. | Research framing only, not an implementation or license source. |
| `Digital_Ranger_Handbook.pdf` | Fictionalize leadership, team trust, preparation, recovery, and after-action reflection into play loops (pp. 25-27, 33-37). | Do not reproduce real-world tactical, communications, survival, or combat methods. |
| `Fm21-50RangerTrainingAndRangerOperations_text.pdf` | Use only the broad briefing-to-debrief rhythm and accountability themes (pp. 4, 8). | Historical context only; exclude its real-world training, raid, ambush, and movement material. |
| `Special-Operations-Forces-Reference-Manual_2023.pdf` | Model community trust, partner relationships, readiness, logistics as abstract clocks, and consequences that affect several world tracks (pp. 18-25, 69-76). | Keep everything fictional and abstract; no real-world operational guidance. |
| `The_Poor_Mans_James_Bond_Vol_1_Kurt_Saxon.pdf` | None. | Exclude completely because it contains weapon, explosive, arson, and fighting material. |

All campaign fiction, names, mechanics text, maps, and scenarios will be original. The rules layer will initially be system-neutral; support for any D&D rules text must use material the user is authorized to use or an independently verified open rules source.

## Core campaign loop

1. **World turn** - advance the calendar and pressure tracks; factions pursue goals and existing threats develop.
2. **Mission board** - present two or three mission opportunities driven by unresolved world events, community needs, and faction agendas.
3. **Briefing and preparation** - select objectives, allies, risks, and abstract readiness assets. Preparation reveals tradeoffs or story options rather than real-world procedures.
4. **Scene play** - the player chooses an approach; deterministic dice and rules resolve mechanical outcomes; the DM narrates the resulting scene.
5. **Debrief** - record facts learned, relationships changed, resources spent, injuries/recovery, debts, leads, and reputation effects.
6. **Projection** - apply the event to locations, factions, NPCs, clocks, and the campaign timeline, then generate the next relevant hooks.

## Persistent-world model

The database is the source of truth. AI prose, raw chat, and generated notes are never authoritative state.

| Entity | Essential state | Why it persists |
| --- | --- | --- |
| Campaign | title, rules adapter, calendar, seed, current mission, safety/content settings | Defines one self-contained world. |
| Locations and regions | parent region, tags, stability, local trust, supply access, discoveries, active threats | Lets consequences travel beyond the current scene. |
| Factions | goals, influence, resources, public posture, relationship to party and communities | Makes allies and adversaries adapt over time. |
| NPCs and party members | role, values, bonds, condition, trust, knowledge, obligations | Supports persona consistency and emotional stakes. |
| Missions and objectives | source event, objectives, constraints, status, outcomes, linked entities | Preserves the campaign's operational history without replaying old chat. |
| Assets and clocks | abstract readiness, recovery, maintenance, morale, attention, threat progress | Makes time, sacrifice, and recovery matter safely. |
| Intel and story threads | claim, confidence, source, affected entities, status | Separates verified facts from rumors and keeps leads alive. |
| World events | immutable event type, timestamp, actor, targets, payload, player-visible summary | The audit trail from which current state and recaps are derived. |
| Session summaries | compact recap, open questions, citations to world events | Keeps AI context small and reproducible. |
| Raphael guidance | question asked, hint delivered, evidence cited, intended uncertainty, and resulting player choice | Prevents repeated hints and preserves what the party has or has not earned the right to know. |

Use append-only `world_events` for changes and maintain queryable projections for the current campaign state. Every event includes its campaign ID, source (rules, player, or DM proposal), affected entity IDs, and validation status. Save/load always scopes data to one campaign and one player profile.

## AI and rules boundary

The system has three deliberately separate services:

1. **Rules engine** - validates choices, rolls dice, advances clocks, and produces typed proposed state changes.
2. **World service** - validates and commits those changes as events, updates projections, and selects relevant memories.
3. **Narrator** - receives only a compact, validated scene packet and returns structured narration, choices, requested rolls, and optional *proposals*. It cannot write directly to persistent state.

The narrator response must pass a schema validator. Invalid responses, hallucinated entities, or unrecognized state proposals fall back to a deterministic rules-led response and are logged for repair. Keep model credentials server-side; the first local build must remain playable with a seeded deterministic narrator when no AI provider is configured.

### Raphael's counsel

Raphael can see the validated world state, but the guidance policy decides what he is allowed to reveal. Each counsel response must:

- ground itself in facts the party has observed, one nearby consequence, or a verified partial clue;
- offer a nudge, warning, question, symbolic image, or competing priority rather than a solution;
- preserve at least one meaningful uncertainty and leave the decision to the party;
- never expose unrevealed villain plans, hidden map details, dice outcomes, private NPC motives, or the optimal action;
- cite the relevant world-event or intel IDs internally, then save the advice and its evidence in the campaign ledger.

Use a per-mission guidance budget and a history of delivered counsel. Repeated requests should deepen a previously earned clue or surface a new cost, never simply reveal the answer. The UI labels these moments as **Raphael's Counsel** so players understand that the voice is diegetic guidance, not an omniscient walkthrough.

## Agent council and deliberation tree

Raphael is the player-facing guide, not an unchecked director. Mission development is handled by an equal council with five persistent mandates:

- **World Steward** protects community impact and location continuity.
- **Memory Keeper** checks promises, discovered facts, and unresolved story threads.
- **Consequence Keeper** identifies costs, recovery, and downstream effects.
- **Mission Architect** frames objectives, constraints, and meaningful tradeoffs.
- **Party Advocate** protects player agency, character bonds, and consent settings.

For each mission round, every council member receives the same validated world snapshot and publishes a short structured assessment: supported branches, visible cost, affected entities, and a confidence score. They vote on the available branches with equal weight. The system aggregates those votes, rotates a novelty rule only for a genuine tie, and then presents the leading branch alongside alternatives. The **player** selects the branch; only that selection can become a world event.

This is a transparent deliberation tree, not stored private reasoning. The ledger keeps compact evidence references, scores, votes, chosen branch, and outcome so later missions can learn from the result without exposing or depending on hidden chain-of-thought. Variability comes from current faction pressure, prior events, relationships, active threats, rotating branch order, and the council's role-specific scores - not from a single agent inventing a new world state in isolation.

## MVP user experience

- **Campaign setup:** choose a campaign seed, party, tone, safety settings, and a fictional operations charter focused on protection, consent, and accountability.
- **Operations board:** view the current calendar, faction pressure, unresolved threads, readiness clocks, and mission cards.
- **Mission console:** read a briefing, make story-forward choices, roll dice, and see only the current scene plus relevant world facts.
- **Raphael's Counsel:** ask the guiding presence for a limited hint, then receive a concise, state-grounded nudge that records what the party has been told without resolving the mission for them.
- **World ledger:** browse locations, factions, NPC relationships, discovered intel, and a chronological after-action timeline.
- **Debrief:** confirm the outcome, edit player-facing notes, see consequences, and choose recovery/downtime actions.
- **Persistence:** create, resume, export, and import named campaigns locally.

## Technical approach

Use a TypeScript full-stack local web application:

- React client for the operations board, mission console, and ledger.
- Node service with a versioned SQLite schema and migrations for local persistence.
- Schema validation for all API and narrator payloads.
- A provider adapter for an OpenAI-compatible model endpoint, with a deterministic fallback for offline play.
- A small content-pack format (JSON or YAML) for campaign seeds, factions, mission templates, and fictional setting lore.

Start with a single local profile and campaign ownership boundary. Multi-player play, online accounts, shared editing, voice input, tactical map simulation, and real-time combat automation are later phases - not MVP requirements.

## Delivery sequence

### Phase 1 - Foundation

- Scaffold the local TypeScript application and establish the database migration workflow.
- Define typed entities, event schemas, deterministic dice, campaign creation, and a single seeded setting.
- Add a sample campaign: three factions, five NPCs, three locations, two active threats, and one mission.

### Phase 2 - Playable vertical slice

- Implement one mission from briefing through debrief.
- Commit event-driven changes to world projections.
- Reload the campaign and prove that mission consequences, relationships, supplies, and open threads remain changed.

### Phase 3 - Narrator integration

- Add structured narration and choice generation behind the provider adapter.
- Add provider-backed council assessments behind the same schema, retaining equal votes and the deterministic council fallback when no provider is configured.
- Retrieve only current scene facts, active mission, relevant entities, and a rolling session summary.
- Add deterministic fallback, error handling, prompt/version logging, and content checks.

### Phase 4 - World depth

- Add downtime, recovery, faction simulation, intel confidence, relationship graphs, and mission generation from current pressures.
- Add recap export/import and a campaign timeline view.

### Phase 5 - Quality and expansion

- Test event application, migrations, campaign isolation, save/load, deterministic dice, and malformed narrator responses.
- Perform accessibility and responsive UI checks.
- Consider content packs, rule adapters, opt-in accounts, and multi-party worlds only after the single-player loop is stable.

## MVP acceptance criteria

- A player can create and reopen a named campaign without losing state.
- Completing a mission changes at least one faction, location, NPC relationship, resource/clock, and open story thread.
- The timeline identifies which event caused each visible consequence.
- Dice and state updates are reproducible and do not depend on the language model.
- Narration remains coherent after reload because it is grounded in validated world state and summaries.
- Raphael remembers previous counsel after reload, gives guidance grounded in campaign evidence, and preserves a meaningful unknown in every hint.
- The first included setting contains no real-world tactical instructions, weapon details, or operational procedures.

## First implementation decision

Build the local, single-player vertical slice first. It gives us a verifiable persistent-world foundation before adding provider credentials, multiplayer features, or a large content library.
