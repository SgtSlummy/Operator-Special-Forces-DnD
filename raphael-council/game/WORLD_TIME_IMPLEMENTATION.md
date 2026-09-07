# First fictional-time world interval

Status: implementation work card, not an implemented feature. Prepared 2026-09-06 from current Gortex source evidence. This document does not certify whole-world or full-campaign completion.

## Player outcome and complete boundary

Greyharbor begins on Day 6 with three simultaneous requests. When the party deliberately spends time in the fiction, the world retains what happens to the requests it did not select. Both Discord and the optional browser companion show the same authorized calendar, developments, opportunities, and evidence. Subsequent scene descriptions, counsel, and Witnesslight images use the resulting disclosed facts.

The first complete boundary is an authoritative Day 6 through Day 9 interval: advance time during one opening mission, process the other requests' authored deadlines, retain named consequences, and reopen the campaign with the same facts and opportunities. A calendar display, additional branch nodes, numerical track changes, or a passing reducer test alone does not satisfy this boundary. The larger Avarra/Nareth campaign, later movements, ongoing NPC simulation, and full-world art remain separate unfinished requirements.

## Authoritative evidence and current integration points

- [PERSISTENT_WORLD_PLAN.md](../../PERSISTENT_WORLD_PLAN.md), Core campaign loop and Persistent-world model: calendar and pressures advance; immutable events project into locations, factions, NPCs, clocks, intel, and later hooks. The database is authoritative; narration and proposals cannot write facts.
- [WORLD_STORY_FRAMEWORK.md](../../WORLD_STORY_FRAMEWORK.md), sections 10–12 and 13 Information boundaries: opening deadlines, exact clock causes and thresholds, fictional-time advancement, retained facts, and separate DM/NPC/player knowledge. Its old application-compatibility paragraph is not evidence that the subsequently implemented Greyharbor pack is absent.
- [world.mjs](world.mjs): `initializeWorld` creates campaign, mission-history, event, and receipt tables. `configureWorld` stores tracks plus the current mission/outcome/debrief. `validateMission` accepts consequences only as `{trackId, delta}`. `completeWorldEncounter` and `adjudicateMission` apply these reviewed changes. `recordCouncilChoice` stores one selected successor; `activateWorldMission` archives the previous mission and activates that selection. These current functions contain no calendar or elapsed-time rule.
- [content.mjs](content.mjs): the immutable, reviewed version-one pack already supports regions, locations, scenes, missions, and `nextByOutcome`. `outgoing`, `prepareContentCouncil`, and `prepareContentDeparture` select from the authored graph. Installation rejects unknown schema fields and replacement of an existing pack with a different hash. Time rules must be a reviewed schema extension/migration, not silently added fields or a second competing mission selector.
- [counsel.mjs](counsel.mjs): `askCounsel` pins game/world revisions, persists an owner-scoped receipt and evidence, and uses only authorized scene/public mission facts. `guidance` currently summarizes surroundings, readiness, or the current mission; it does not yet consult typed world developments.
- [discord/world-information.mjs](../discord/world-information.mjs): `missionPages` renders current mission, 0–100 tracks, outcome, debrief, and selection. `worldPageCard` paginates authorized information and stores revision/cursor controls. Extend this common information path rather than requiring players to open the browser.
- `GameStore.world`, `configureMission`, `transaction`, command interruption guards, HTTP authentication, saved scene projections, and image context construction are integration boundaries. Re-read their current physical source before implementation because parallel tactical and host work is active.

The strongest gap is in the shared world model: a single active mission and bounded numerical deltas cannot express a hearing that occurred elsewhere, a later consequence that has not happened yet, or which NPC learned a particular fact. This is not a claim that every auxiliary module has been exhaustively inspected.

## Authored opening interval: facts to encode, not improvise

All three requests are available together on Day 6. The party can choose their order or propose another response. Unchosen requests retain their deadlines.

| Request | Authored deadline | Immediate unresolved consequence | Separate later trigger or retained limit |
| --- | --- | --- | --- |
| The Ember Vigil (`vigil`) | Morning of Day 8: the next public emergency assembly | The assembly authorizes temporary relocation and receives a Ministry offer. Some residents accept; others stay. | Later choices depend on actual contact with the party. Do not assign invented household identities, universal hostility, an automatic breach outcome, or an automatic Ministry agreement. |
| The Lantern Accord (`accord`) | Sunset on Day 8: lamp allotment is withheld if the debt remains unresolved | Lamps are withheld and the festival uses ordinary candlelight. | The next world turn increases the local recognition threat. The settlement remains inhabited and can still be helped. The source does not specify a numerical amount or prove that this local threat is identical to the global Lost Names clock. |
| The Quiet Archive (`archive`) | The hearing on Day 9; the source gives no within-day time | The mentor loses office and the Ministry offers to administer the collection. Evidence survives elsewhere. | An appeal, witness protection request, or access negotiation is a possible next mission, not an event that has already happened. An offer is not an accepted transfer of control. |

Retain the exact factual distinctions in successful or partial resolutions as well: Bellweather's settlement and who bears its cost; who recognizes Tavin; the evidence and copies held; the hearing finding and mentor's status; who knows about the amendment; the breach condition, displaced households, and watch credibility. Those facts require reviewed outcome mappings. Existing numerical track outcomes must not be reverse-interpreted into these facts.

The four opening threat clocks are separate 0–6 values, not the current general 0–100 tracks:

| Clock | Initial value | Authored continuing cause | Authored thresholds |
| --- | --- | --- | --- |
| Lost Names | 1/6 | The amended recognition process continues in affected communities. | 3: independent households report contradictions. 5: a group is stranded in the Pale Between. 6: a beacon district suffers a major loss of recognition; this is a recovery crisis, not an automatic campaign ending. Correcting the process halts new losses; existing victims remain to be resolved. |
| Ministry Mandate | 2/6 | The Ministry provides unchallenged emergency services and obtains new agreements. | 3: Archive access. 5: a civic vote considers expanded powers. 6: the specific approving institution transfers those powers. Authority does not extend automatically to refusing communities. Evidence, alternatives, and dissent can alter the vote. |
| Lantern Fracture | 2/6 | Unrepaired beacon damage continues to strain the network. | 3: visible travel disruption. 5: a neighboring ward becomes unreliable. 6: one established link fails. Named routes/places require authored identification; repairs or negotiated alternatives can stabilize individual links. |
| Reach Divided | 1/6 | A documented dispute remains unanswered or a faction exploits a known grievance. | 3: a delegate withdraws cooperation. 5: separate agreements emerge. 6: the current regional coalition dissolves. Local relationships survive. Disagreement with an official alone is not a cause. |

Advance an eligible clock at most one step per three in-world days while its stated cause remains active. A published deadline may cause a scene sooner. Mission outcomes can pause, reverse, complete, or replace a clock when the reviewed facts justify it. The three-day rule is a rate limit, not permission to invent an active cause or an automatic escalation. Record constructive developments when authored causes support them; do not fabricate a compensating reward or require every interval to introduce a disaster.

## Proposed authoritative state and privacy contract

The names below are an implementation proposal, not claims about an existing API. Use a versioned world schema with strict keys, campaign-scoped identifiers, bounded payloads, foreign-key/reference validation, and append-only events. Preserve existing world revision semantics.

| Record | Required proposed fields and invariants |
| --- | --- |
| Calendar | Ordered fictional point, calendar definition/version, reviewed origin, and elapsed fictional duration in the configured calendar unit. A within-day milestone such as `morning`, `sunset`, or an authored hearing is distinct from a guessed clock time. Store sufficient ordering/duration evidence to evaluate intervals deterministically. |
| Clock | Stable clock ID, definition version, value/minimum/maximum, cause fact references, active/paused/resolved state, last evaluated point, accrual/rate-limit state, and consumed threshold occurrences. Keep a 0–6 clock separate from a 0–100 track. |
| Opportunity/deadline | Stable request ID distinct from a particular scene/mission-run ID, deadline definition, resolved/unresolved/superseded state, disposition fact references, and consumed deadline occurrence. Unselected requests remain present. Selection alone is not resolution. |
| World fact | Stable fact ID, typed predicate, entity references, bounded value, effective fictional point, source event, definition version, and explicit visibility grants. Facts include location conditions, an offer versus an agreement, institutional decisions, possessions/copies, and named NPC conditions or obligations. Never accept arbitrary object paths as mutations. |
| Knowledge or belief | Subject kind/ID (`npc`, individual player/character, or shared party), fact/claim ID, learned-at event, source, and confidence/status. A private observation becomes shared only through an explicit supported sharing event. NPC knowledge is not omniscience; rumors do not become verified facts merely because someone believes them. |
| Conditional development | Definition ID, prerequisite fact references, earliest/due point, supported effect IDs, and pending/fired/cancelled state. It is a possibility until its prerequisites occur; it must not enter the factual timeline early. |
| World event | Campaign, immutable event ID and type, world revision/order, fictional effective point, audit timestamp, initiating actor/source, affected entity IDs, validation/definition version, causation ID, typed payload, and separately authored public summary. Audit wall-clock time never advances fictional time. |

Visibility is explicit: host-only author facts; named player grants; shared-party facts; and separate NPC knowledge records. Use independently scoped projected summaries, not a shared payload with secret fields hidden only by the UI. Do not reveal secret names, IDs, counts, trigger conditions, image prompts, event links, or council explanations through public metadata.

Current `worldView(db, campaign)` spreads the stored body and latest events without an owner-specific projection. Refactor it and its callers before storing private world data in that body. Membership is checked on every query and replay. Hosts can inspect author state; an NPC's permitted reasoning still uses that NPC's knowledge. Player image/counsel endpoints never inherit host author context by accident.

## Explicit host review and time command

Implement a host-only review/preview followed by an explicit `advanceWorldTime` command. Players can request travel, rest, or another approach through existing play, but neither a narrator proposal nor a player image request directly advances the calendar.

Proposed command envelope: `requestId`, `expectedGameRevision`, `expectedWorldRevision`, `expectedDefinitionVersion`, `reviewed: true`, `previewId`, and a bounded `reason`. The saved preview pins the current and target fictional points, reviewed duration/ordering information, causal facts, and proposed event sequence. The server derives consequences from installed definitions and current facts; the client cannot submit track deltas, arbitrary facts, hidden knowledge grants, or clock increments.

A preview is read-only and is not authority to commit after its evidence changes. Explicit confirmation is part of the product's host workflow, not a requirement for a developer to seek fresh permission for every implementation edit. Unknown timing, causal predicates, or outcome mappings must be shown as unresolved review items, never filled from model prose. Finish those authored records before enabling an advance that depends on them.

Commit within the same authoritative transaction boundary as game/world changes. Revalidate current host membership, exact preview fingerprint, all revisions, definitions, and interruption state. New advances are rejected during unresolved tactical/check/reaction/concentration decisions, active combat, or pause; time resumes only after the existing play decision is settled. Read-only world views and image requests remain available. This initial between-scenes/exploration policy must not be presented as full rest, travel, recovery, resource, or spell-duration mechanics.

## Deterministic evaluation and immutable receipts

1. Authenticate and validate the command envelope. Look up an existing owner-scoped receipt before new phase/revision checks. Return the original receipt only for the identical fingerprint and current authority; changed input with the same request ID is a conflict. Do not recompute previous outcomes.
2. Validate that the target is strictly later and that duration/ordering are supported by the reviewed calendar. Load the frozen definition set and causal facts. Preflight all intervening boundaries; reject missing mappings before any partial state is committed.
3. Enumerate intervening authored deadlines, eligible three-day clock intervals, and conditional triggers in a stable order. When simultaneous developments affect one another, the reviewed definitions must give an explicit order or prove independence; sorting IDs alone must not decide a story outcome.
4. Evaluate against the state at each boundary. Cause changes divide intervals. Persist enough interval history to prevent repeated short advances from exceeding the clock rate limit. The initial accrual anchor and whether paused intervals retain partial progress must be explicit reviewed policy; the source does not settle these details.
5. Consume each logical occurrence using a unique campaign/rule/definition/occurrence key. Append its event and project its effects together. A clock threshold that creates a named development needs its reviewed entity mapping. Do not retrigger a one-time deadline because a new HTTP request ID is used or because a campaign is restored.
6. Keep the Accord's immediate lamp/festival event separate from its later next-world-turn recognition consequence. Whether a multi-boundary advance contains that next world turn must be explicitly defined and visible in the preview; do not silently collapse it into the deadline event.
7. Commit final fictional time, world/game revisions, projections, relevant outbox records, and a receipt containing the original start/end points, ordered committed event references, and final revisions. Public and private result projections derive from these records. A failure rolls back the entire command.

No RNG or model call is needed to replay time. If a future authored development requires a random result or a player decision, use a separately persisted typed resolution, with its own continuation and receipt. It cannot be guessed while advancing time.

## Legacy campaigns and content compatibility

Fresh campaigns can opt into a reviewed versioned time definition at creation/install. Existing campaign rows, mission outcomes, pack hashes, receipts, and scene continuity remain valid.

Do not infer elapsed days from SQL timestamps, combat turns, completed mission counts, session age, or the application launch date. A legacy campaign with no calendar stays explicitly uninitialized until a host reviews an adoption point, current deadline dispositions, causal facts, clock values/accrual policy, and existing consequences. The migration records provenance and changes its schema version once; it does not retroactively fire Day 8/9 events or recast prior narrative as facts.

Adding executable time definitions requires a reviewed pack/schema migration because version-one pack fields are strict and installed content is immutable. Preserve the original hash and record the migration mapping. Preserve one-time mission-run identities and the existing DAG constraints while adding opportunity-level deadline state. Do not reuse an archived mission ID to model an appeal or a return visit. A new hook needs its own reviewed mission/scene mapping, or must remain visibly a lead awaiting authored preparation.

All new records and occurrence keys must be covered by the coordinated campaign backup/restore and migration validation. Restore must retain receipt bodies and consumed occurrences exactly. No live-campaign adoption or migration is authorized by this work card alone; build and verify it with disposable fixtures first.

## Both-client presentation and downstream context

Discord retains every required action and fact. Provide a world-time card with calendar, disclosed deadlines, eligible opportunities, public development history, and source references; paginate full authorized details with existing world-card controls. Host-only controls open the review, show timing gaps and consequences, and confirm the saved preview. Where an interactive control is unavailable, offer the same information and supported command path in Discord. The browser provides the equivalent view and an optional clearer timeline; it is never a mandatory approval or information surface.

Both clients refresh from authoritative revisions, reject stale confirmations, retry uncertain commits with the identical request ID, and clear private state when authentication changes. A timeline entry must distinguish an actual event, a reported rumor, and an untriggered possibility. Hidden developments must not create a player-visible numbering/count leak.

Pass authorized, evidence-linked world facts into council/counsel context, scene packets, and image prompts. Preserve saved counsel and previous image artifacts as historical records. An image request during pause/off-turn still costs no action, time, or roll. Its packet pins game/world revision and visible facts; a later world change invalidates reuse as the current scene where relevant, without rewriting an earlier picture. Witnesslight style remains realistic dramatic D&D-inspired painting with selective detail and restrained backgrounds. Illustrate the actual lamps, displaced residents, weather, or route conditions only when those facts are established and visible. Whole-world image generation is not completed by adding a time field to a prompt.

## Required proof before this card is complete

- Source-backed fixtures for each exact opening deadline and initial clock value; unknown start/hearing timing or entity mappings are rejected, not silently defaulted.
- Explicit Day 6 to Day 9 play-through while one opening request is selected, demonstrating other unresolved requests persist and process independently. Picking a mission does not resolve another. Reviewed successful or partial outcomes change only the supported deadline/clock predicates.
- Morning versus sunset ordering on Day 8; Day 9 hearing resolved at its reviewed milestone. No event before its deadline. Immediate, next-world-turn, and merely possible consequences remain distinct.
- Three-day rate-limit tests across one long advance, repeated shorter advances, cause changes, paused/resolved clocks, threshold crossings, and maximum values. Equivalent supported intervals yield the same committed facts; no ID ordering determines a contested consequence.
- Transaction rollback, stale preview/revision rejection, simultaneous host requests, same-request replay after restart, altered-payload conflict, and a new request ID crossing an already consumed occurrence. Check committed event/receipt content and absence of duplicate effects, not merely the displayed final number.
- Existing paused/pending/combat guards and replay authority remain valid. Queries, offline time, reload, narration, counsel retrieval, and image requests do not advance fictional time.
- Legacy adoption preserves existing outcomes/HP/mission/receipt state, performs no invented catch-up, and round-trips through backup/restore with consumed deadlines and interval accrual intact.
- Host/player/cross-campaign privacy tests cover body, events, source IDs, counts, council/counsel packets, image requests/status/artifacts, and exports. NPCs cannot react to a fact they have not learned. A private player observation is not automatically a party fact.
- Actual browser and Discord adapter acceptance from the same disposable campaign: equivalent calendar/deadline/history information, host-only review/confirm, paginated complete facts, stale and uncertain-submit recovery, and no browser dependency for required play.
- Updated scene/counsel/image evidence after a world event plus unchanged historical receipts and images. Image context tests must verify the changed visible content, not only a bumped revision.

These are implementation acceptance requirements, not tests run by this document-writing task.

## Remaining factual and implementation decisions

Resolve these from authoritative authored content or explicit host-reviewed campaign configuration; do not pretend the inspected source answered them:

1. Day 6's starting within-day point, the calendar's elapsed-duration unit, the Day 9 hearing's within-day milestone, and each clock's initial three-day accrual anchor.
2. How partial active intervals accrue when a cause pauses/restarts; how one explicit multi-day advance maps to successive world turns for delayed effects; and ordering for dependent events at the same fictional point.
3. Stable NPC, location, institution, household, ward, route, and fact IDs for authored threshold consequences. Exact names for unspecified groups/delegates/links require authoring, not inference.
4. The specific numerical or typed effect and target of the Accord's later local recognition threat. The prose does not define a delta or equate it to Lost Names.
5. Mappings from every applicable existing Greyharbor outcome to deadline resolution, causal facts, knowledge, and clock changes. Track values alone cannot establish those mappings.
6. Exact migration integration, image-packet/cache fields, current UI ownership, and all pending-decision APIs. Re-read those implementation surfaces immediately before edits; this card inspected world/content/counsel/world-information, not every transport, image, backup, or tactical module.

The next implementation step is to add the strict time-definition/state schemas and a pure interval evaluator alongside a reviewed opening definition, keeping unresolved authored fields explicit. Then integrate one atomic service command and both clients through the existing world service. Do not report this boundary finished until the Day 6–9 end-to-end evidence above is present.
