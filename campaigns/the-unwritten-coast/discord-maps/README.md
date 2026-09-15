# The Unwritten Coast — layered map table

Open `Start-MapTable.ps1` with PowerShell, or run `node server.mjs` from this directory and open http://127.0.0.1:51931/. Node.js is required. The server listens only on this computer and serves an explicit map-table file list, not the rest of the project.

## Use the linked maps

1. Choose Beacon Heart or Brinewatch ferry, then choose a floor.
2. Select a numbered marker in the company list or either map. Its number, name and color match across views. Selecting a marker opens its current floor.
3. Floor tabs inspect the building without moving anyone. Use **Move to this floor’s landing** for an agreed area/floor move, or **Go up / Go down** for the next connecting level.
4. Enable **Place selected marker**, then click its current floor. Focus the floor map and use arrow keys for small movements; hold Shift for a larger step. These are manual placements, not movement-rule adjudication. Only broad footprint and central-void limits are checked, not furniture, walls or traversable paths.
5. Rename markers and choose colors. The four initial tokens are explicitly previews. Mark positions as manually entered only after the table supplies actual character locations. The app has no Discord feed or automatic player tracking.
6. **Download slice PNG** exports the current floor and its party markers. **Download paired PNG** adds the whole cutaway with party markers on every floor in that area. Review discoveries before posting: full overviews reveal other floors.
7. Browser storage keeps positions locally. Save/load a positions JSON file for recovery or handoff. Loading validates area, layer, names, colors, coordinates and marker count. Restore preview markers asks before replacing current positions.

## Map inventory

The original seven maps are under `campaign-art/unwritten-coast/v1`: regional coast, Brinewatch town, ferry landing, Brass Vestibule, GM entry schematic, Storm-Lens Cavern and Beacon Heart cutaway.

Seven additional maps under `campaign-art/unwritten-coast/v2-layers`:

| Area | View | Proposed elevation |
| --- | --- | --- |
| Beacon Heart | Foundation | 0 ft |
| Beacon Heart | Maintenance ring | +100 ft |
| Beacon Heart | Signal gallery | +200 ft |
| Beacon Heart | Crown observatory | +275 ft |
| Ferry | 3D cutaway overview | Two decks and quay |
| Ferry | Quay and passenger deck | 0 ft |
| Ferry | Lower hold | -8 ft |

Beacon Heart's 180-foot diameter / 300-foot height is established by the validated dungeon export. Floor heights, individual machinery arrangements, ferry hold and ferry deck separation are proposed additions. Painted maps have approximate registration, not surveyed or production collision geometry. Reference grid squares are image guides and carry no game-distance scale. The ferry hold image has its own scale/offset transform so a saved location can be shown in both its enlarged slice and the cutaway. This tool does not change canonical dungeon rooms, live scenes or gameplay APIs.

## Discord checkpoint

Destination: VIBEZ / #dnd-arcade.
Campaign thread: https://discord.com/channels/1463393482306486387/1546676505780944979/threads/1548204446838689882
Title: The Unwritten Coast · 01 — The Ferry With No Shore.
The introduction is posted. Map attachments and the first scene remain pending the browser extension's file-upload access. The user's existing Davy Jones and Hollow Lantern history is preserved. No player choices have been simulated.

Only the region, town and opening ferry view are intended for the opening reveal. Other rooms, full dungeon schemes and tower layers are GM preparation or on-discovery material. This entire local viewer is a GM table, not a secure fog-of-war player client. Do not publish it as a spoiler-filtered app.

## Validation and recovery

Run `node --test model.test.mjs` for movement, projection, transfers, state import and server file-boundary checks. Validation results are recorded in HANDOFF.md after browser inspection.

To recover, restart the launcher and load a saved positions file. Art originals are retained in the Codex generated-images directory; final copies are under the project's campaign-art directory. No live game store, existing campaign, Unity project or automatic campaign selection was modified. No map data is sent to external services by this viewer.
