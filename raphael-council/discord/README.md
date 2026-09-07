# Raphael Discord component pack

The rendering modules remain offline presentation code for the [Discord play deck](../../DISCORD_PLAY_DECK.md). The optional `bot.mjs` adapter implements PDF/OCR character import and private scene-image requests. See [importer setup and verification](../characters/README.md) and [image-service setup](../images/README.md) before running it. `deck.mjs` and `preview.mjs` perform no login, network request or game mutation.

## Files

| File | Responsibility |
| --- | --- |
| `deck.mjs` | 23 card definitions, 18 forms, three public opening briefings, Discord payload rendering, ID routing, input validation. |
| `preview.mjs` | Prints example payloads to the terminal. Does not send them. |
| `deck.test.mjs` | Offline layout, routing, privacy-flag, validation, and regression checks. Developer-only; do not upload to the player channel. |
| `bot.mjs`, `import-adapter.mjs`, `import-ui.mjs` | Configured live character desk, authenticated owner-bound import flow and private paginated review. |
| `image-adapter.mjs`, `image-adapter.test.mjs` | Anytime private scene images, optional visible-subject focus, durable job refresh, browser access codes, tactical distance/reach questions, and offline transport/security tests. |

From the `raphael-council` directory:

```powershell
node discord/preview.mjs list
node discord/preview.mjs card scene
node discord/preview.mjs modal act
node --test discord/deck.test.mjs
```

The preview uses sample handles and authored example text. It is not a campaign session or a security credential.

## Images at any time

Players choose **Show what I see** on the persistent adventure desk or on home, scene, turn, paused, saved, stale and result cards. This requests the latest view that the server has authorized for that player. It works during another player's turn and while play is paused. It does not roll dice, consume an action or resource, advance the clock, resume play, or investigate hidden details.

The bot replies privately. A ready image appears inline. After a brief progress reply, queued images automatically replace that reply when rendering finishes, with up to four minutes of active waiting. A durable **Refresh** control remains available for longer jobs and after a bot restart. Automatic delivery waits on the existing job and never requests another image. Images record the player's view at request time; an older completed image can still arrive if the scene changes or is cleared while it renders.

**Focus on something** opens an optional field: leave it empty for the whole scene, or enter an exact visible subject name or ID from the current image card. The adapter sends only that resolved ID to the image service. It rejects unknown subjects, reused forms from another player and forms opened before the scene changed. A fresh Show what I see request always uses the current scene, including from an old deck card.

**Browser access** privately issues a code that links the browser game's image panel to the same player's view. Keep this code private. Images larger than the adapter's 9 MiB Discord attachment limit remain accessible through the browser. Image responses and files use ephemeral interaction callbacks and edits; the adapter never posts them to a channel.

`image-adapter.mjs` runs before the character importer, uses the same configured guild/channel and current role or player-ID membership rules, and resolves opaque owner-bound forms and jobs through `images/runtime.mjs`. The stable entry ID is `rps:home`; subsequent controls use `rps:<opaque-view>:<action>`. An ID alone does not authorize access. Interaction IDs are passed as durable request IDs so delivery retries reuse the original job. Provider availability, trusted scene publication, saved art references and Witnesslight generation are configured in the image service.

All cards keep at most two rows and eight buttons except the scene: its three rows of three preserve the eight existing play controls alongside the image button. The only public payload changed by `bot:publish` is the adventure entry desk. Publishing and connecting to Discord remain explicit host operations; offline tests do neither.

## Distance and reach

Every private image card, including queued, failed and unavailable-image replies, offers **Distance & reach**. It opens a private list of characters the player controls and visible targets from the current tactical map. Choose **Ask about distance**, then enter a visible target's exact name or ID, or a visible grid coordinate such as `C4`. A character field appears only when the player controls more than one character. Repeated names require the target's ID. The list is bounded for Discord; other exact visible names or IDs from the current tactical map remain valid.

The reply reports grid distance in feet, the known movement cost and available movement budget, and the character's configured weapon range. It also explains pauses, turn restrictions, spent actions and unconfirmed lines of sight. Movement to a creature means reaching a square beside it; a point question measures the chosen grid square. The answer uses the **current tactical map**, so an old illustration may represent a different moment. It never derives distances from generated image pixels. Spell ranges, jumps and extra movement are outside the current combat profile and need their own rules.

Distance questions do not request an image, call the image provider, roll dice, spend movement/actions/resources, change the game revision, or resume play. They work during pauses and another character's turn. The stable `rps:reach` control can be opened even when no image was generated. `rps:<opaque-view>:reachform` and `:reachsubmit` bind follow-up forms to the requesting owner, campaign, offered choices and tactical revision; changed maps require reopening the question. Every click checks Discord membership, and every tactical read checks game membership independently. Unknown or hidden targets and invalid character choices receive a private explanation without exposing hidden state.

The bot shares `getGameStore()` with the adventure handler and calls the read-only `getReachOptions` / `assessReach` functions in `game/reach.mjs`. The host must set up a tactical campaign, membership and validated character movement/weapon profiles before numerical answers are available. This feature does not automatically associate a story image with a map. Missing setup produces a private explanation, with the image controls still available. Offline coverage includes owner-bound forms, changed maps, missing setup, ambiguous targets, coordinate questions, pauses, another player's turn, private numeric replies and unchanged game state.

## Rendering and routing

```js
import { renderCard, renderModal, actionFor, readModal } from './deck.mjs';

// The future adapter obtains these bindings from its persistent view registry.
const context = { session: 'sample', view: 'opaque_handle', revision: 6 };

const sharedScene = renderCard('scene', context, {
  title: 'Day 6 · The Last Hearth',
  body: 'Only already-authorized, observable story information goes here.',
});

const privateHero = renderCard('hero', { ...context, private: true }, {
  body: 'The requesting player’s validated character projection goes here.',
  disabled: ['approve'], // No pending approved-by-rules draft yet.
});

const memberEntry = renderCard('home', context, { hidden: ['host'] });
const modalCallback = renderModal('act', context); // Initial callback type 9.
const route = actionFor('rph:1:sample:opaque_handle:6:scene:act');
// route.kind === 'modal'; route.target === 'act'; route.access === 'member'
```

Use a fresh, owner-bound view context when actually opening a modal. Do not reuse the sample context or share an actor's pending draft handle with other players.

`renderCard` returns a **message payload**, not a complete interaction callback. A private card includes the ephemeral flag and must be delivered through an interaction reply/edit/follow-up. It cannot be posted as an ordinary channel message. A public scene payload may be posted to the bound campaign channel. Every navigation route should use `private: true`, even when the target card supports shared display. Private card definitions cannot be made public through `private: false`.

`renderModal` returns the complete **initial modal callback**. Deliver it as the button's first response; do not defer that same button and then attempt to open a modal. On submission, pass the authenticated `interaction.data.components` into `readModal` with the modal definition selected by the stored binding. The parser accepts current Label wrappers and older ActionRow-wrapped text inputs, rejects unexpected/missing/duplicate/oversized fields, and returns trimmed text or file-ID arrays. For file inputs, the importer resolves those IDs against the same authenticated interaction's attachments and validates content independently. Submitted values are untrusted data, not state changes.

`actionFor` validates the ID format and returns routing metadata. It does not authenticate the actor or authorize execution. Its `access`, `effect`, and `target` fields describe the intended handler contract. The server must implement and enforce that contract, including on form submission where access must be recovered from the stored modal origin.

### Binding and revision rules

IDs use `rph:1:<session>:<view>:<revision>:<card>:<action>`. Session/view handles are bounded opaque identifiers; never place user text, credentials, private clues, or raw hidden state in them. An ID is a routing address, not proof of permission.

The database view record must bind that address to the guild, channel, campaign, message, target entity, visibility, intended actor when private, and current revision. Reject any mismatch and recheck membership on every click and submission. Handle consumed actions by returning the saved receipt. Do not turn all failures into a new roll or a freshly generated hint.

Use entity-specific revisions: proposal content/roster revision for votes, relevant scene/action revision for actions, and private view revisions for notes or browsing. Stable entry navigation resolves the current campaign regardless of an old displayed game day. A form opening should not itself advance any story revision.

### State-aware presentation

Supply `patch.title` and `patch.body` from a recipient-authorized projection. The static definitions intentionally contain sample copy and explanatory placeholders. Do not post them unchanged as if they represented a running game.

- `hidden` removes named controls and empty rows; use it for host-only entry controls shown to non-hosts.
- `disabled` marks unavailable actions such as rolling a resolved check, approving a nonexistent draft, or paging beyond the journal.
- Neither field prevents a forged or stale interaction; the server must reject unauthorized actions independently.
- Briefing handlers select from `BRIEFS` or an authorized mission projection and bind the selected mission to the view. `propose_mission` must not infer that mission from displayed prose.
- A `scene` navigation target resolves the current phase: `lobby` before play, `paused` during a pause, `scene` during exploration, and `turn` for the active encounter actor. Inactive actors receive read-only encounter status with private navigation and pause access. Navigation never begins or resumes play by itself.
- `browse` and `page` routes query an authorized, paginated list and render it through the existing world/journal card shape.
- Long text must be paginated before rendering; oversized content fails explicitly.

When a form changes an existing draft, show its revised summary on `review`, `hero`, or `host` as appropriate. An item transfer to another player also needs the recipient's consent if it creates a cost, obligation, or resource change for them. Natural language cannot operate another player's hero.

## Adventure integration still required

### Current mission and counsel adapter

`world-adapter.mjs` now implements the `rpw:` Mission & counsel controls through the authoritative game/world services. Its cards are private. Ask buttons visibly spend one shared mission counsel request; saved advice history spends none. Current membership and owner/channel-bound controls protect both forms and confirmations. Stale game/world revisions reject new counsel requests, while repeated request IDs return the original advice.

Party debrief notes use a modal limited to 1,000 characters, followed by a preview explicitly stating campaign sharing. Only confirmation commits the debrief; it cannot change reviewed track deltas. The browser supports up to 2,000 characters. Repeating the Discord confirmation returns its saved receipt. The current card condenses long briefing/track lists and directs players to the full browser mission panel.

No live publication was performed while implementing this adapter. The bot must be running and the updated adventure desk available for players to use it. Tests use controlled transport fixtures. The original generic `rph:` deck contracts are not all implemented by these dedicated gameplay adapters.

Character import and scene images have transport, configuration, persistent views, membership enforcement and host bootstrap. Images use server-published player-visible scene projections; the host or a future authoritative engine must publish updated projections after story changes. The adventure still needs a rules adapter, durable world events, exactly-once dice checks, voting and narration/counsel. Other adventure `command` targets remain contracts, not implemented gameplay handlers. The bot explicitly declines those actions rather than pretending they succeeded.

The existing browser prototype's local state and example outcome generation must not be used as authoritative multiplayer persistence or production dice resolution. The tests here verify presentation, parsing, authenticated image routing, owner-bound views, request deduplication, status recovery, attachment transport and the character importer. They do not establish live Discord compatibility or complete gameplay; the [acceptance gates](../../DISCORD_PLAY_DECK.md#9-acceptance-gates-before-calling-it-playable) cover those separately.

Share [DISCORD_PLAYER_GUIDE.md](../../DISCORD_PLAYER_GUIDE.md) and [PLAYER_WORLD_PRIMER.md](../../PLAYER_WORLD_PRIMER.md) with players after installation. Keep the DM story framework and developer files outside the public channel.
