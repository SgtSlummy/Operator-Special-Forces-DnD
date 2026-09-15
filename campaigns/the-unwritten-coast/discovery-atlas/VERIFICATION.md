# Discovery atlas verification — 12 September 2026

## Result

The separate local atlas is implemented and running on GM port 51940 and player port 51941. It contains 35 room illustrations, 36 room connections, seven places and seven roads. A real Discord image embed was posted successfully in the existing agent playtest thread. The original human campaign, original atlas and completed four-session record were preserved.

## Automated checks

`node --test model.test.mjs server.test.mjs render.test.mjs`

Final result: **20 passed, 0 failed, 0 skipped**.

Coverage includes:

- Initial player record contains only the entry room and starting place.
- Concealed discoveries require a successful explicit interaction; failed checks do not reveal them.
- Observable objects withhold authored solutions until examination succeeds.
- Movement rejects unseen rooms and out-of-bounds normalized coordinates.
- Learned roads reveal directions and destinations without marking them visited.
- Unknown-road encounter chance is exactly twice the selected base, with endpoint/clamping tests.
- Public HTTP surface rejects mutations and withholds source, hidden content and unauthorized art.
- GM operations require the local origin and capability.
- Queued atomic saves handle transient Windows locks; exhausted retries preserve both disk and memory state.
- Discord requests use player projections, fixed permitted destinations, strict webhook URLs and idempotency protection. The secret URL is not returned or logged.
- SVG injection protection, geometric finiteness, matching marker coordinates and discovery-filtered connections.
- Strict XML parsing of 144 exported SVG documents across all room and combined views.
- CSP permits self/data/blob images needed by PNG export while retaining restrictive script, connection and frame policies.

## Browser acceptance

Tested against the real UI in a separate QA server and state file, without performing new human campaign actions:

1. Visited The Salt Lantern from the ferry entry.
2. Investigated the repaired hearth stone with total 5: cellar stayed hidden.
3. Repeated the isolated test interaction with total 16: cellar was revealed.
4. Recorded directions to Crown Beacon: one known road and the learned destination appeared; its interiors were not revealed.
5. Moved Mara to x=0.23, y=0.67 in the tavern.
6. Stopped and restarted the QA server. Public record still contained exactly f-deck, t-tavern and t-cellar, one road, Brinewatch and Crown Beacon, plus Mara's saved position.
7. Confirmed the main preparation table still contained only f-deck in its player projection.

QA state retained at `C:\Users\Hermes\Projects\Unwritten-Coast-Data\qa\20260912-browser-state.json`. The QA server was stopped and its browser tab closed after verification.

Verified actual downloads and visually inspected:

- `C:\Users\Hermes\Downloads\f-deck-scene.png` — illustrated player card, numbered POIs, short flavor and three observable details.
- `C:\Users\Hermes\Downloads\gm-f-deck-tactical.png` — measured grid, distinct party markers and PRIVATE GM MAP label.
- `C:\Users\Hermes\Downloads\gm-R01-diagram.png` — full 18-room illustrated Undertow index with schematic hallway connections and audience label.

Desktop and narrow-screen views were reviewed. Impeccable detect returned one cream-palette warning. The parchment background was retained deliberately to match the established atlas and supplied cartographic references; maps use dark teal fields for contrast. Console records retained the earlier export errors from before the CSP fix; no new export errors followed the verified downloads.

## Discord delivery receipt

- Guild: 1463393482306486387
- Parent channel: 1546676505780944979 (#dnd-arcade)
- Thread: 1548380866386858175 — The Unwritten Coast · Agent Playtest · Sessions 1–4
- Webhook display name: The Unwritten Coast · GM
- Message: 1548406532729741579
- Receipt: https://discord.com/channels/1463393482306486387/1548380866386858175/1548406532729741579
- Caption: Atlas presentation preview · no new player actions
- Embed: Ferry Arrival Deck, room picture, brief flavor, Visible surroundings, Points of interest, Next decision.

After the final server restart the existing webhook was reconnected through Discord's copy button and the local password input, without reading or printing its secret. Connection status was verified. The clipboard was replaced with public scene text. The preview was not sent twice.

## Implementation and evidence limits

This is a local GM-operated preparation and presentation tool. It does not automatically ingest Discord actions or run future sessions. Images, room cards and maps are exported or sent deliberately. A local player URL is not a remotely hosted tabletop.

The 3D view is a rotatable layered architectural cutaway; the room index is a schematic. Illustrations provide atmosphere, not exact scale. Important objects are revealed through labels, overlays and authored results; images are not dynamically repainted. Tactical geometry is the source of measured distances.

The earlier four-session agent rehearsal remains an accelerated lightweight d20 playtest, not four human-length sessions or an official D&D balance test. Its historical floor-position snapshots can contain overlapping markers. This new atlas keeps distinct marker coordinates, but does not retroactively regenerate or replace every old Discord attachment.

All source edits used Gortex guarded operations. Disk commits were confirmed, but graph verification remains incomplete: global change detection reports unrelated tracked changes and omits this untracked new folder; global freshness still timed out. A recovered startServers symbol did resolve: Gortex found its covering server tests, reported no configured guard rules, and warned about the behavioral change risk with a blast of two. Those covering tests passed in the final suite. The generic risk warning remains; no unrelated refactor was added merely to clear a score. An earlier server.test.mjs receipt commit-326 recorded a graph patch failure after a successful disk commit. Physical file hash matched that receipt. A scoped reindex attempt timed out; no daemon restart, full reindex or unsafe retry was made. The passing runtime tests and browser checks above are the acceptance evidence; no clean repository-wide graph audit is claimed.
