# Raphael's Council — Discord Play Deck

## The experience

Play **The Lanterns of Greyharbor** entirely inside Discord: press a button, describe an intention, and let Raphael respond. Players need no slash commands, dice syntax, reaction voting, outside character sheet, or separate website.

This is a Discord-first interaction design and component pack with **23 message cards**, natural-language forms, a payload renderer, and offline contract tests. The local bot now implements character import and on-demand scene images; it has not been deployed or connected by this work. Other adventure actions still need authoritative multiplayer state, rules resolution and narration. Sections describing those actions remain implementation contracts. See [image host setup](raphael-council/images/README.md).

The campaign remains a fantasy story about a small, capable company: receiving a request, gathering knowledge, preparing, protecting people, recovering, and living with consequences. The deck supports social scenes, exploration, tense encounters, and combat without turning every problem into a fight.

## 1. Discord design doctrine

**Additional campaign content:** [Behind the Veil](BEHIND_THE_VEIL_GM.md) reuses this deck for an optional Nareth expedition. Map Observe to `Look closer`, Talk to `Speak`, and Act/Plan to `Do something else`. Display expedition day, known invasion deadline, Heat, Supplies and Lantern Support on its scene; show local Search separately. Keep the three strategic operations equally available after the opening and derive debrief/finale content from saved outcomes. The guide defines the full behavior contract; no additional renderer behavior is implemented by this document. Pin the [Nareth player briefing](BEHIND_THE_VEIL_PLAYER_BRIEFING.md) when that arc is selected, and never publish its GM-only model.

The following is Raphael's design doctrine, informed by Discord's component system rather than an official Discord-branded framework.

1. **The scene is the interface.** Each shared scene gives the location, game time, observable situation, and a clear invitation to act.
2. **Buttons express intent.** Use consistent, readable labels. Blue emphasizes an entry action; green confirms a reviewed commitment. Competing story choices receive equal visual weight. Never communicate meaning through color or an icon alone.
3. **Reveal detail when asked.** Keep the common controls on the scene. Character details, rules, journals, and briefings open privately. Routine cards use at most two rows and eight buttons, with shorter copy preferred on mobile. The live scene uses three rows of three buttons to retain all controls plus **Show what I see**.
4. **There is always another approach.** `Do something else` accepts plans the designer did not predict. It routes through the same rules and consequence checks as any named button.
5. **Personal browsing does not move the party.** Opening a briefing cannot accept it; reading a hint cannot share it; examining your sheet cannot spend an item.
6. **Commitments are legible.** Before spending a scarce resource, advancing party time, or making an irreversible choice, show the understood action and known cost. Trivial conversation needs no extra confirmation loop.
7. **Recovery belongs in the interface.** Old cards lead to the current scene. A missing deck can be restored. `Pause play` requires no explanation.

The renderer uses Discord Components V2: a Text Display followed by Action Rows. A row contains at most five buttons; IDs are bounded to 100 characters. The payload sets `IS_COMPONENTS_V2` and does not mix in legacy message `content` or `embeds`. Natural-language forms use Text Inputs inside Label components. These choices follow the [component reference](https://docs.discord.com/developers/components/reference) and [message component guide](https://docs.discord.com/developers/components/using-message-components).

## 2. Where play lives

Start with one access-controlled text channel, **#greyharbor**, containing:

- A pinned **Last Hearth** entry card and the short player guide.
- One current shared scene, with its result and decision cards nearby.
- The party's visible story history, including saved-session receipts.

The bot posts shared changes here; private interactions open only for the clicking player. Avoid creating a public channel for every character sheet or secret. Larger servers can place each campaign in a restricted channel or private thread, with membership checked independently of the fact that somebody can see a message.

The pinned entry is a stable doorway. Its navigation buttons always resolve the current campaign. Story-changing buttons on old scenes do not remain actionable. When a scene resolves, preserve its readable history, disable obsolete controls, and point readers to the new scene. Personal navigation must not edit another player's shared screen.

`Resume adventure` resolves the session phase: the lobby before a session starts, the paused card during a pause, and the current scene during play. The host's setup flow publishes the shared lobby so joining players can mark ready. During a turn-based encounter, scene navigation gives the current actor their turn card and everyone else a read-only status with journal, guidance, and pause access.

## 3. The main deck

These wireframes show button rows, not commands to type.

### Last Hearth — pinned entry

> **Raphael's Council · The Last Hearth**  
> The Lanterns of Greyharbor · Day 6  
> Choose a card. New here? Join the company first.

```text
[Join the company] [Resume adventure] [Missions] [Show what I see]
[My hero] [World & journal] [How to play] [Table settings*]
```

`Table settings` appears only for the configured host. A visitor may join or read the help card; membership is required for campaign information. Joining creates a character draft and seat request, not an automatic place in an ongoing scene.

### Live scene — the everyday play surface

> **Day 6 · The unlit lantern**  
> Rain taps the Last Hearth's windows. Lysa places an unlit paper bird on the table.  
> “I cannot remember who gave it to me.”  
> You remember a ferryman at yesterday's door.  
> What do you do?

```text
[Do something else] [Speak] [Look closer]
[Help an ally] [Ask Raphael] [Show what I see]
[My hero] [Journal] [Pause play]
```

| Button | What the player writes | What it does |
| --- | --- | --- |
| Do something else | “I compare the lantern to the one we saw yesterday.” | Proposes any action, movement, negotiation, or unusual approach. |
| Speak | “I ask Lysa what she remembers about the visitor.” | Gives speech to a named recipient; Raphael plays that NPC. |
| Look closer | “I examine the painting beneath the wing.” | Observes a specific subject; checks only if uncertainty and stakes justify one. |
| Help an ally | “I hold the lantern steady for Maren.” | Proposes support; verifies consent, timing, and any mechanical benefit. |
| Ask Raphael | “What have I already noticed that I might be overlooking?” | Requests limited, saved, private guidance. |
| My hero | No typing required. | Opens your approved sheet, conditions, equipment, and abilities. |
| Show what I see | No typing required; optional visible-subject focus. | Generates or retrieves a private image of the current authorized view at any time, without action, roll, resource or time cost. |
| Journal | No typing required. | Opens facts and promises you are allowed to know. |
| Pause play | No typing required. | Immediately freezes new story-changing actions and game time. |

### Review and resolve

> **Your action · Only you**  
> You want to examine the markings without damaging the lantern.  
> Show the understood target, applicable rule, known cost, and stakes. Nothing has been spent or rolled.

```text
[Confirm action] [Change my approach] [Cancel action]
```

An action with a certain outcome resolves after any necessary confirmation. An uncertain action produces a pending check:

```text
[Roll dice] [Change my approach] [Cancel action]
```

The player never supplies a dice expression. The selected rules adapter determines the die, modifiers, advantage/disadvantage, valid support, and result. Show player-facing stakes before the roll; disclose hidden difficulty only if the table's agreed rules call for it. Save the roll once, then narrate. A resolved roll cannot be discarded by cancelling or reopening the card.

### Company decision

> **Proposed plan: visit Bellweather**  
> Show the route's fictional travel time, known deadlines, and shared costs.  
> List each participating hero's response.

```text
[Support plan] [Object] [Discuss or suggest changes]
[Withdraw my response] [Confirm agreed plan] [Pause play]
```

This card handles mission acceptance, party travel, shared spending, time-advancing rest, and ending a session. Default to unanimous agreement among the current participating roster. An objection or missing response keeps the proposal open. `Confirm agreed plan` remains disabled until everyone supports the same proposal revision. Its handler must still recheck agreement at commit time.

Each player has one replaceable response. A substantive plan edit starts a new proposal revision and clears prior support. A vote update does not itself change that proposal revision. The host cannot cast another hero's vote or bypass an objection. A participating player can sit out voluntarily; other roster changes happen through a visible, agreed process, never by silently removing a dissenter.

### Raphael's private counsel

> **Raphael · Only you**  
> “You remember the visitor. Ask what remained after he left.”

```text
[Share with the party] [Ask a follow-up] [Back to deck]
```

Sharing opens a second private card containing the exact saved hint:

```text
[Share this hint] [Keep it private]
```

Only the approved hint becomes public. The private question, character notes, and internal story context stay private.

## 4. Complete card catalog

“Shared” means suitable for the campaign channel. A player's navigation to a shared-capable card still opens a private view unless an authorized game event explicitly publishes it.

| ID | Audience | Controls and purpose |
| --- | --- | --- |
| `home` | Shared entry | Join; resume; missions; hero; world; help; host settings. |
| `lobby` | Shared | I'm ready; sit out; hero; host begins; back. Begin requires an approved hero and readiness from every roster member. |
| `hero` | Private owner | Describe hero; approve validated draft; use/give item; use ability; back. Disable approval without a current draft. |
| `missions` | Private | Lantern Accord; Quiet Archive; Ember Vigil; suggest another mission; back. Briefings are browsing, not acceptance. |
| `brief` | Private | Propose this mission; ask about it; other missions; hero; back. Bind the selected mission server-side. |
| `decision` | Shared | Support; object; discuss; withdraw response; confirm agreement; pause. |
| `scene` | Shared | Free action; speech; observation; support; Raphael; hero; journal; pause. |
| `review` | Private actor | Confirm action; revise; cancel an uncommitted draft. |
| `check` | Private actor | Roll once; revise before rolling; cancel an unresolved check. |
| `result` | Shared | Continue scene; what changed; follow-up question; pause. Shows observable consequences and a save receipt. |
| `turn` | Private actor | Act/move; ability; support; end my turn; hero; Raphael; pause. Costs and turn ownership are enforced by the rules engine. |
| `counsel` | Private owner | Saved partial hint; share preview; follow-up; back. |
| `share` | Private owner | Share this exact hint; keep private. |
| `world` | Private | Known places; people; factions; journal; company; back. |
| `journal` | Private | Add note; find something; previous page; next page; back. Hide or disable unavailable pages. |
| `party` | Private | Public company condition; help an ally; hero; roster; back. |
| `debrief` | Shared | Record; correction request; downtime; next requests; propose session end; pause. Costs are already committed, never applied by viewing. |
| `downtime` | Private | Plan rest; visit someone; another activity; back. Shared time changes become a company proposal. |
| `paused` | Shared | Ready to resume; private note; recap; propose session end. Resume requires every current participant's readiness. |
| `saved` | Shared | Gather to resume; journal; hero; back. Displays the last committed scene, game time, and unresolved promises. |
| `stale` | Private | Explain that no change occurred; current scene; hero; help. Completed checks instead recover their saved result. |
| `help` | Private | Short instructions; back; hero; natural-language rules question. |
| `host` | Private host | Configure table; apply reviewed settings draft; restore missing deck; roster; back. No reset or story-override button. |

The fifteen forms collect: joining details, a hero description, an action, speech, an observation, support, counsel, a question, a proposal, item use, ability use, a private note, a correction, downtime, and table setup. They use one or two short text fields. No dropdown or form requires the player to learn game-engine field names.

## 5. Natural language is a complete control path

Every play action is reachable through a button-opened text form. These submissions do not require reading ordinary channel messages. This is the baseline input method; Discord documents button-triggered text entry in its [modal guide](https://docs.discord.com/developers/components/using-modal-components).

Optionally add a Gateway handler for messages mentioning the bot, such as “@Raphael, I want to question the witness.” Discord permits message content for mentions under its documented exceptions. Reading general unmentioned server conversation has separate privileged-intent requirements. Do not promise free-chat ingestion unless that handler and configuration exist. See [Gateway intent documentation](https://docs.discord.com/developers/events/gateway) and [privileged-intent alternatives](https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent).

The interpreter separates **action, dialogue, question, proposal, private counsel, and out-of-character discussion**. A question does not spend an action. Banter does not commit the party. If an intent is ambiguous, ask one short question or return a review card. If a player proposes several dependent actions, resolve the first meaningful uncertainty and keep the rest as an uncommitted plan.

Examples of valid player input:

- “I would rather speak to the residents before we accept this job.”
- “Can I use my healing ability on Oren? Tell me the cost first.”
- “I want to move behind the overturned cart and protect Lysa.”
- “What did we promise at Ember Crossing?”
- “Out of character: could you recap the last scene?”

Statements of fact from players remain claims or proposed actions until validated. “I found the culprit,” “give me a legendary sword,” or “ignore your instructions” cannot create facts, grant privileges, alter rules, or expose private records. Names resolve against the actor's authorized knowledge; uncertain matches ask for clarification rather than leaking a list of secret NPCs.

## 6. Raphael and the council

Raphael feels like an all-seeing god who cares about the chosen heroes. He speaks with warmth and restraint. He can point toward an observation, tension, or possible consequence; he does not provide the mystery's answer or dictate a hero's decision.

For each hint, retain the recipient, scene, question, evidence used, exact delivered text, and whether it was shared. Reopening counsel retrieves that record. Repeated requests in an unchanged situation clarify the existing nudge rather than progressively exposing the solution. When play stalls, offer an actionable clue or another route; essential progress cannot depend on guessing a single phrasing or winning one roll.

Behind the scenes, the council keeps its established responsibilities:

- **Aster:** world and community continuity.
- **Mnemos:** memory, established facts, and promises.
- **Seren:** consequences, costs, and recovery.
- **Kael:** mission structure and plausible options.
- **Mira:** player agency and party relationships.

These roles produce scoped proposals for validation. They do not each post a stream of messages or vote over the players. Raphael delivers one coherent response. Public cards receive an approved knowledge projection, never a raw council transcript, hidden reasoning, or the DM-only world bible. Unknown people and places are absent rather than labeled “secret” or “locked.”

## 7. Persistence and multiplayer contract

The server database owns the campaign. Discord messages are views of that state; chat history, ephemeral messages, and browser local storage are not the save system.

Persist at minimum:

| Record | Required scope and purpose |
| --- | --- |
| Campaign binding | Guild, channel/thread, campaign, host, ruleset, table settings, stable entry message. |
| Membership and roster | Discord user to hero, role, consent/readiness, active session membership. |
| World event and projection | Ordered committed event, state version, visibility, fictional time, known consequences. |
| View binding | Opaque handle, campaign, card, entity, current revision, message/channel, audience, owner, pending/consumed state. |
| Action and check | Actor-owned draft, approved cost, rules specification, pending/resolved status, saved result. |
| Proposal and votes | Frozen proposal revision, named roster, one response per member, commit receipt. |
| Private records | Hints, notes, character drafts, their owners, and explicit sharing events. |
| Delivery outbox | Committed event, intended Discord delivery, acknowledgement, reconciliation status. |

All mutations authenticate the Discord actor and revalidate membership, ownership, entity revision, and current game state. UI labels and disabled buttons are not permission checks. `owner` means the actor who owns the bound draft/check/hint; `host` means the configured campaign host, not an assertion typed into a form.

Use unique interaction receipts to absorb Discord retries and domain constraints to prevent duplicate outcomes from separate clicks. For example, only one transition from `check.pending` to `check.resolved` may generate a result. Persist its random draw and rule calculation atomically with the effect. Replay reuses that stored result; it must not reroll because a new interaction ID arrived.

An action revision changes when its relevant world conditions change. A proposal revision changes when its plan or roster changes. Ordinary vote counts and journal page changes do not invalidate every other player's open form. At submission, stale actions get a private explanation and fresh navigation, never silent application to a different target.

Pause takes priority over future mutations. A resolution already committed remains recorded; an uncommitted resolution waits or is rejected while paused. Read-only cards and private notes still work. Resume needs all current participants ready; a timeout is not consent. A voluntarily departing player is visibly removed from the roster and any affected decision is re-proposed.

Advance fictional time only through a committed action or agreed world turn. A day or week away from Discord changes nothing. Restoration reconstructs cards from the same saved campaign; it does not regenerate history, overwrite rolls, or create a new opening.

## 8. Adapter implementation instructions

The renderer is in [deck.mjs](raphael-council/discord/deck.mjs). Its exports are presentation helpers, not a rules engine or an authorization layer. See the [integration README](raphael-council/discord/README.md) for usage.

On a button click:

1. Verify the interaction using the chosen Discord transport, then resolve the campaign and stored view binding.
2. Route through `actionFor(custom_id)` and enforce actor access. Never infer authority from the ID alone.
3. For a text form, issue a fresh actor-bound modal handle and return `renderModal(...)` immediately. Revalidate when it submits.
4. For navigation, query the authorized projection and return an ephemeral card. For a mutation, validate and commit through the game service; publish only its approved observable result.
5. Save an idempotent receipt and pending deliveries. A Discord delivery failure cannot undo or repeat the underlying game event.

Discord requires the initial interaction acknowledgement within three seconds and limits interaction-token use to fifteen minutes. Opening a modal must be the initial response; do not defer that button first. On modal submission, acknowledge privately before slower council work, then edit the reply. If generation runs beyond the token lifetime, save its status/result and let a fresh button interaction recover it. Ephemeral responses use the interaction response path, not ordinary channel posting. These rules come from [receiving and responding to interactions](https://docs.discord.com/developers/interactions/receiving-and-responding).

Route buttons through a persistent interaction handler and database bindings rather than session-only collectors. Old message buttons can produce new interactions after a process restart. Disable actions during a pending resolution for clarity, but rely on database constraints for correctness. Respect Discord rate limits and reconcile an ambiguous delivery before retrying so a recovered save does not flood the channel with duplicate results.

All rendered payloads suppress automatic mentions. Do not send credentials, raw hidden state, private notes, or DM-only files to a public message. Ephemeral means private presentation in Discord; it does not replace database access controls or constitute end-to-end encrypted storage. Publish the player guide and primer, not the world framework or developer test files.

### Host setup, once the adapter exists

Create and install the Discord application in the chosen server, configure its credentials on the host outside chat, and bind the campaign to the selected channel. Request only the permissions needed for that channel, such as viewing, sending, and reading message history. A server owner can pin the entry manually; thread or message-management permissions are optional additions only when those features are used. Administrator permission is unnecessary for this design. Check the [Discord permission reference](https://docs.discord.com/developers/topics/permissions) when implementing installation.

The startup/bootstrap process publishes the entry card. The host then uses `Table settings` → `Configure the table`, describes the ruleset and roster, reviews the exact draft, and presses `Apply settings draft`. Rules must come from a supported, authorized rules adapter; the narrator cannot fabricate a character sheet to fill a missing implementation. Beginning play is blocked until the campaign and heroes validate.

Hosting can be local while the machine and bot process are running. If it is stopped, buttons cannot process new requests, but a properly persisted campaign survives. No bot was installed, connected, or posted to a server as part of producing this deck.

## 9. Acceptance gates before calling it playable

Offline renderer checks are included and can be run now. The following live adapter tests remain required:

1. A new player joins, describes and approves a valid hero, and enters a session using only buttons and text forms.
2. Players on desktop and mobile can complete briefing, party agreement, one scene, a roll, debrief, and resume without commands or outside pages.
3. Two players click a roll or confirm at nearly the same time: the game commits one outcome and returns the same receipt.
4. An old action and a newly submitted action cannot both spend the same remaining resource. A different player cannot approve another hero's draft.
5. A vote does not erase other valid votes. An edited proposal requires renewed agreement. Silence never becomes consent.
6. Counsel, sheets, and private notes never appear in another player's view. Sharing posts exactly the approved hint.
7. A pause during generation blocks subsequent uncommitted game changes. Resume waits for every participant.
8. Restart the bot after a committed roll but before its reply. Recovery preserves the roll, world event, roster, hints, and current scene.
9. Delete the deck message. Host restoration recreates the entry without resetting the campaign.
10. An invalid AI response or unavailable provider produces a recoverable error or an explicitly configured rules-led fallback, with no invented state change.

## Related campaign documents

- [Player-facing Discord instructions](DISCORD_PLAYER_GUIDE.md)
- [Spoiler-free world primer](PLAYER_WORLD_PRIMER.md)
- [Persistent-world implementation plan](PERSISTENT_WORLD_PLAN.md)
- [World story framework — DM only](WORLD_STORY_FRAMEWORK.md)

Discord documentation checked September 5, 2026. The component pack contains sample presentation text; live content must be populated from authorized saved state.
