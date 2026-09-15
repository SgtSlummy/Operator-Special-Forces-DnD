# Operator Special Forces Dungeon
## D&D play research and proposed operating contract

**Prepared for Ian · September 9, 2026**

**Purpose:** Correct the gap between possessing D&D information and actually conducting an interactive game. This document concentrates on table procedure, informed choices, rules resolution, transitions, and continuity. It is not a replacement rulebook or a claim that the application has already been fixed.

## 1. Evidence and scope

The official play and DM guidance cited below was inspected. The 2014 written example of play was also inspected. Relevant videos from MrRhexx and SteelySam were located and their identities or descriptions checked. Full video transcripts did not load reliably. No full-episode viewing, timestamped behavioral analysis, or complete channel review is claimed. A partial third-party transcript/index was insufficient to establish additional video-specific claims and was not promoted to rules authority.

The exact repository and D&D JSON corpus for the user-named project were not located in the connected searches. No code, production configuration, or campaign state was changed. Prior AutoDM planning provides useful context, but is not proof of the exact current implementation. The named coordinator did not expose a callable delegation action, so this is a handoff document, not a dispatched Codex job.

Throughout this document:

- **Verified rule or official guidance** is identified by a source reference.
- **Craft recommendation** is a named author's advice, not a binding game rule.
- **Proposed requirement** is an application design recommendation, not an audited existing capability.
- **Illustrative fixture** is newly invented to explain a procedure, not established campaign canon.
- **Unverified** means it has not been inspected or tested, rather than being assumed correct.

The project must resolve its actual rules family before applying edition-sensitive mechanics. This report uses **2014** and **2024** as explicit version labels instead of relying on ambiguous “5e” terminology. It does not automatically migrate an existing campaign.

## 2. What the requested channels contribute

MrRhexx describes his focus as world-building lore and monster biology. This makes his work a promising source for coherent ecology, motives, culture, environmental signs, and setting texture. It does not make every discussed detail an active-edition mechanical rule. [S09]

SteelySam's indexed material includes monster-running guides and DM Hotline topics about encounters and sessions without combat. Those are directly relevant research targets for encounter behavior and table procedure. Titles and descriptions establish topic relevance, not what every minute of the video teaches. [S11–S13]

| Research target | Verified coverage here | Intended use after full content verification |
|---|---|---|
| MrRhexx: Kobold lore video (S10) | Identity/title; incomplete transcript access | Extract lore with original-edition/setting provenance and turn it into observable world behavior |
| SteelySam: How to Run Kobolds in D&D | Identity/description; no full transcript | Compare stat-block interpretation with selected edition and encounter choices |
| SteelySam: Sessions with No Combat | Identity/description; no full transcript | Examine noncombat pacing and how scenes continue without a fight |
| SteelySam: Making Encounters More Intersting | Identity/description; no full transcript | Examine encounter stakes, interaction, and meaningful decisions |

A future completed video audit needs a record per segment: video ID, actual timestamp, transcript excerpt or observation, advice category, cited original rule if any, edition, applicability, and a concrete regression scenario. Do not create timestamps from summaries. A video can provide excellent inspiration while requiring adaptation or remaining noncanonical for a particular campaign.

## 3. The central finding

The official written example has players respond to the DM's description by investigating different details; the DM resolves one inquiry and then turns to the other player. It is not a narrator announcing what the party does next. That turn-taking conversation is the critical difference between prose generation and play. [S01]

**Proposed system contract:** Every substantive output must do one of three things: provide information the player is entitled to, resolve an authorized action into a traceable consequence, or request a decision needed to continue. It must not secretly choose the player's course simply to finish a story beat.

The operating loop is:

```text
Known situation
    → player question or intention
    → clarify only what changes the ruling
    → retrieve applicable rules and world facts
    → determine the resolution procedure
    → resolve with the agreed dice/ruling policy
    → commit valid changes and dependent effects
    → describe the observable result
    → return the next meaningful choice
```

This is a software contract proposed for the project, not a literal procedure prescribed by the rulebook. The implementation needs safe pauses inside the loop for optional reactions, missing information, and human rulings. It is not one irreversible “generate the whole scene” call.

## 4. Campaign and session lifecycle

The following lifecycle is a proposed operating specification. Stages can be revisited, skipped when irrelevant, or entered through different routes. There is no requirement that a session include combat.

| Stage | Required work | Player-facing result | Exit condition |
|---|---|---|---|
| Campaign agreement | Record rules family, permitted content, setting, tone, boundaries, dice policy, delegation, advancement, and relevant house rules | A short campaign contract, not a hidden prompt | Necessary agreements and characters are ready |
| Prepare a situation | Establish objectives, locations, NPC goals, evidence, pressures, and possible consequences | No spoilers; only the initial briefing when play starts | Prepared facts are internally consistent and sources are available |
| Resume play | Restore actual state, not only a prose recap; reconcile discrepancies | Location, immediate purpose, unresolved choice, relevant status | Players know where play resumes |
| Frame a scene | Select perceptible and previously known facts from the current viewpoint | Brief sensory description plus actionable details | A meaningful choice is possible |
| Handle questions | Distinguish clarification from attempted action | Answers scoped to the character's knowledge and position | The player can decide or declares an attempt |
| Receive intentions | Identify actor, goal, method, target, and relevant timing | Confirmation only when needed to prevent a material mistake | An actionable intention exists |
| Adjudicate | Choose automatic resolution, check, attack, save, feature resolution, or explicit ruling | Known stakes, needed roll or choice, and relevant costs | Resolution inputs are complete |
| Apply consequences | Resolve dependencies, costs, discoveries, positions, and clocks | A truthful result and updated decision context | State is coherent and the next decision is clear |
| Change mode | Enter or leave structured timing only when the situation warrants it | What changed, who can act, and what matters now | The correct procedure is active |
| Handle aftermath | Resolve urgent danger, choices about people and objects, evidence, and mission consequences | What remains unresolved and what choices are available | Players choose their next activity |
| Recover or take downtime | Validate declared activities and elapsed time against rules and world schedules | Specific recovery, costs, and changes; no generic reset | Completed activities are recorded |
| Close the session | Save state and pending choices; ask brief feedback | Recap separating facts, beliefs, and open questions | A reliable next-session starting point exists |

### Story preparation rather than forced story progression

Justin Alexander argues for preparing situations instead of deciding the players' future sequence of actions. This is a craft recommendation adopted here because it prevents the AI from treating its outline as an outcome it must force. [S14]

For a fantasy rescue, prepare the captive's location, captors' goals, the transfer schedule, known approaches, and consequences of changes. Do not hard-code “the party fights the gate guards, loses, is captured, then meets the informant.” The party might negotiate, infiltrate, abandon the rescue, recruit help, expose the captors, or discover an approach not anticipated in preparation.

A prepared deadline is a causal world event, not a device the narrator moves forward or backward to force drama. Record what advances it. If the party changes the cause, change the consequence. If the party chooses to spend an hour, evaluate the hour; do not ignore it because the planned scene is not finished.

## 5. What information does the player need?

Before presenting a choice, the proposed scene renderer should answer these questions from the player's legitimate viewpoint:

| Player's likely question | Required answer or representation |
|---|---|
| Where am I and where are my companions? | Stable location and relevant relative positions; exact geometry when mechanically significant |
| What can I perceive? | Lighting, visibility, sound, salient objects, visible actors, and obvious motion |
| What are we trying to accomplish? | Known objective and why it matters; distinguish party agreement from an NPC's request |
| What could I interact with? | Doors, people, terrain, tools, evidence, and other apparent opportunities |
| What looks dangerous or urgent? | Perceptible danger cues, known deadlines, and already established stakes |
| How far away is that? | A usable distance or unambiguous relation when range or movement matters |
| What do I know already? | Relevant discoveries and character knowledge, without an exposition dump |
| What has changed? | Consequences since the preceding prompt; do not repeat the scene as if untouched |
| What can my character currently use? | Relevant resources and restrictions, with exact details available on request |
| Is this a question or an action? | Asking about an option does not execute it |
| Whose decision is pending? | Named player/actor or an open party decision; no hidden automatic turn advance |

Information should be layered. The initial paragraph establishes a usable situation. Details appear when they become relevant or are requested. A player should not need the exact phrase “I inspect the room for exits” to learn about an obvious open doorway.

Conversely, helpfulness must not reveal a concealed enemy, an NPC's secret loyalty, or the only correct puzzle solution. Offer options from known circumstances. “You could talk to the sentry, examine the channel, or propose another approach” is assistance, not an exhaustive command menu.

### Four different knowledge records

Maintain objective world state, each character's discoveries, each NPC's knowledge/beliefs, and player-facing information policy separately. An NPC can be mistaken. A character can know something another party member has not learned. An omniscient narrator database must not make every monster omniscient.

A rumor record needs its speaker and confidence. A discovery needs its discoverer and communication history. A recap must not quietly transform “the prisoner says the bridge is safe” into “the bridge is safe.”

## 6. Exploration and social interaction

### Exploration: procedure proposed for the application

Track the actual activity, not a generic label such as “exploration turn.” A hurried glance, a careful search, listening at a door, deciphering a document, crossing a hazard, and resting are different attempts with different possible consequences.

Questions about already perceptible information should normally be answered without treating them as a new risky action. When an attempt matters, establish scope and method. If a player says “I search,” ask about the area only when the answer changes what could be found or what time is spent.

Do not ask for rolls without a meaningful purpose. Do not give a roll for the impossible merely to make the conversation feel game-like. Do not demand a check for an unobstructed ordinary action simply because a die tool exists. Relevant official guidance explicitly permits straightforward resolution without a check. [S02]

Failure should mean the selected consequence, not an arbitrary punishment invented after seeing the die. Depending on the situation, a failed attempt can consume time, leave uncertainty, expose a character, damage equipment, attract attention, or simply fail. These are options for a reasoned ruling, not a universal automatic “fail forward” rule that guarantees the desired result.

Record retry and assistance policy. Repeating the same approach with no new leverage must not become unlimited cost-free rolls. Also do not make every failure permanently unretryable; circumstances and rules decide.

Multiple PCs can act during overlapping time. The application must not charge the group three sequential minutes when three compatible one-minute activities occurred together. Equally, it must not allow incompatible actions by one character to happen simultaneously.

### Social interaction: procedure proposed for the application

Give a significant NPC an immediate goal, relevant knowledge, current attitude, relationships, leverage, fears, and limits. Their first words should reflect that situation instead of reciting their private biography.

Separate the player's intention from exact acting performance. A player can explain an approach in ordinary language rather than perform an elaborate speech. Resolve the relevant rule or ruling using the character's capabilities and the fiction; do not replace the character sheet with a test of the player's eloquence.

A refused request need not begin combat. A high roll need not create information the NPC lacks or erase their motives. Creative persuasion should matter through the actual request and leverage. A mechanically established magical effect must be applied precisely, not expanded into unlimited control because the prose sounds compelling.

Changes in trust, suspicion, commitments, and exchanged information belong in persistent state. An NPC should remember a bribe, threat, promise, or rescue later when it matters.

### Discoveries that move the story

Mike Shea recommends preparing compact secrets and clues rather than relying on large lore monologues. The application can use this as a content-preparation technique while retaining stricter consistency after a fact is established. [S15]

For each important conclusion, prepare more than one sensible discovery route when practical. This is a proposed robustness measure, not a requirement that players collect a fixed number of clues. Do not move a previously established clue between rooms simply to ensure success. Uncommitted prep can remain flexible; committed reality cannot be silently rewritten.

## 7. The transition into combat

The application needs a transition procedure, not merely a different narration prompt. A hostile declaration that initiates combat is not a completed free attack. Official DM guidance specifically illustrates initiative occurring before the initiating spell takes effect. [S07]

Before resolution, preserve who is where, what is visible, what has already been done, the state of barriers, active effects, and what each participant is aware of. Do not materialize a generic battle layout disconnected from exploration.

The chosen rules family is material. Surprise in the 2014 and 2024 rules has different consequences. The adapter must test each separately, rather than treating “surprise round” as a universal game object. [S03, S04]

Proposed transition record:

```text
triggering declaration
previous scene-state version
participants and awareness evidence
position/terrain snapshot
active effects and remaining durations
rules-family and rule references
initiative results or agreed initiative procedure
first pending turn and permitted public information
```

The public opening should explain the perceptible trigger and the immediate stakes. It should not disclose all hidden participants because an initiative array exists. The interface can show the current actor and the next known actor while preserving unrevealed information according to the campaign's agreed display policy.

Combat is not mandatory because monsters are present, a social check failed, or the outline contains a fight. It is also not automatically over because the encounter's featured villain is down. Relevant timing can persist around other threats.

## 8. The anatomy of a resolved action

This section is a proposed application protocol, not an exhaustive restatement of D&D rules.

### A. Start from an authoritative state

Read the actor, target, position, current restrictions, active effects, resource state, pending timing windows, and applicable rules. Process start-of-turn events according to their actual timing. Do not reset everything at the top of a round.

### B. Understand the intention

Extract goal and method without demanding artificial command syntax. Distinguish “Could I cast this?” from “I cast this.” Resolve ambiguous target references before execution. Do not treat speculative party planning as consent to spend a resource.

### C. Retrieve the rule and its dependencies

A short ability summary is not enough. Retrieve the active record and all references needed to evaluate the actual situation. A spell can require its specific text, general casting rules, the caster's access method, target eligibility, geometry, relevant conditions, and triggered effects. [S05, S06]

The lookup must return identifiers, edition/version, and supported mechanics. An approximate name match is not a valid substitute for a feature with a different effect. The system should know when a result is missing, contradictory, quarantined, or outside the allowed corpus.

### D. Distinguish three outcomes before charging costs

1. **Blocked application request:** missing source data or unresolved input. The application has not executed an in-world action; it must not invent a result or charge a lookup failure.
2. **Executable attempt:** the character attempts the action and normal costs and consequences can occur.
3. **Executed but ineffective action:** apply the actual rule, including costs that remain even when the intended effect fails.

This distinction matters for the 2024 Invalid Targets spell rule. Do not automatically refund an executed cast merely because the target cannot be affected. Do not expose secret target eligibility through an overly helpful preflight validator. [S05]

### E. Resolve at the correct timing boundaries

Use the table's agreed dice source or fixed-value procedure. A generated numeral in prose is not a verified dice event. Record roll inputs and outputs separately from narration. Present only the information the table policy permits.

Open optional response windows at their actual trigger, not at a generic “before every action” checkpoint. Some triggers depend on an attempted effect, a hit, or damage; the implementation must follow the specific feature. Complete dependent resolution before finalizing the consequence it can change.

Apply arithmetic and state changes exactly once. If an external response arrives twice, it must not create a second expenditure. If the state changes while waiting for a player, revalidate the pending request before committing it.

### F. Narrate the committed result

Flavor must agree with mechanics. A hit that leaves a creature active is not a decapitation. A colorful near miss does not create an unrecorded environmental explosion. Do not grant a disarm, silence, prone condition, or severed limb merely because the player describes their ordinary attack that way.

Return the remaining choice. Finishing one action is not necessarily finishing a turn. Explain what was accomplished and what remains available without choosing for the player.

## 9. Running creatures as participants in the world

Creature lore should affect what players can observe and exploit: signs of habitation, behavior, loyalties, fears, communication, and environmental choices. Mechanics still come from the active stat block and approved modifications.

For an encounter, prepare objectives other than reducing PC hit points: guard a route, warn allies, protect a person, steal an object, delay passage, escape, or bargain. These are proposed encounter-design choices, not universal creature behavior.

Terrain should influence decisions. Official encounter guidance recommends features such as elevation, defensive positions, varied enemies, and reasons to move. [S07] For this project, a visible alarm device or endangered objective can connect the fight directly to the mission without inventing new class mechanics.

Do not make every intelligent enemy perfectly coordinated. Store what communication and preparation made coordination possible. Do not make every wounded enemy flee, either: motives and circumstances can justify different responses. Neither behavior should be selected just to force an outline.

## 10. Combat exit, aftermath, recovery, and continuity

The rules allow combat to end through outcomes other than killing everyone. [S03] The application must support transitions to negotiation, accepted surrender, resolved escape, capture, or other established outcomes, while retaining precise timing when unresolved dangers require it.

Proposed aftermath sequence:

**Urgency check:** Identify dying actors, ongoing hazards, pending reinforcements, active effects, and deadlines. Resolve or present these before a leisurely treasure summary.

**Situation check:** State who is standing, missing, captured, surrendered, or fleeing as far as the party can know. Preserve enemy identities so a survivor can matter later.

**Player choices:** Ask what the party does about people, evidence, objectives, and objects. Discovery is not automatic ownership, identification, attunement, or equipment assignment.

**Consequences:** Update the actual causal events: an alarm sounded, a witness escaped, a promise was made, a route became blocked, or the captive was rescued. Do not assume “victory” means every mission condition succeeded.

**Next decision:** Give the immediate options and known pressures. Rest, pursuit, interrogation, retreat, and continued exploration are separate choices.

Recovery must resolve the declared procedure rather than restore everything when a fight ends. Elapsed time remains consequential. A scheduled event can occur during travel or rest even when the party is not present, unless their earlier actions changed its cause. Do not fabricate interruptions to punish resting or guarantee a rest because the narrator wants a reset.

A session checkpoint needs exact persistent state plus a readable recap. Store current location, time, actor resources, conditions, effects, inventory ownership, NPC changes, discoveries, objectives, clocks, current initiative if relevant, and pending decisions. A prose summary alone cannot reconstruct an interrupted reaction window safely.

## 11. Annotated demonstration: a fantasy rescue

**Illustrative fixture only.** This is newly written material, not existing Operator Special Forces Dungeon canon. Numeric samples are hand-authored examples, not live dice results or official creature statistics.

### Beat 1 — Establish the job

A contact asks the party to recover a captive before a scheduled transfer. The party has a location and reason to care, but can question the contact, refuse, seek leverage, or choose an approach. The contact distinguishes confirmed information from rumor. The application records the party's actual decision rather than assuming acceptance.

### Beat 2 — Present an actionable approach

“From the broken doorway, you can see a sentry beside an alarm rope, about 30 feet away. Stacked stone blocks interrupt the open courtyard, and a barred room with a visible captive lies beyond the sentry. A narrow water channel runs along the near wall.”

The description provides useful anchors without telling the players the channel is secretly safe or the sentry can be bribed. Precise geometry, light, and cover are supplied when relevant and kept consistent.

### Beat 3 — Receive a question without executing it

Player: “Can I get behind those blocks without crossing his line of sight?”

The DM answers from the recorded geometry. The PC does not automatically move. A direct approach could be exposed while an alternative path has different costs; the player chooses.

### Beat 4 — Resolve an investigative or social approach

The party can observe, talk, or attempt movement. The DM determines the actual check or automatic result, when appropriate, using the chosen rules. One PC's brief clarification does not advance the transfer clock by an arbitrary amount. A prolonged in-world negotiation can.

### Beat 5 — Let the situation become hostile for a reason

Suppose the sentry recognizes a forged credential and starts to warn others. Player: “I shoot before he reaches the rope.” This establishes an intention and a contested timing problem, not an already successful shot. The combat procedure starts from the existing scene.

### Beat 6 — Resolve a particular turn

For this numerical illustration only, suppose the shooter's turn arrives while a legal shot is still possible. The custom test values are attack modifier +5, target AC 15, target HP 11, damage 1d8+3, and no additional modifiers. The sample attack die is 12 and sample damage die is 4. The computed result is attack total 17, damage 7, and target HP 4.

The narration might be: “The shot lands. The sentry staggers but remains on his feet; the alarm rope is still beside him.” It must not announce a kill or silently disable the sentry's arm. The interface separately reports the player's remaining turn resources under the fixture's rules. It does not necessarily reveal the enemy's exact HP.

### Beat 7 — Return control before later events

Do not finish the entire combat in the same paragraph. The player can make any remaining legal choices. Other participants then act at their actual opportunities. Whether the alarm sounds is determined by their resolved actions and the recorded device interaction, not by the outline.

### Beat 8 — Allow a nonlethal end without assuming it

A combatant can offer to surrender. Whether others accept, continue fighting, negotiate, or attempt another course is resolved from the actual choices and rules. A surrender offer is not proof that everyone has agreed to cease fighting.

### Beat 9 — Continue the story through consequences

Once immediate danger has ended, the DM describes the captive's current state and what remains unresolved. The party chooses whether to free the captive, search, question someone, leave, or take another action. A discovered schedule provides a lead only if the party actually obtains and understands it.

### Beat 10 — Present the next meaningful decision

“You have the captive with you, but the northern gate is now closed. The water channel still offers a route out of the courtyard; you have not established where it leads. What is your exit plan?”

This prompt is valid only if all three facts were established by the played events. Otherwise, adapt it to the committed result. The next session should remember the same captive, gate, alarm state, and unresolved route.

## 12. Source-grounded data design

These are proposed records to map onto the existing application after inspection, not instructions to create a parallel database blindly.

| Record | Purpose |
|---|---|
| Campaign contract | Rules version, allowed sources, explicit overrides, display/roll policy, boundaries, delegation |
| Source registry | Source identity, edition, revision, location, rights scope, approval state, hashes where available |
| Rules records | Stable entity IDs, actual mechanics, references to prerequisites and exceptions |
| Scene state | Positions, terrain, light, objects, doors, relevant environmental facts |
| Actor state | Resources, restrictions, ongoing effects, equipment, identity |
| Knowledge records | What each character and NPC knows, believes, observed, or was told |
| Mission state | Objectives, leads, commitments, schedules, causal clocks |
| Event ledger | Declared intentions, resolution inputs, results, source references, authorized mutations |
| Pending decisions | Whose choice is required, permitted responses, current state version |
| Session checkpoint | Recoverable state plus human-readable recap and unresolved questions |

A JSON format is not evidence of correctness. Imported material may have the wrong edition, missing restrictions, duplicate names, homebrew, or stale revisions. The source registry must make these differences explicit.

The official creator FAQ distinguishes the openly licensed SRDs from the freely readable Basic Rules website. The project should preserve its approved-source and rights boundaries instead of assuming that public readability permits corpus redistribution. [S08, S16]

### Minimal proposed resolution envelope

```json
{
  "kind": "proposed_resolution_envelope",
  "campaign_id": "example_campaign",
  "state_version": 42,
  "rules_family": null,
  "input_kind": "declared_action",
  "actor_id": "example_pc",
  "target_ids": ["example_target"],
  "intent": "prevent the alarm",
  "method": "declared weapon attack",
  "rule_refs": [],
  "retrieval_status": "pending",
  "execution_status": "not_executed",
  "pending_windows": [],
  "dice_events": [],
  "proposed_mutations": [],
  "committed_event_id": null,
  "visibility": "pending_filter"
}
```

This is an example payload, not the project's discovered schema. Null rules-family and empty references mean unresolved inputs; they must not be interpreted as permission to guess. The actual implementation should use validated types and the project's existing identifiers.

The design principle is **creative proposals are flexible; committed mechanics and established facts are accountable**. Improvising a consistent new NPC mannerism is different from inventing a spell effect or retroactively adding a secret tunnel behind the party.

## 13. Acceptance and implementation handoff

The accompanying JSON contains 48 Given/When/Then specifications. They are not executable tests and every case is marked **not_run**. They require mapping to the actual project and its selected rules adapter.

The first integration task is an evidence-backed inspection, not a rewrite. Identify the real repository, entry point, source loader, selected edition, existing state model, prompt boundaries, roll mechanism, and action executor. Preserve deployment configuration and secrets. Do not assert that a component is missing merely because a previous gameplay response looked wrong; trace the actual failure.

Use the specifications to capture a baseline. Then repair the narrow layer causing the failure. A better narration prompt cannot compensate for a missing target validator; a larger context window cannot make an unversioned record reliable; a new story generator cannot repair lost inventory state.

A meaningful end-to-end acceptance run must include a scene briefing, an information question, an exploratory or social attempt, at least one opportunity to avoid combat, a rules-correct transition when combat does occur, a complete action with its dependent timing, aftermath, a consequential next choice, and save/reload. The complete record must connect every mechanical result to its source and every changed fact to its cause.

### Acceptance evidence to retain

Keep the relevant rule IDs and versions, state before and after each committed event, actual dice records, player inputs, pending decisions, public output, private state, and explicit human rulings. Redact personal data and secrets from any exported diagnostic package.

Human review evaluates whether the information was sufficient and the play enjoyable. Deterministic checks evaluate arithmetic, legality, persistence, edition consistency, and duplicate processing. Neither replaces the other.

**Completion boundary:** This document supplies a researched operating model and proposed acceptance specifications. It does not certify the existing game, complete the video-transcript audit, modify the JSON corpus, or dispatch work to a coding agent.

## 14. Source register

Access/research date: September 9, 2026. A source being listed does not imply every page or video was completely reviewed; coverage is recorded per source. Video descriptions are not treated as substitutes for full content.

### S01 — Wizards of the Coast: Basic Rules (2014), Introduction

https://www.dndbeyond.com/sources/dnd/basic-rules-2014/introduction

Coverage: Official written play example and core conversational loop; relevant text inspected.

### S02 — Wizards of the Coast: The Basics (2024 rules family)

https://www.dndbeyond.com/sources/dnd/br-2024/the-basics

Coverage: Official DM guidance; relevant text inspected.

### S03 — Wizards of the Coast: Playing the Game (2024 rules family)

https://www.dndbeyond.com/sources/dnd/br-2024/playing-the-game

Coverage: Official exploration and combat procedures; relevant text inspected.

### S04 — Wizards of the Coast: Combat (2014)

https://www.dndbeyond.com/sources/dnd/basic-rules-2014/combat

Coverage: Official legacy combat rules, including surprise and reactions; relevant text inspected.

### S05 — Wizards of the Coast: Spells (2024 rules family)

https://www.dndbeyond.com/sources/dnd/br-2024/spells

Coverage: Official casting requirements and invalid-target handling; relevant text inspected.

### S06 — Wizards of the Coast: Rules Glossary (2024 rules family)

https://www.dndbeyond.com/sources/dnd/br-2024/rules-glossary

Coverage: Official defined terms including concentration, cover, and conditions; relevant entries inspected.

### S07 — Wizards of the Coast: DM’s Toolbox (2024 rules family)

https://www.dndbeyond.com/sources/dnd/br-2024/dms-toolbox

Coverage: Official encounter and initiative guidance; relevant text inspected.

### S08 — Wizards of the Coast: Creator FAQ

https://www.dndbeyond.com/creator-faq

Coverage: Official distinction between open SRD material and freely readable Basic Rules.

### S09 — MrRhexx: About Me

https://mrrhexx.store/pages/about-me

Coverage: Creator’s own description of his focus; inspected.

### S10 — MrRhexx: What They Don’t Tell You About Kobolds – D&D

https://www.youtube.com/watch?v=eSUBtv9iS-E

Coverage: Video title and identity verified; full transcript NOT reviewed.

### S11 — SteelySam: How to Run Kobolds in D&D

https://www.youtube.com/watch?v=KjqvkZsvOcQ

Coverage: Video title and description verified; full transcript NOT reviewed.

### S12 — SteelySam: Sessions with No Combat | DM Hotline

https://www.youtube.com/watch?v=YQsTUHkLXWU

Coverage: Video title and description verified; full transcript NOT reviewed.

### S13 — SteelySam: Making Encounters More Intersting | DM Hotline

https://www.youtube.com/watch?v=JWG4tAFsSfk

Coverage: Title spelling follows the indexed video; full transcript NOT reviewed.

### S14 — Justin Alexander: Don’t Prep Plots

https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots

Coverage: Primary GM-craft essay; relevant text inspected. Advice, not official D&D rules.

### S15 — Mike Shea: Secrets and Clues, the Secret Weapon of the Lazy Dungeon Master

https://slyflourish.com/sharing_secrets.html

Coverage: Primary GM-craft article; inspected. Advice, not official D&D rules.

### S16 — Wizards of the Coast: Systems Reference Document page

https://www.dndbeyond.com/srd

Coverage: Official SRD availability/version reference; no full corpus audit performed.

## Appendix: acceptance-specification index

| ID | Area | Scenario | Execution status |
|---|---|---|---|
| G01 | Setup | Edition unresolved | Not run |
| G02 | Setup | Corpus mismatch | Not run |
| G03 | Setup | Allowed specific exception | Not run |
| G04 | Input | Question is not consent | Not run |
| G05 | Input | Ordinary action | Not run |
| G06 | Input | Intent clarification | Not run |
| G07 | Information | Known details | Not run |
| G08 | Information | Hidden information | Not run |
| G09 | Information | Rumor stays uncertain | Not run |
| G10 | Exploration | Search has scope | Not run |
| G11 | Exploration | Failed clue attempt | Not run |
| G12 | Exploration | Repeat attempts | Not run |
| G13 | Time | Table talk versus world time | Not run |
| G14 | Time | Concurrent tasks | Not run |
| G15 | Social | Valid bypass | Not run |
| G16 | Social | NPC does not know | Not run |
| G17 | Social | Failed request is not automatic violence | Not run |
| G18 | Transition | Declaration starts combat | Not run |
| G19 | Transition | Geometry persists | Not run |
| G20 | Transition | Surprise in 2014 | Not run |
| G21 | Transition | Surprise in 2024 | Not run |
| G22 | Turn | Remaining choices | Not run |
| G23 | Turn | No generic bonus action | Not run |
| G24 | Turn | Reaction timing | Not run |
| G25 | Resolution | Attack versus save | Not run |
| G26 | Resolution | Interrupted resolution | Not run |
| G27 | Resolution | Concentration dependency | Not run |
| G28 | Resolution | Missing required record | Not run |
| G29 | Resolution | Actually cast at invalid target | Not run |
| G30 | Resolution | Blocked preflight differs from failure | Not run |
| G31 | Resolution | Damage narration agrees | Not run |
| G32 | Resolution | Sample arithmetic fixture | Not run |
| G33 | Creatures | No telepathy from model context | Not run |
| G34 | Creatures | Alarm needs a causal event | Not run |
| G35 | Aftermath | Surrender branch | Not run |
| G36 | Aftermath | Time-critical danger remains | Not run |
| G37 | Aftermath | Resources persist | Not run |
| G38 | Aftermath | Loot is not assignment | Not run |
| G39 | Recovery | Rest checks and world progress | Not run |
| G40 | Continuity | Save at a pending choice | Not run |
| G41 | Continuity | Duplicate delivery | Not run |
| G42 | Continuity | State changed before resolution | Not run |
| G43 | Agency | Absent player | Not run |
| G44 | Audit | Ruling correction | Not run |
| G45 | Corpus | Quarantined content | Not run |
| G46 | Narrative | No compulsory route | Not run |
| G47 | Information | Helpful options preserve agency | Not run |
| G48 | Encounter | Different narrative voices same mechanics | Not run |
