# The Unwritten Coast — Discovery Atlas

A separate campaign preparation table with 35 illustrated spaces, layered maps, discovery records, and concise Discord scene embeds.

## Open the table

- GM: http://127.0.0.1:51940/
- Players: http://127.0.0.1:51941/
- Confirmed Discord preview: https://discord.com/channels/1463393482306486387/1548380866386858175/1548406532729741579

Both addresses work on this computer. Share exported player images or Discord embeds with remote players; this service has not been deployed publicly. Keep the GM address and complete catalog private.

To start again, open a terminal in this folder and run `node server.mjs`. Node.js is installed; there are no additional runtime package dependencies. Leave that process running while using the table. Stop it with Ctrl+C.

## Run a scene

1. Choose an area and room. Browsing the GM atlas does not reveal anything.
2. In **GM discovery desk**, visit the room when the company enters it, or record a discovery and its reason. Ordinary visible navigation does not require a check.
3. Ask what the player tries. Select a point of interest, describe the interaction, enter the final check total, and resolve it. A failed check keeps concealed details hidden; a successful check can reveal information, objects, or optional rooms.
4. Place each player using the room and two percentage coordinates. Their positions are shared by the tactical and 3D views. Player markers use distinct colors and the party legend; cream numbered pins identify interactions.
5. Open **Scene cards for Discord**. Select the intended Discord destination, then post the player scene embed. The server always prepares this post from the player record, even when the GM is looking at the complete atlas.

**Scene** shows an illustration, short flavor text and observable details. **Tactical** provides the measured 5-foot grid. **3D dungeon** provides a rotatable architectural cutaway with floor selection. **Room index** uses illustrated room cards and hallway lines. **Town** and **Town grid** connect buildings and interiors. **World** distinguishes visited places from learned leads.

The cutaway is authored map geometry, not a rendered Unity world. Scene artwork is atmospheric; use the measured tactical geometry for distance, door placement and movement. Illustrated hallway lines are schematic connections.

## Discoveries and journeys

The player server receives only revealed rooms, links, POIs and known or learned places. It never receives the GM catalog, secret DCs, undiscovered geometry or private notes. Discovering an observable object does not automatically expose its solution. Important authored contents become available after the interaction resolves.

Record directions with **Record this road as learned**. This reveals the road and destination without marking them visited or revealing interiors. **Begin the journey** makes one encounter check per journey leg. Known roads use the selected base percentage; unknown roads use twice that percentage, capped at 100%. For example, 15% becomes 30%. The server rolls the encounter; the GM adjudicates what happens. It does not simulate combat or generate another play session automatically.

## Discord presentation and connection

The channel-scoped webhook is named **The Unwritten Coast · GM** in #dnd-arcade. The first preview is a confirmed real Discord embed with a picture and separate fields for visible surroundings, points of interest and the next decision. It was posted in **The Unwritten Coast · Agent Playtest · Sessions 1–4** as a presentation preview, without new player actions.

The webhook URL stays only in the running server's memory. After restarting the server, open Discord channel settings → Integrations → Webhooks, copy that webhook URL, and paste it into **Channel webhook URL** in the GM atlas. Click **Connect channel**, then use **Copy compact post** to replace the clipboard with public scene text. Do not save the webhook URL in this folder or a screenshot.

Sending is explicit. The table does not read Discord messages, infer checks, advance discoveries or send posts automatically. Allowed destinations are the existing agent playtest thread and the human Ferry With No Shore thread. The default is the agent playtest preview. Downloadable scene cards and map PNGs are also available for manual attachments. GM map downloads are prominently labeled PRIVATE GM MAP; use player downloads for the party.

## Saved state and recovery

Campaign state is saved atomically at:

`C:\Users\Hermes\Projects\Unwritten-Coast-Data\discovery-atlas\state.json`

The first accepted change creates this file. The initial table starts at Ferry Arrival Deck with Mara Venn, Ivo Quill, Sable Reed and Brother Tern. It does not import the completed four-session agent rehearsal or change the existing human campaign. The original atlas under `../discord-maps` remains separate.

For a backup, stop this server and copy the state file plus this project folder to a dated folder under `C:\Users\Hermes\LocalFiles`. To restore, stop the server, preserve the current state file, restore the backed-up state and matching catalog/art, then restart. Never replace state while the server is saving. Temporary Windows file locks are retried; a failed save preserves the last saved and in-memory state and reports the failure.

## Verification and authoring

See [VERIFICATION.md](VERIFICATION.md) for checks and known limitations, [CONTENT.md](CONTENT.md) for the authored expansion and [ART-PROVENANCE.md](ART-PROVENANCE.md) for illustration generation records. Run `node --test model.test.mjs server.test.mjs render.test.mjs` from this folder to repeat the automated suite.
