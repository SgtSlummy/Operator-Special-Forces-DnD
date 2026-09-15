# Discord presentation options for a playable RPG

Discord supports two useful families for this game: traditional rich embeds and the newer Components V2 layouts. The game should use Components V2 for its interactive panels, with dropdowns for grouped actions and a small number of immediate buttons. Conventional embeds remain useful for concise receipts or compatibility surfaces. The SSOD inventory reference contributes item descriptions, visible equipment status, paging, and distinct item-action menus; its game mechanics are not D&D rules and should not be imported.

## Embeds that Discord actually allows a bot to author

Discord's message schema lists seven embed types: **rich, image, video, gifv, article, link, and poll_result**. These are not seven freely interchangeable bot templates. Ordinary message creation produces rich embeds; the API does not let a bot set a custom embed type, provider, video object, or image dimensions. URL previews and generated result cards have their own behavior. A cinematic encounter card therefore uses an uploaded image inside a supported message, not an invented video-embed payload. [1]

A rich embed can combine a title, description, author, thumbnail, main image, fields, accent color, timestamp, and footer. Its main constraints are 25 fields, a 256-character title, 4,096-character description, and 1,024-character field values. Up to ten embeds can share one message, but their combined textual budget is 6,000 characters. Inline fields request an arrangement; they are not a custom responsive layout system. [1]

**Game application:** keep legacy receipts short. A rules receipt can name the actor and outcome, show the relevant roll, and link back to the current private panel. A large inventory should be paginated rather than packed into the maximum field count. Dense three-column desktop examples are inspiration, not a mobile guarantee.

## Components V2 catalogue

The current component reference lists these building blocks. [2]

| Family | Components | Useful RPG role |
|---|---|---|
| Layout | Action Row, Section, Separator, Container | Group an item with its control; separate scene information from actions |
| Content | Text Display, Thumbnail, Media Gallery, File | Scene art, portraits, maps, concise explanations, downloadable recap |
| Immediate actions | Button | Back, End Turn, Confirm, Cancel, Open |
| Grouped choices | String Select | Spells, weapons, inventory actions, destinations, known targets |
| Discord entities | User Select, Role Select, Mentionable Select, Channel Select | Administrative participant/channel configuration |
| Forms | Text Input, Label, File Upload | Describe Action, character notes, approved character upload |
| Form choices | Radio Group, Checkbox Group, Checkbox | Mutually exclusive options or independently selected settings |

The V2 flag is set per message. V2 messages replace legacy content/embeds with components; attachments must be explicitly displayed. The flag cannot be removed from an existing message, and the total component ceiling is 40. Action rows hold up to five buttons or one select. A string select supports at most 25 options. [2]

The components overview separates layout, content, and interaction responsibilities. That distinction is valuable for the game: rendering a map does not create movement behavior, and displaying a dropdown does not authorize its selection. The interface must connect each supported control to its existing interaction handler and authoritative command. [3]

### Dropdown selection policy

Use **String Select** for game-world choices. A goblin, sword, spell, or doorway is not a Discord user or role. The user/role picker shown in the supplied reference is useful for its interaction pattern; its underlying entity picker is appropriate only when choosing real Discord entities.

The proposed inventory groups choices by purpose: **Use Item**, **Equip Item**, and **Drop Item**. Each option shows a concise name and relevant quantity or cost. The item list explains known effects and equipment status before the player acts. Menus contain only eligible items; unknown or unsupported effects remain visible as information but route to the DM for an explicit ruling.

For combat, first choose the category, then a concrete action/target. This avoids presenting every spell, weapon, and target as a wall of buttons. A selected action displays its resource cost and any information the character is entitled to know. Hidden target properties must not be disclosed through a validation hint.

Keep **Back**, paging, **Confirm/Cancel**, and **End Turn** as buttons where they avoid unnecessary menu traversal. A button should not resemble an immediate action while secretly opening several more layers. Navigation should preserve the current item page and map level where possible.

### Sections and aligned actions

The music-bot reference places a short explanation on the left and the corresponding action on the right. Discord's message-component guide demonstrates these interactive layouts and their returned custom identifiers. [4]

Use this pattern for a merchant item, pending DM ruling, quest lead, or character-creation choice. Keep one decision per section. Avoid repeating the same paragraph in the heading, body, option description, and confirmation. An item's row should answer: what is it, what do I know about it, and what can I do with it now?

### Forms and modals

The modal guide supports structured data collection triggered by an interaction. Labels associate explanatory text with the relevant control. The latest component reference includes form selectors, file uploads, and checkbox/radio controls; older examples that show only text boxes are not a complete inventory of current capability. [5]

Use a modal when the player must provide information the panel cannot express cleanly: a described action, negotiation approach, quantity, character detail, or proposed ruling. Do not open a form simply to confirm a harmless navigation choice. A free-form action must result in a pending, reviewable intention rather than permission for an AI to rewrite game state.

The screenshot's warning banner is Discord's own application/form presentation. Its wording is reference content, not an instruction to copy into the RPG interface. Likewise, badges, usernames, currency values, and spell effects in reference screenshots are not campaign facts.

## Delivery, privacy, and time

Interaction responses need timely acknowledgement; deferred replies allow longer processing afterward. Discord documents a three-second initial response deadline and a 15-minute interaction-token lifetime. Ephemeral replies are useful for the interacting user's detail views, while persistent private records need their own authorized delivery surface. [6]

For this game, acknowledge before engine work or rendering unless the response must immediately open a modal. Report pending or unavailable work in ordinary language. Retain the same command identity when reconciling an uncertain outcome; do not silently submit another purchase or attack.

Discord threads have their own membership and permission behavior, including management privileges. A private thread is a delivery boundary, not proof that two software agents sharing a bot credential have isolated knowledge. [7]

A bot delivering every character's private thread must enforce actor scope before any content reaches a game agent. The agent itself receives no shared bot credential or generic history-fetch tool. The DM's authorized overview remains separate from each player's observations, even when several characters are controlled by the same human account.

Discord attachment URLs can carry expiration/signature parameters, and Discord describes refreshing attachment URLs through returned message data. A URL's opacity or expiry is not equivalent to player authorization. [8]

Therefore, never upload an unredacted full map as a player attachment. Remove concealed pixels before export. Keep GM maps out of player delivery paths altogether. Once a recipient has legitimately received an image, the game cannot promise to recall their downloaded copy; revocation prevents future application access and delivery.

## Applying the SSOD inventory reference

The reference page describes a status summary, item descriptions, equipped/value/quest indicators, page navigation, and separate dropdowns for dropping, using, and equipping items. It also documents its own inventory capacity and spell/herb rules. Those mechanics belong to SSOD, not this project's D&D rules. [9]

The design adaptation is deliberately narrower:

- Put identity and immediate resources above the inventory.
- Show a small readable page of item entries with names, quantities, known effects, and equipment status.
- Put item actions in purpose-specific dropdowns, with page controls beneath the list.
- Show purchase, use, transfer, and equipment results privately with their actual committed changes.
- Prevent quest-item destruction or sale when the authored campaign marks those operations unavailable.

Do not copy the reference game's prose, artwork, stat system, currency conversion rules, or restrictions on viewing inventory during combat. D&D players must retain access to information they need to decide legal actions in combat.

## Surface decisions for Operation Hollow Lantern

| Surface | Chosen composition | Primary information | Interaction |
|---|---|---|---|
| Public scene | Illustrated V2 container | Observable scene, active participants, concise outcome | Join, My Character, Recap |
| Private map | Map gallery plus compact context | Current character's sight, remembered terrain, immediate situation | Map-level dropdown; action-category dropdown |
| Inventory | Short item list and status | Quantities, known descriptions, equipment and value | Use/Equip/Drop dropdowns; paging |
| Merchant | Item sections | Description, price, available quantity | Inspect; Buy/Sell selection; confirmation |
| Combat | Private tactical view and public side-view result | Player resources privately; observable outcome publicly | Action/target dropdowns; immediate End Turn |
| DM rulings | Pending-decision sections | Intention, relevant facts, proposed procedure | Review, Approve, Revise, Deny |
| Journal | Concise ordered entries | Known clues, commitments, consequences | Filter/page; explicit sharing |
| Character creation | Choice sections and focused forms | Complete supported character profile | Pregen, Describe, Import, Review |

These are design decisions, not claims that every surface has passed live acceptance. The implementation evidence must identify which real handlers, renderers, and Discord messages were tested.

## Acceptance criteria

Test the final panel in desktop and narrow mobile layouts. Long item names must remain understandable; empty menus should explain availability; keyboard focus should be visible in the browser/Activity counterpart. Current character and page context must survive navigation.

Check copied, expired, revoked, and wrong-character controls against the actual command boundary. Compare final pixels, alt text, filenames, dropdown labels, and model inputs with the character's allowed facts. Verify that a dropdown never exposes a hidden target or unrevealed destination.

Record both the screen that informed the choice and the resulting committed receipt. A screenshot can prove appearance, a successful click can prove wiring, and a rules fixture can prove resolution. None alone establishes the complete player experience.

## Sources

1. Discord. [Message Resource: embeds and message creation](https://docs.discord.com/developers/resources/message). Current documentation accessed 2026-09-09.
2. Discord. [Component Reference](https://docs.discord.com/developers/components/reference). Current documentation accessed 2026-09-09.
3. Discord. [Components Overview](https://docs.discord.com/developers/components/overview). Current documentation accessed 2026-09-09.
4. Discord. [Using Message Components](https://docs.discord.com/developers/components/using-message-components). Current documentation accessed 2026-09-09.
5. Discord. [Using Modal Components](https://docs.discord.com/developers/components/using-modal-components). Current documentation accessed 2026-09-09.
6. Discord. [Receiving and Responding to Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding). Current documentation accessed 2026-09-09.
7. Discord. [Threads](https://docs.discord.com/developers/topics/threads). Current documentation accessed 2026-09-09.
8. Discord. [API Reference: signed attachment CDN URLs](https://docs.discord.com/developers/reference#signed-attachment-cdn-urls). Current documentation accessed 2026-09-09.
9. The Seven Spells of Destruction. [Discord RPG Bot Inventory](https://www.ssod.org/lore-guide/discord-rpg-bot-inventory). Accessed 2026-09-09; visual/usability reference, not D&D mechanics authority.
10. Supplied screenshots: three music-bot cards, user/role dropdown examples, RPG profile/shop/battle examples, and SSOD inventory. Visual references supplied in the task; no executable instructions were adopted from their content.

Ghidra was not used to analyze this webpage: no compiled program was supplied for that reference. No reverse-engineered source or binary behavior is claimed.
