# Shared browser and Discord transport — 2026-09-13 UTC

The illustrated table now uses one saved-state authority for HTTP and Discord controls. This is implemented and locally tested. It is **not yet attached to the live Davy gateway or authenticated Activity**, and no live campaign messages or saves were changed in this pass.

## Implemented

- `table-store.mjs` owns serialized mutations, atomic state replacement, scoped command receipts, recipient projections and revision-only notifications. A repeated Discord interaction uses the saved receipt instead of spending twice. Receipts survive restart; a command ID cannot be reused for another actor/action. A writer reservation prevents two new store instances from owning the same file.
- `table-server.mjs` uses that authority for every browser read/action and returns its `store` to the composing host. Its public defaults remain an **isolated local preview**, with local capability links. These are not production authentication or an Activity server.
- `table-discord.mjs` composes with an existing Discord client. It does not log in, register commands, create threads or create messages. Its controller checks the application, guild, channel, originating message author and fresh guild membership; controls carrying actions are bound to the actual user and character. Normal controls acknowledge before the membership network call. Private responses are ephemeral.
- Scene, tactical, atlas, character, Raphael, shop and action-description controls work through this controller. Scene replies attach actual rendered PNGs; visible encounters add the illustrated round strip. Public scene projection withholds unseen enemies and unknown HP, including when the DM opens that public scene.
- Purchases and action requests update the same authority used by HTTP. Private inventory and Raphael accounts remain recipient-scoped. Long memories and DM requests are paginated. Atlas selection currently exposes the first 25 known locations; complete pagination remains to add.
- An explicitly configured existing public message can refresh after commits. It is force-fetched and must belong to this application and campaign channel. Refresh replaces its picture attachments and clears legacy content/embeds for Components V2. A rendered response is discarded if its revision changes or membership is revoked before delivery.

## Evidence

Run from this directory:

```text
node --test *.test.mjs
node table-browser-test.mjs
```

Results: **45 tests passed** (including 16 new transport tests); **9 browser walkthrough groups passed**, no browser console errors. The transport checks include actual PNG rendering and real local HTTP/server persistence. Discord membership, interactions and message edits are simulated SDK boundaries: this is not a live Discord delivery claim.

Browser evidence remains in `qa/table-browser-results.json` and `qa/table-*.png`. Existing privacy, map and HTTP tests also passed. Gortex writes committed. Whole-change detection was refused while indexing remained pending; scoped contract allowed the behavioral change, no guard rules were configured, and graph coverage was incomplete. Actual executable tests supply the coverage evidence.

## Attach to the gateway next

1. Revalidate the active gateway and human campaign binding. Inspection found no active Davy gateway or authority at the expected local ports; only PostgreSQL/Redis containers, the local atlas/table previews and Stable Diffusion were running. The Davy source gateway is `C:/Users/Hermes/Projects/Davy Jones/apps/bot-gateway/main.js`, with the existing Hollow Lantern composition in `src/discord/hollow-lantern-config.js`. Starting that whole gateway has unrelated startup registration and optional autoplay behavior; inspect its current configuration before starting it.
2. Use the actual Unwritten Coast authority and approved Discord account-to-character bindings. Do not use `previewState()` or the fictional playtest party as live campaign state. Do not guess which humans own Mara, Ivo, Sable or Tern.
3. Construct `createDiscordTable` with the existing client, shared store and explicit `guildId`, `channelId`, `applicationId`, `gmUserId`, and `members: [{ownerId, actorId}]`. Route only `coast:` interactions to `handleInteraction` in the existing dispatcher's manual-ack path. Keep `mountListener:false` when the gateway already dispatches interactions; do not install a competing wildcard listener or a second bot login.
4. Bind only the reviewed existing public message ID for automatic refresh. The controller does not publish an initial message or provision threads. The one-DM/one-player thread topology and recoverable initial publication still need actual host integration.
5. Connect the shared projection and commands to the existing authenticated Activity/web session boundary. Never expose the preview GM port or its capability links as production authentication. Its current CSP intentionally prevents framing, so it is not an Activity deployment.
6. Verify actual Discord button clicks, private recipient views, attachments, permissions, round refreshes and restart recovery, then verify the same flow in authenticated web/Activity.

## Preview process and recovery

The pre-existing preview process **31328** on **51950/51951** was not restarted. The attempt to back up its default `presentation-preview/state.json` found no file; this indicates no saved state at that path, not an empty live campaign. A subsequent restart request was rejected by automatic approval review as `blocked by policy`, without a more specific reason. The previous process was left intact. The new implementation was exercised only through isolated test servers, all of which closed normally.

A store writes `<stateFile>.lock` containing its PID and random lease. Normal `close()` drains accepted writes and releases its own reservation. A crashed process may leave a reservation: first verify that exact owner is stopped, preserve the state and reservation, then recover that specific reservation before reopening. Never delete a live writer's reservation or start a second writer against the same file. The original preview predates this lock and must be stopped cleanly before the new authority is attached to its state path.

Still pending for the full goal: live gateway integration, authenticated Activity, actual private thread topology, complete illustrated 3D dungeon art and slices, full miniatures and all required map varieties, live end-to-end acceptance. Existing `TABLE-HANDOFF.md` continues to describe the visual rehearsal and its limits.
