# Discord campaign run template

A complete player journey for Behind the Veil, with a reusable mission structure and 34 interactive mockups.

This is a proposed experience and original sample content. It is not installed in Discord, a live server template link, a tested multiplayer integration, or established campaign history. The sample personas, approvals, rolls, outcomes and saved checkpoint are illustrative. The assumed scope is a full D&D campaign player journey; camp and downtime are included as one recurring phase.

## Use this package

Open `player-walkthrough.html` in a browser, or use the embedded preview in the accompanying Codex response. The step selector and arrows are review controls outside the proposed Discord interface. Most message buttons demonstrate an immediate response or lead to the next screen. Forms accept local sample input. No button contacts Discord, publishes a message, changes a character, rolls real campaign dice, or saves real progress.

The first 24 screens cover the main journey. Screens 25–34 cover approval, corrections, private help, and recovery. They are available directly from the selector and from relevant buttons. A reviewer may jump to any screen; a live implementation must enforce its own prerequisites.

Use the generic copy blocks below for a GM-run rehearsal. Text in double braces is a field to replace. Buttons shown in the mockups require a campaign app implementation; pasting a message into Discord does not create buttons. Without that implementation, the GM posts the text and players reply in the session thread. Use the existing approved rules, character sheets and encounter mechanics.

## The experience

A player always needs three things: the current situation, the next choice they can make, and an honest result or waiting status. One active scene message anchors the session, with normal conversation underneath it. Longer rules, inventory and background are available when requested.

The proposed path is:

**First visit:** welcome → table agreements → participation preference → character → GM approval → introduction.

**Each session:** invitation → readiness → opening → action → adjudication → consequence → another choice.

**When the fiction requires it:** initiative → turn intention → validation and resolution → return to the scene.

**After the mission:** actual outcome → shared items → camp and downtime → corrected recap → saved checkpoint → next invitation.

**At any time:** help, pause, reconnect, or request a correction.

This is a branching journey, not a 34-step obstacle course. Setup happens once unless something changes. Conversation and exploration repeat as needed. Combat is optional. Returning players bypass setup. No vote, timeout or generated narration chooses an action for a silent player.

## Fill in one run card

Copy this block before preparing a new run. Unfilled required fields block the GM's invitation; they should never appear as raw placeholders in a player message.

```yaml
campaign_name: "{{CAMPAIGN_NAME}}"
run_id: "{{UNIQUE_RUN_ID}}"
mission_title: "{{MISSION_TITLE}}"
gm_display_name: "{{GM_NAME}}"
gm_private_contact: "{{AGREED_PRIVATE_CONTACT_ROUTE}}"
ruleset_and_edition: "{{RULES_AND_EDITION}}"
house_rules: "{{PLAYER_VISIBLE_RULES_LINK}}"
starting_level: "{{STARTING_LEVEL}}"
character_options: "{{APPROVED_SHEETS_OR_REVIEW_ROUTE}}"
player_count: "{{MIN_AND_MAX_PLAYERS}}"
start_time: "{{START_TIME_WITH_TIMEZONE}}"
planned_duration: "{{DURATION}}"
participation: "Text always available; voice optional"
recording: "Off unless separately agreed"
transcription: "Off unless separately agreed"
opening_location: "{{REVEALED_LOCATION}}"
public_objective: "{{ONE_SENTENCE_OBJECTIVE}}"
visible_situation: "{{SHORT_SENSORY_DESCRIPTION}}"
known_routes: "{{REVEALED_ROUTES_ONLY}}"
visible_pressure: "{{FICTIONAL_PRESSURE_OR_NONE}}"
scene_questions: "{{QUESTIONS_THE_PLAYERS_CAN_INVESTIGATE}}"
permitted_illustration: "{{APPROVED_IMAGE_OR_NONE}}"
text_alternative: "{{WHAT_THE_IMAGE_SHOWS}}"
rest_policy: "{{AGREED_RULES_AND_GM_ADJUDICATION}}"
loot_policy: "Propose; discuss; confirm; then assign"
absence_policy: "{{TABLE_APPROVED_POLICY}}"
checkpoint_name: "{{LAST_CONFIRMED_CHECKPOINT}}"
next_session: "Unscheduled until confirmed"
```

Keep GM facts in a separate, access-controlled preparation record: NPC intentions, hidden locations, unrevealed clues, encounter statistics, possible consequences, and authority to approve characters. Never place that record in the player-visible run card, image prompt, message attachment or recap.

## Discord spaces and visibility

This is a proposed layout to create or adapt when implementing the design. Names can change; visibility must be tested independently of the names. Use a campaign role for campaign spaces and distinct access for GM preparation. Do not grant campaign players moderation powers merely to make game interactions work.

| Space | Who sees it | Purpose |
|---|---|---|
| `#start-here` | Invited server members | Pinned welcome and setup entry |
| `#table-guide` | Invited members | Rules, agreements, participation guidance and named GM contact |
| `#characters` | Campaign members | Approved public character summaries; private draft and review responses through the app |
| `#mission-board` | Campaign members | Current mission, availability and next-session entry |
| Session thread, e.g. `session-01` | Members who can access its parent campaign channel | Scene anchor, player actions, adjudication and actual outcomes |
| `#camp` | Campaign members | Downtime, bonds and party item decisions |
| `#chronicle` | Campaign members | GM-published draft and confirmed recaps; corrections submitted through the agreed route |
| `#table-talk` | Campaign members | Out-of-character questions and manual fallback |
| Table voice | Campaign members | Optional spoken participation |
| GM preparation space | Authorized GM/staff only | Hidden state and approvals; omitted from the player mockup |

Thread permissions derive from the parent channel, and speaking in a thread requires the thread-specific send permission. Private threads are not a universal confidentiality boundary: authorized moderators can access them. Test access with actual member roles rather than relying on a “private” name. These recommendations follow Discord's thread model.[2]

Start with the pinned welcome flow for a small private campaign. Native Community Onboarding can assign channels and roles, but its current publication requirements include at least seven default channels and five that everyone can view and send in. Do not expand a small game server solely to meet that feature's requirements.[3]

Private app responses are appropriate for a player's draft, settings or validation error. They are visible only to the invoking user in the chat interface; submitted form data still reaches the app. A private response is not durable storage or a claim that the app operator cannot access the data.[4]

## Every player-visible step

Each row names the mockup, its trigger, the player's meaningful input, and the resulting state. The linked mockup numbers are review order; the real journey follows the branches.

| # | What the player sees | Input and immediate response | Advance condition |
|---:|---|---|---|
| 01 | Welcome, premise, format, first-session length | Start setup; returning-player entry; help | New player chooses setup; returning player goes to 24 |
| 02 | Short table agreements and pause option | Acknowledge this version or contact GM | Agreement accepted; unresolved concerns have a named route |
| 03 | Text/voice preference and recording status | Select a participation format; save receipt | Preference saved; no recording or transcription consent inferred |
| 04 | Prepared characters or bring-your-own route | Choose a persona or open sheet form 33 | A draft is selected; no rules sheet is presumed approved |
| 05 | Short personalization form | Name, introduction, optional mission bond | Valid form retains the player's own words |
| 06 | Private review of the character draft | Send to GM or edit | Submit moves to Pending, screen 25 |
| 07 | Approved introduction and another squad member | Post introduction, agree on a bond, or defer | Player shares only their own approved details |
| 08 | Mission invitation with time, duration and location | In / Maybe / Can't attend; receipt | GM confirms roster and time |
| 09 | Lobby, selected character and readiness | Ready, sheet, or need a moment | GM verifies the group and opens the scene |
| 10 | Short atmospheric opening and immediate objective | Look around, describe an action, pause | A player chooses an intention; GM responds |
| 11 | Visible scene facts, pressure and suggested approaches | Inspect, talk, or propose another approach | Obvious facts can be given directly; uncertain attempts are adjudicated |
| 12 | Free-form action form | State an attempt; receive an action receipt | Intent awaits resolution; it is not recorded as success |
| 13 | A specific requested check with known modifier | Roll once or revise the attempt | Authorized actor resolves the request under agreed rules |
| 14 | Readable arithmetic and actual consequence | Continue, ask, choose route, or request correction | The resolved event is recorded once |
| 15 | NPC dialogue, known facts and unconfirmed claims | Ask a question, offer something, or speak freely | GM answers in character and adjudicates when needed |
| 16 | Known routes and tradeoffs | Mark a preference or propose another plan | Group discussion and GM-confirmed approach; no automatic movement |
| 17 | Initiative request when combat actually begins | Roll initiative; ask a question | Authoritative order is ready; peaceful play bypasses 17–19 |
| 18 | Private turn options and known-position map | Choose intent, describe another action, ask help | Active player reviews intended action |
| 19 | Actor, intent and validated cost review | Submit or change | Authority validates latest state; resolve and charge costs once |
| 20 | Actual mission outcome and recovered items | Propose custody, challenge a mismatch, head to camp | Contested items stay unassigned; confirmed outcomes recorded |
| 21 | Camp and downtime choices | Propose conversation, investigation, rest or another activity | GM confirms time, eligibility, effects and costs |
| 22 | Draft recap: confirmed facts, statements, questions, choices | Confirm own review, correct, or add optional highlight | GM reconciles corrections; nobody approves for the whole party |
| 23 | Confirmed checkpoint and next-session status | Share availability, read recap, return later | Display Saved only after durable save succeeds |
| 24 | Private returning-player summary | Join lobby, recap, preferences | Load current membership and state before actions |
| 25 | Pending character review | Edit draft; read guide | GM explicitly approves or requests changes |
| 26 | Character approved | Meet squad; review sheet | Approval matches the current sheet version |
| 27 | Exact change requested by GM | Update missing information; ask GM | Resubmission preserves prior work and returns to review |
| 28 | Table paused, current action preserved | Ready to continue; private contact | GM checks all participants before resuming |
| 29 | Reconnected: received, resolved or missing action status | Go to current scene; read recent events | Durable action receipt determines whether retry is needed |
| 30 | Old control or wrong-turn response | Open current scene or character | No resources spent; actor gets current valid options |
| 31 | GM-posted bot/save outage notice | Pause or agreed manual fallback | Recover state and reconcile any manual log first |
| 32 | Public-question and private-contact routes | Ask without disclosing personal details publicly | Named GM/support route available even when DMs fail |
| 33 | Character sheet submission/update form | Name, accessible sheet link, optional note | Validate and review; link submission is not approval |
| 34 | Correction form with optional supporting detail | Submit; pending-review receipt | GM reviews before established events or resources change |

### Review-only controls in the mockups

“Preview approved response,” “Preview requested changes,” “Preview peaceful route,” “Preview recovered state,” “Preview pause,” and “Preview next response” let a reviewer inspect branches without a real second account or bot. They must not ship as player powers. In particular, player controls cannot approve a character, finalize a whole-party recap, force the GM to start a scene, or invent a successful save.

The generic actions shown after forms are local simulations. The walkthrough selector can intentionally show an approved, resolved or saved example without performing that operation. A release candidate must replace those fixtures with real permissions and authoritative state.

## Copyable player messages

Keep the welcome and guide pinned. Post a new scene message when the situation meaningfully changes; use short replies for acknowledgements so conversation remains readable. The following is reusable message copy, not a Discord API payload.

### 01 · Welcome

```text
Welcome to {{CAMPAIGN_NAME}}.

{{ONE_SENTENCE_PREMISE}}

Play: {{RULESET}} · {{PLAY_STYLE}}
First session: {{DURATION}} · {{PLAYER_COUNT}}
New players are welcome. Text participation is available.

New here? Start setup.
Returning? Open your saved session.
Need help? Contact {{GM_NAME}} through {{HELP_ROUTE}}.
```

### 02–03 · Agreements and preferences

```text
Before we begin

Share the spotlight. Ask before changing another character's story.
Anyone can pause or step away without explaining why.

Table tone: {{AGREED_TONE}}
Rules and house rules: {{RULES_LINK}}
Private concerns: {{GM_PRIVATE_CONTACT}}

Choose how you want to participate: text, voice, or both.
Recording: {{STATUS_AND_SEPARATE_CONSENT_ROUTE}}
Transcription: {{STATUS_AND_SEPARATE_CONSENT_ROUTE}}
These choices can be revisited later.
```

Do not combine an acknowledgement of table conduct with recording consent. The default sample is recording and transcription off. Keep sensitive personal limits out of the public guide and recap.

### 04–07 and 25–27 · Character and introduction

```text
Who are you bringing?

Choose an approved prepared sheet, or submit your own for review.
Tell us your character's name and one thing the squad first notices.
A connection to this mission is optional.

Draft: {{CHARACTER_NAME}}
Introduction: {{PLAYER_APPROVED_INTRODUCTION}}
Status: {{DRAFT | PENDING | APPROVED | CHANGES_REQUESTED}}

{{IF_CHANGES_REQUESTED: EXACT_GM_NOTE_AND_NEXT_STEP}}
Nothing is posted to the squad until you choose to share it.
```

For approval, use a separate short response: “{{CHARACTER_NAME}} is approved for {{RULESET_AND_STARTING_LEVEL}}. You can now introduce yourself to the squad.” For pending: “Your character is saved for GM review. We will tell you when it is approved or what needs changing.”

### 08–09 · Invitation and lobby

```text
{{MISSION_TITLE}}

Objective: {{PUBLIC_OBJECTIVE}}
When: {{PLAYER_LOCAL_DATE_TIME}}
Length: {{PLANNED_DURATION}}
Where: {{SESSION_THREAD}} · optional {{VOICE_CHANNEL}}

Are you in, maybe, or unavailable?
The GM will confirm the roster.
```

```text
Ready check

Your character: {{APPROVED_CHARACTER}}
Your participation: {{PREFERENCE}}
Table status: {{WHO_IS_READY_WITHOUT_PRIVATE_DETAILS}}

Mark yourself ready, review your sheet, or ask for a moment.
The GM will start once the group is ready.
```

### 10–12 · Scene and open action

```text
{{REVEALED_LOCATION}}

{{SHORT_VISIBLE_SITUATION}}

Objective: {{IMMEDIATE_OBJECTIVE}}
Visible pressure: {{ESTABLISHED_FICTIONAL_PRESSURE_OR_NONE}}
What you know: {{PLAYER_VISIBLE_FACTS}}

What do you do?
You could {{EXAMPLE_APPROACH_1}}, {{EXAMPLE_APPROACH_2}}, or try another plan.
```

Action receipt: “{{ACTOR}}, your attempt was received: {{INTENT}}. Waiting for {{GM_OR_RULES_AUTHORITY}}. No result yet.” If the intent was not received, say so only after checking the action record.

### 13–14 · Check and consequence

```text
{{ACTOR}} — requested check

Attempt: {{DECLARED_INTENT}}
Check: {{VALIDATED_CHECK_AND_MODIFIER}}
Stakes you know: {{DISCLOSED_STAKES}}

Roll once when ready, or explain how you want to change the attempt.
```

```text
Result: {{DIE_RESULT}} + {{VALIDATED_MODIFIER}} = {{TOTAL}}

{{ACTUAL_ADJUDICATED_CONSEQUENCE}}
Recorded: {{ESTABLISHED_CHANGE}}
Still unknown: {{OPEN_QUESTION}}

What do you do next?
If this does not match what happened, request a correction.
```

An unrequested roll may be acknowledged, but it must not silently resolve a different action. Failure must use actual rules and consequences; the template must not prewrite a successful rescue.

### 15–16 · Conversation and party decision

```text
{{NPC_NAME_OR_REVEALED_DESCRIPTION}}

“{{NPC_DIALOGUE}}”

Known: {{CONFIRMED_INFORMATION}}
Unconfirmed: {{CLAIMS_OR_SUSPICIONS}}

Ask a question, offer something, or say what you choose.
```

```text
Choose an approach

{{OPTION_A}} — {{KNOWN_TRADEOFF_A}}
{{OPTION_B}} — {{KNOWN_TRADEOFF_B}}
Or propose another plan.

Share your preference, then agree as a squad.
A vote does not move the party or choose for someone else.
```

### 17–19 · Optional combat

```text
Combat begins: {{VISIBLE_TRIGGER}}

Objective: {{SCENE_OBJECTIVE}}
Known opposition: {{REVEALED_OPPONENTS}}
Roll initiative when requested.
You may still propose negotiation, surrender or retreat when the situation allows.
```

```text
{{ACTOR}}, it is your turn.

Current position: {{AUTHORITATIVE_POSITION}}
Known targets: {{LEGAL_REVEALED_TARGETS}}
Available resources: {{CURRENT_RESOURCES}}

Choose an action or describe your own.
Before committing, review actor, target, movement and exact validated costs.
```

Resolution receipt: “{{ACTION_ID_OR_READABLE_REFERENCE}}: {{RECEIVED | RESOLVED | REJECTED}}. {{ACTUAL_EFFECT_OR_REASON}}.” Other players receive public results, not another character's private choices or hidden resources.

### 20–21 · Outcome and camp

```text
Mission outcome

{{ACTUAL_OUTCOME}}
Recovered: {{CONFIRMED_ITEMS}}
Losses or injuries: {{ESTABLISHED_STATE}}
Unassigned items: {{PENDING_PARTY_DECISIONS}}

Propose item custody, discuss it, then confirm the assignment.
Nothing is claimed automatically.
```

```text
Camp at {{CONFIRMED_LOCATION}}

{{CURRENT_VISIBLE_SITUATION}}

Would you like to talk, investigate, check on someone, request a rest,
or do something else?

The GM confirms time, eligibility, costs and effects before applying them.
```

### 22–24 · Recap, save and resume

```text
Draft recap — {{SESSION_TITLE}}

Confirmed: {{ESTABLISHED_FACTS}}
NPC statements: {{ATTRIBUTED_CLAIMS}}
Open questions: {{UNRESOLVED_QUESTIONS}}
Pending choices: {{UNMADE_PLAYER_DECISIONS}}

Does this match what happened? Confirm your own review or suggest a correction.
```

```text
Saved checkpoint: {{CONFIRMED_CHECKPOINT}}
Party location: {{CURRENT_LOCATION}}
Pending: {{UNRESOLVED_ACTIONS_OR_CHOICES}}
Next session: {{CONFIRMED_DATE_OR_NOT_SCHEDULED}}

When you return, open this recap and join the next lobby.
```

Use “Save pending” or “Save failed” until persistence is confirmed. On return: “Welcome back, {{CHARACTER}}. Last confirmed: {{CHECKPOINT}}. Since you left: {{PLAYER_VISIBLE_CONFIRMED_CHANGES}}. Your pending action: {{CURRENT_STATUS}}.”

### 28–34 · Recovery and support

```text
Table paused.
No explanation is required here. Your current action is preserved.
Mark yourself ready when you are comfortable; the GM will check everyone.
```

```text
Welcome back.
Last action: {{INTENT}} — {{RECEIVED | RESOLVED | NOT_RECEIVED_AFTER_CHECK}}
Current scene: {{AUTHORITATIVE_SCENE}}
Next step: {{WAIT | REVIEW_RESULT | RESUBMIT_IF_CONFIRMED_MISSING}}
```

```text
That control is out of date or is not yours to use.
No resources were spent. Open the current scene for your available actions.
```

```text
GM notice: the campaign app is unavailable.
We are holding at {{LAST_CONFIRMED_CHECKPOINT}} while the last action is checked.
Do not repeat rolls or resource spends.
We can pause, or agree to a manual log and reconcile it before resuming the app.
```

```text
Correction received.
Your suggestion: {{PLAYER_PROPOSED_CORRECTION}}
Status: pending GM review.
The confirmed event record has not changed.
```

For private support, identify the real GM and the agreed contact route. If direct messages fail, offer a public request for a private check-in without requiring the player to disclose their concern.

## Worked run: The Signal Beneath Saltglass

The project research describes Behind the Veil around Saltglass Shore, with a courier rescue, a patrol, later leads and debrief. Its recommended rehearsal leaves room for exploration, negotiation, relationships and consequences. It also separates AI recommendations from player and mechanical authority.[6] The mockups adapt that original rehearsal; they do not add its sample events to campaign history.

Prepare one GM and two approved characters for a 45–60-minute opening. The larger template accommodates a GM and 2–4 players, but additional players will need more time for introductions and decisions. Prepared names in this package are personas only, not approved mechanical sheets.

| Approximate play time | Situation to present | Decision to invite | Record only after play |
|---|---|---|---|
| 0–5 min | Cart, light beneath the water, knocking | Approach, observe, signal, help, or another attempt | Player introductions and initial intent |
| 5–15 min | Courier and trapped axle | Aid, stabilize, investigate, ask questions | Actual courier condition and discovered facts |
| 15–25 min | Moving patrol lights or a contact | Talk, hide, distract, withdraw, or fight if warranted | What each side actually knows and any cost |
| 25–40 min | Known extraction routes | Rocks, checkpoint, split tasks or another plan | Agreed route and actual consequences |
| 40–50 min | Mission resolution | Who gets help, who holds items, what is revealed | Actual success, setbacks, injuries, losses and unresolved items |
| 50–60 min | Camp and debrief | Downtime intention, next lead, recap correction | Confirmed checkpoint and outstanding choices |

Timing guides facilitation, not player pressure. Do not advance a fictional clock because someone needs more time to read, uses text instead of voice, or pauses for accessibility. Pressure must be explained through established events.

The sample success screen assumes the courier was freed, a +3 modifier was valid, and the GM resolved the check. The sample peaceful ending assumes extraction succeeded. A real run must replace those values and outcomes with the actual record. A combat branch may take more time; end at a checkpoint instead of rushing to fit every mockup into one session.

## Delivery design and research basis

The recommendations below distinguish documented platform capabilities from proposed campaign behavior. Public documentation was checked on 2026-09-11 Pacific. Client appearance can vary; these mockups approximate native Discord and have not been captured from a live deployed bot.

**Message design.** Discord supports structured message components, buttons, select menus and modal inputs. An action row holds up to five buttons or one select. This design uses short groups with one emphasized action where appropriate; route preferences receive equal emphasis. Components V2 uses its own text/container content instead of the legacy content and embeds fields. Pick one compatible rendering path in the implementation.[1]

**Forms.** Open forms after a player invokes a command or component. The proposed forms collect only a few fields: name and introduction; an action intent; a sheet link; or a proposed correction. Use current modal label components and reject empty required values without discarding other fields.[1][4]

**Acknowledgement.** Discord interactions require an initial response within three seconds; interaction tokens last fifteen minutes. Acknowledge or defer work promptly, then report received, resolved or failed. Those tokens are not a campaign save system, and their lifetime does not define the lifetime of a persistent game button.[4]

**Map presentation.** In ordinary chat, show a static image of only known positions with a text alternative. A button may open an optional tactical view. A Discord Activity is a separate embedded web application, supported through the Embedded App SDK; the interactive map is not an arbitrary custom layout inserted into an ordinary chat message.[5] Keep the scene's essential choices usable in text if the Activity is unavailable.

**Information discipline.** Show current objective, actor, known options and actual outcome. Do not display debug identifiers, raw permission errors, concealed facts, GM notes, or model confidence in the player flow. A model may suggest narration or recap text; the authorized state and GM review determine what can be published. This extends the project research's stated player-authority and spoiler constraints.[6]

**Visual treatment.** Use Discord-like surfaces, compact app messages, clear channel headings, small action groups and readable text. The mockup follows light and dark appearance and collapses the server/channel sidebars on narrow screens. Purple indicates a main interface action, not a correct story choice. Map positions are explicitly schematic. No new scenic illustration is necessary to understand the core flow.

**Operational readiness.** The earlier project review reported unfinished live acceptance across GM and player accounts, Discord Activity and web, voice/consent, corrections, and save/resume.[6] That is historical evidence, not a fresh runtime diagnosis. This package proves a reviewable design, not delivery of those integrations.

## Implementation contract

These are proposed requirements for a future build, not statements that the current bot already satisfies them.

1. Persist campaign, run, scene and character identifiers; membership; agreement version; preferences; approved sheet version; roster/readiness; action receipts; authoritative events; pending corrections; and save checkpoints. Private preferences and player-visible facts need separate access decisions.
2. Every action includes an actor and enough state/version context to reject a stale interaction. Recheck membership and authorization when handling it, even if a button was already hidden or disabled in the client.
3. Resolve an action idempotently. A repeated click or reconnect returns the same receipt/result; it must not roll twice, spend resources twice, or claim an item twice. If the outcome is uncertain after an interruption, reconcile the durable event record before retrying.
4. Player controls modify that player's own intent, readiness, preferences or proposals. They do not approve another player, spend their resources, finalize a party vote, resume the entire table, or force campaign advancement.
5. GM/rules authority validates mechanics, permitted targets, movement, costs and turn order. A player's submitted intent can be invalid, require clarification, or succeed without a roll. AI-generated prose cannot decide which applies by itself.
6. Keep a declared action separate from its result. Keep an NPC statement separate from a fact. Keep a proposed recap correction separate from a confirmed event. Store a correction as an explicit reviewed amendment rather than silently rewriting history.
7. “Saved” requires a durable write receipt. Restore unresolved intents, actual resources, location, discovered information and pending decisions. Restore only what the returning member is authorized to see.
8. Normal conversation must remain usable. If app components are unavailable, a GM can conduct the same flow with the copy blocks and an agreed manual log. When the app returns, reconcile the manual record before enabling mutating buttons.
9. Configure the actual GM contact before inviting players. Do not depend on an unavailable bot to advertise an outage. Do not assume a direct message will always be deliverable.
10. Optional images and sound convey only revealed facts. Text explains every essential cue. Recording/transcription needs its own explicit flow if enabled later; sample participation preferences grant no such permission.

## Rehearsal and acceptance checklist

Run these checks with a GM and at least two real test-player accounts before using the design as a live campaign flow. They are proposed acceptance checks; no such multiplayer rehearsal was completed for this package.

| Scenario | Passing result |
|---|---|
| New player starts on mobile | Can find the objective and complete setup without unreadable controls or horizontal clipping |
| Returning player joins | Goes straight to current recap/lobby without recreating character |
| Empty or invalid form | Clear field-level guidance; entered values preserved |
| Sheet requires correction | Exact requested change is shown; draft and introduction remain intact |
| Player chooses text only | Every essential scene cue and actionable choice remains available |
| Two players choose different routes | Preferences remain proposals; no automatic party movement or forced combat |
| Player invents an approach | Intent reaches the GM without being forced into one preset option |
| Repeated roll click | One result and one resource change at most |
| Other player clicks a turn button | Private rejection; current actor and state remain unchanged |
| Scene changes before a click arrives | Fresh options shown; stale action causes no spend or redirected target |
| Pause during pending action | Scene clocks and turn processing pause under the table policy; one Ready does not resume all |
| Disconnect after submitting | Correct received/resolved status appears; no automatic replay |
| Contested loot | Item remains unassigned until resolved under the agreed policy |
| Rest request at camp | Time, location, rules and costs are checked before recovery applies |
| Recap includes a wrong claim | Player correction is reviewed; history/resources do not silently mutate |
| Save fails | UI says not saved and offers recovery; no fabricated checkpoint |
| Bot/Activity is unavailable | GM can continue in text or pause; essential information remains accessible |
| Spoiler check | Player images, messages, attachments and recaps contain no GM-only information |
| Restore next session | Both interfaces and all authorized members see the same confirmed state |

Record one confusing moment and one meaningful choice from each participant. Improve those before adding more automation or expanding the mission. Successful visual rendering alone does not satisfy the multiplayer checklist.

## Sources

1. Discord, [Component Reference](https://docs.discord.com/developers/components/reference), official documentation, accessed 2026-09-11 Pacific. Used for component types, action rows, V2 behavior and modal labels.
2. Discord, [Threads](https://docs.discord.com/developers/topics/threads), official documentation, accessed 2026-09-11 Pacific. Used for parent permissions, thread access and send permissions.
3. Discord, [Community Onboarding FAQ](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ), official support article, accessed 2026-09-11 Pacific. Used for role/channel assignment and current publication requirements.
4. Discord, [Receiving and Responding to Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding), official documentation, accessed 2026-09-11 Pacific. Used for acknowledgement deadlines, token lifetime, private responses and modal limits.
5. Discord, [Activities Overview](https://docs.discord.com/developers/activities/overview), official documentation, accessed 2026-09-11 Pacific. Used to distinguish an embedded Activity from chat components.
6. Project research, [Popular campaign videos → a playable Behind the Veil opening](../../research/popular-campaign-video-adaptation-2026-09-11.md), 2026-09-11. Read through Gortex. Used for Saltglass rehearsal context, player agency, spoiler separation and historical readiness limitations. Its video popularity ranking was not repeated or revalidated for this design.

The platform constraints above are sourced facts. The channel layout, 34-screen sequence, message copy, timing, example personas and implementation contract are design recommendations. They require validation in the actual server and selected ruleset.
