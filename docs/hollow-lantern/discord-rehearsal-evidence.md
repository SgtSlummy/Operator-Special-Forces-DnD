# Discord rehearsal chronology

This evidence is an actual Discord delivery of a controller replay. It is not a live campaign run, a replay of player button presses, or blind human validation.

## Source and destination

- Source: `C:\Users\Hermes\LocalFiles\HollowLanternMission-CommitJournal-20260909\public-event-archive.json`.
- Source campaign: `fixture-hollow-mission`; 85 contiguous committed Unity public projections, revisions 1–85.
- Private thread: [Hollow Lantern · rehearsal record](https://discord.com/channels/1463393482306486387/1547369533407502402), beneath #dmd-arcade.
- Explicit thread members: the existing Davy bot and selected DM `1230264975533281312`. The thread is private and non-invitable. Discord administrators and members with applicable thread-management permissions may still access private threads.
- Evidence directory: `C:\Users\Hermes\LocalFiles\HollowLanternDiscordRehearsal-CommitJournal-20260909`.

The introductory message and every image label identify the content as a rehearsal/controller replay. No live engine writes, live gameplay decisions, or additional gateway sessions are issued by the replay utility. The main channel lobby remains intact.

## Delivery and privacy

`discord-rehearsal-replay.mjs` first validates the fixed archive, then passes every entry through the existing public-feed sanitizer. Only public summaries and public participants enter the cards. Original receipt result payloads, private maps, inventories, character histories, and GM details do not enter Discord. Empty Unity private-field placeholders are stripped before persistence and rendering.

The utility prepares 85 flattened PNGs from approved illustrations and portraits. `prepared.json` records their full SHA-256 hashes. `state.json` records the archive hash, thread identity, each original command/revision, returned Discord message and attachment identifiers, links, and uploaded image hashes. `discord-feed.json` preserves the sanitized projections and delivery states. `thread-verification.json` records checked visibility and explicit membership; these are rechecked before each card.

The delivery queue persists a sending marker before each POST. A transport failure leaves the result uncertain and blocks later cards; it never blindly retries an ambiguous message creation. Recovery requires an actual returned Discord nonce, matching bot/channel, and exact stored content/attachment fingerprint. Missing nonce evidence blocks recovery instead of guessing. Rerunning a completed queue sends no duplicate cards. Explicit Discord rate-limit responses are retried within a bounded limit.

Preparation and actual posting are separate commands, run from the canonical project root:

```text
node raphael-council/hollow-lantern/discord-rehearsal-replay.mjs
node raphael-council/hollow-lantern/discord-rehearsal-replay.mjs --post
```

The script reads the existing protected Davy deployment credentials internally. It does not print or copy them into evidence. Its destination and archive are fixed deliberately; it is not an arbitrary-channel posting tool.

## Verification limits

Actual delivery completed on 2026-09-09: 85 separate illustrated cards, revisions 1–85, plus one introduction. A fresh process reopened the completed queue and sent zero duplicate cards. `delivery-verification.json` successfully checks all 85 returned messages against their bot, channel, nested gallery attachment ID, filename containing the uploaded image hash prefix, PNG type, and 1000×440 dimensions. Full SHA-256 values describe the uploaded bytes; they are not a claim that Discord CDN bytes were separately downloaded and hashed. The parent task confirmed the first gallery image visibly renders in actual Chrome Discord.

The additional read-back initially failed because Discord Components V2 returned gallery media inside components while leaving the top-level `attachments` list empty. Three failed verification attempts are retained in `state.json`; the observed payload is preserved in `delivery-verification-top-level-attachment-assumption-failure.json`. These attempts sent no further cards. Correct nested-media verification subsequently passed.

The original first-card image showed a caption truncation bug in the shared renderer. The parent fixed the renderer for subsequent work. These 85 uploaded images and their hashes remain unchanged as observed evidence; the fix is not represented as having altered previously delivered images. The native Discord text remains available alongside the illustration.

The six existing public-feed tests pass, covering ordering, duplicate receipts, restart persistence, uncertain delivery, scope binding, private data rejection, corrupt-primary recovery, and actual Unity empty placeholders. All 85 images were prepared successfully. The parent task separately inspects the actual Discord thread on screen; uploaded PNGs and returned REST records alone do not establish mobile layout quality or simulated-human comprehension.

This archive starts after the original Unity commits. The replay demonstrates faithful delivery of those captured public snapshots. It does not prove capture of events that never reached an archive, nor exercise the private player or DM controls.

Discord behavior references: [message creation and nonce fields](https://docs.discord.com/developers/resources/message), [thread creation and membership](https://docs.discord.com/developers/resources/channel).

## Refined PublicOutcomes replay

A separate [Hollow Lantern · refined rehearsal](https://discord.com/channels/1463393482306486387/1547375313456078848) private, non-invitable thread contains the newer PublicOutcomes run. Its source is `C:\Users\Hermes\LocalFiles\HollowLanternMission-PublicOutcomes-20260909\public-event-archive.json`, with 81 contiguous exact committed public revisions. This source mission independently completed and survived process restart; its full five-scope local evidence remains separate from the public-only Discord delivery.

The fixed `--refined` variant selects only this approved source and a distinct evidence directory, `C:\Users\Hermes\LocalFiles\HollowLanternDiscordRehearsal-PublicOutcomes-20260909`. Before posting, it verifies the source archive against the mission audit and the actual authority assembly SHA-256 `A75D0DDA0E4C283CE9F33CA58E8589A8633A3643ED4340FE6A0B67C8C526A998`. Its state manifest records that build, original receipt identities, exact sanitized public snapshots, generated image hashes, and returned Discord identifiers.

```text
node raphael-council/hollow-lantern/discord-rehearsal-replay.mjs --refined
node raphael-council/hollow-lantern/discord-rehearsal-replay.mjs --refined --post
```

The refined cards use the repaired caption renderer; the full first-card caption was visually inspected before posting. They include the new committed public hits and visible-fall outcomes. They remain a controller replay, not live actions or blind testing. The original 85-card thread, its caption limitation, its failures, and its artifacts are preserved unchanged.

Refined delivery completed: 81/81 messages and nested gallery media passed read-back verification, with no delivery failures. A separate process reopened the completed queue and produced zero additional cards. The public-feed test suite remained 6/6 passing. The fresh `state.json` and `delivery-verification.json` record the final verdict and all links. Particularly useful inspection points are [revision 33: visible hit](https://discord.com/channels/1463393482306486387/1547375313456078848/1547375577160228964) and [revision 35: visible fall](https://discord.com/channels/1463393482306486387/1547375313456078848/1547375589634347090).
