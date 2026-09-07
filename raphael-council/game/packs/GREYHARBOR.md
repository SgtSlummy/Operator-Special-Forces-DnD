# Greyharbor opening content proposal

`greyharbor.mjs` adapts the authored opening in [WORLD_STORY_FRAMEWORK.md](../../../WORLD_STORY_FRAMEWORK.md). It is **proposed content requiring host review**, with no `reviewed: true` flag, automatic installation or real-campaign state changes. Import it only in host/server tooling; the complete pack contains unrevealed possible outcomes and future scenes.

`createGreyharborProposal()` returns fresh `{ review, openingMissionId, tracks, pack }` data. Review information stays outside the strict runtime pack. This is an opening continuation, not the full campaign or a substitute for the canonical framework.

## Authored story and proposed mechanics

The source establishes the Day 6 unlit paper bird at the Last Hearth, Lysa, yesterday's ferryman, Raphael's personal manner of speaking, and three simultaneous requests:

| Request | Source objective and deadline | Supported adjudicated outcomes |
| --- | --- | --- |
| The Lantern Accord | A settlement Bellweather accepts; lamp allotment at sunset Day 8 | Revised agreement; shared repayment and independent maintenance; challenge the recognition clause; community settlement; unresolved |
| The Quiet Archive | Establish the missing record's contents and access; hearing Day 9 | Original recovered; copy corroborated; scribe account; adjournment; unresolved |
| The Ember Vigil | Explain the alarms and permit an informed local safety decision; assembly morning Day 8 | Signals investigated; people protected during examination; voluntary temporary relocation; Hollow located; unresolved |

The 23 mission records represent stages and different request orders, not 23 different canonical crises. The five local maps are the Last Hearth map room, Bellweather ferry house, Sunken Archive lower reading room, Ember Crossing beacon chamber, and the optional failed-warning confrontation. All six orders of the three requests remain possible. Each request can lead home; after the last request the party can return home or review its next concerns there. An unfinished request remains unfinished in the fictional world even when the current scene is debriefed.

The only combat opponent is the canon's predatory Hollow. The Hollow is distinct from erased people. Combat neither resolves political disputes nor automatically repairs the beacon. A separate noncombat follow-up returns the decision to the town. The conditional edge to the Hollow is offered only after the host records that it was actually located.

**Proposals, not source facts:** map dimensions, cell layout, entrances, the Hollow's statistics, council ratings and the ±3 Crossing readiness combat adjustments. Maps are schematic local playing surfaces, not a claim about architectural measurements or regional geography. Eight entrances reserve separate 4×4 footprints; the installer must still validate the actual party. A host can revise this proposal before its first immutable installation, including reducing a map to match a described room. No player identity, character statistics or likeness is invented.

The eleven opening track values are taken from framework §12. Their labels distinguish public attention, Nightglass influence, trust, readiness and place confidence. No values are used as permission to override consent or infer automatic hostility.

## Runtime contract

Narrative missions use `resolution: 'adjudicated'` and private `outcomes: [{ id, title, summary, changes }]`. They have no enemy-team success test. The host confirms a result only after it occurred in play, using `adjudicateMission(scope, { reviewed: true, requestId, expectedRevision, expectedWorldRevision, outcomeId })`. That request must save the selected result once, move the mission to debrief and preserve actors, injuries, profiles, dice and time. It must reject stale revisions, a different reused request and unauthorized callers. No end-turn action may finish a narrative objective.

For the four possible visits to the Vigil request stage, `nextByOutcome` maps every outcome to its allowed continuation IDs. `next` is their union for graph validation. Only `hollow-located` adds the combat branch. Missing or unknown outcome state must fail closed, not fall back to the full union. Future outcome summaries and unavailable branches must stay out of player projections.

**Validation status:** content fidelity, graph, all six request orders, conditional edges, private-story exclusions and eight size-four entrances are checked in `../greyharbor-pack.test.mjs`. Runtime installation, adjudication, restart and return verification is still pending the corresponding engine implementation; this document does not certify those behaviors yet.

The fixture installer must first create a disposable campaign using approved fixture actors on `last-hearth-map-room`, configure the returned opening mission and tracks, then explicitly review and install `pack`. Never install the proposal into a real campaign merely to make a test pass. The pack ID is `greyharbor-opening-proposal-v1`; the root mission ID is `greyharbor-arrival`.

## Host record and remaining scope

The host must record exact terms, who paid, each community's consent, evidence contents and recipients, testimony, hearing findings and local decisions in the session record before confirming an applicable outcome. The proposal's compact outcome text does not manufacture those details. Choosing a menu item alone cannot create an NPC's consent or prove an unobserved event.

The canonical clocks and deadlines require fictional-time services. This pack does not advance them on departure, debrief, a request for an image, or time spent offline. A Day 8 or Day 9 deadline stays open until the host advances the corresponding fictional time and records the justified consequence. Tavin's identity, Oren's private starting knowledge, the culprit and later revelations are not disclosed in opening briefs or council explanations.

The first terminal homecoming ends this bounded pack, not the campaign. Further visits, split-party work, freely invented approaches, full settlement/evidence/knowledge records, the Festival's conditional climax, later movements and Nareth require the next reviewed continuation or broader engine support. The full user goal remains incomplete until those requirements have evidence.

The pack carries no automatic art references because its current map schema has no per-character image binding. Existing [Witnesslight collection](../../../campaign-art/witnesslight/COVERAGE.md) assets remain candidate references for a host-reviewed observable view. Never reuse a wide establishing picture as proof of a character's current sight, exact distance or a hidden discovery.
