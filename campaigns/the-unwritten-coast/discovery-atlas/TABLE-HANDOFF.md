# Illustrated adventure table

Implemented 2026-09-12 for the user's campaign presentation brief. This is an isolated working rehearsal using the existing Unwritten Coast catalog, projection rules, room art and map renderers. It does not replace the running atlas or modify live campaign stores.

## Open

- DM preparation: http://127.0.0.1:51950/
- Shared company view: http://127.0.0.1:51951/
- The DM desk supplies one capability-protected personal link for Mara, Ivo, Sable and Tern. Links expire when this local preview restarts; inventory and discoveries remain in its saved state.
- Start from the canonical project root with `node campaigns/the-unwritten-coast/discovery-atlas/table-server.mjs`.
- Save: C:/Users/Hermes/Projects/Unwritten-Coast-Data/presentation-preview/state.json. The preview has learned rooms, example coins and vitals, and tavern stock deliberately seeded for demonstration. These are not campaign outcomes.

## Implemented

Scene-first coastal presentation, readable narration, six map views, persistent SVG navigation, discovered notes with hover/focus detail, illustrated character markers, private inventories/rewards/shopping, opt-in item sharing, DM requests and replies, recorded Raphael recall with source entries, and a round-based illustrated party-versus-enemy strip. Enemy HP and hidden participants are omitted from player projection until the DM reveals them. Player actions ask the DM for rulings; this does not fabricate rolls or implement autonomous D&D combat.

DM preparation includes the complete dungeon geometry, every room illustration and preparation notes. Player rooms and artwork are restricted to known rooms. Pins are shown only for recorded discoveries. Scene image pin placement inherits the atlas's approximate normalized positions; tactical positions use measured room bounds.

Scene cards, tactical maps and combat strips can be exported as PNG. `table-cards.mjs` uses the same projected state. `discordScene` builds a valid Components V2-shaped message with media, separators, formatted sections and five navigation custom IDs. `threadPlan` defines one private DM thread and one private personal thread per distinct Discord owner.

## Verification

29 Node tests passed: existing atlas regression suite and nine new table tests. New tests cover owner isolation, recall filtering, undiscovered rooms/art, unknown enemy HP, private replies, successful/failed checks, private purchasing and stale revisions, thread-plan uniqueness, HTTP origin/capability checks, and saved state across restart.

The headless Chrome walkthrough in `table-browser-test.mjs` passed nine scenario groups with no browser JavaScript errors and no horizontal document overflow at 1500px or 390px. It exercised purchases, inventory, panel navigation/focus, draft preservation through an unrelated revision, discovery hover notes, PNG exports, health revelation and round refresh, scoped Raphael recall, and following company travel. Evidence lives under qa/table-*.png, qa/*-discord.png and qa/table-browser-results.json.

An independent fresh reviewer identified shared-scene follow, draft loss, panel navigation and keyboard focus issues; these were corrected and the walkthrough verified the relevant paths. Impeccable's one manual detector run reported advisory design-token coverage and border/shadow findings; it is not a zero-advisory certification. Gortex edits committed on disk, but graph detect/guards could not complete because indexing remained pending. Executable tests are the actual verification evidence.

## Artwork

Six new portraits were generated with the existing local Stable Diffusion WebUI, SD 1.5 checkpoint v1-5-pruned-emaonly, DPM++ 2M, 28 steps, 512x640. Exact verbose prompts, negative prompts, seeds and returned generation metadata accompany each image in art/table/*.provenance.json. No cloud image generation was used. Earlier room art is reused, not relabeled as newly generated local work. These are illustrated portraits, not finished animated miniature sprites.

Cormorant Garamond is self-hosted in art/table/coast-serif.ttf; its SIL Open Font License is stored alongside it. Source: https://github.com/google/fonts/tree/main/ofl/cormorantgaramond.

## Remaining integration and art work

- No new Discord threads were created and no messages were posted. Thread-plan shape is tested; actual provisioning, membership checks, idempotent reuse of existing threads and interaction handlers still need to be connected to the live bot.
- This server intentionally binds loopback and rejects remote origins. It is not a published web app or registered Discord Activity. The existing authenticated Activity engine in raphael-council/hollow-lantern remains separate; its identity/command boundary must be used for live rollout. Never deploy the preview's DM-by-port identity model publicly.
- Existing architectural/tactical renderers remain geometric schematics, not newly commissioned detailed illustrated 3D dungeon art. Full miniature sprites, bespoke tactical scenery per room, complete town exterior art and higher-fidelity layered cutaways are not finished.
- Hallway encounters use a straight 60x10-foot tactical fixture; they still reuse room atmosphere for the exported combat strip. Distinct hallway scenery remains to be authored.
- Raphael searches recorded visible events; it is not yet a conversational wiki or a full semantic campaign-memory integration.
- Full enemy art diversity, every room's expanded narration and live round-message replacement remain unfinished.

Discord Components V2 reference: https://docs.discord.com/developers/components/reference. Components V2 uses flag 32768 and components in place of legacy content/embeds; hover notes remain a web interaction. Attach scene.png when using the exported sample message. Do not post custom-ID controls before the live handler has been wired.

## Recovery

Stop only this table-server process. Preserve state.json to retain the rehearsal, or launch startTable with a different local stateFile for a fresh rehearsal. Original atlas ports 51940/51941, the Unity migration, Stable Diffusion service, live Discord resources and live campaign stores were not changed by this implementation.
