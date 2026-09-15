# Discovery atlas content provenance

This is authored starting content, not a session record, canonical player discovery, playtest result or assertion that any beacon was repaired. The original DUNGEON_ATLAS.md remains authoritative for Undertow R01–R18. All eighteen IDs, names, footprint extents, heights/depths and ordinary topology are retained. Public text gives sensory descriptions and visible features; GM notes preserve operational constraints and the Stillwater boundary.

The eight Brinewatch building interiors (Salt Lantern, Copperwake shop, Records House, chapel, exchange, keeper’s home, maintenance house and signal tower), ferry deck/hold, two optional hidden annexes and five coastal visit scenes are new design proposals. Existing location names do not imply invented campaign outcomes. The party begins on the ferry deck; Brinewatch is the only initially known place. Four roads have unnamed destinations until travel. Two optional town interactions reveal hidden rooms after successful checks; essential directions, public records and ordinary exits are never check-gated. The blue door R17 remains visible and has no executable Stillwater shortcut.

## Geometry and artwork contract

Room x/y are top-left schematic world-foot coordinates, scoped by area and floor. Floor/z assignments and inter-room drawing positions are authored visualization proposals: the source specifies local dimensions and passage lengths, not surveyed XY coordinates or a complete elevation profile. Draw corridors as route connectors with passage descriptions, not measurements of their screen length. Preserve source-local dimensions. R08 height is 70 feet over its channel, R03 is a 160-foot shaft, R10 a 70-foot bowl, and R16 a 180-foot hexagonal shaft; these are not uniform ceiling heights. R16’s surface approach grade is schematic. Circular/kidney/L/bent/five-sided extents are bounding boxes. Large rooms need local views, not a compressed harbor-wide combat grid.

Every room has two sentences of flavor, a separate description, three visible features and two located optional interactions. POI and party positions are normalized 0–1. publicArtKey is the room ID. Kind indicates visual intent; each bespoke room plan and illustration must use only flavor, description and visibleFeatures. GM notes, revealed destinations and concealed rooms never belong in shared base art. Hidden annex art becomes eligible only after discovery. Props should not imply extra secret doors, occupants, treasures or completed operations.

GM caveat: Stillwater requires the established dawn/dusk one-hour window, chart and instrument, with capacity adjudicated for the small balcony; no browser travel edge crosses it. R17’s GM notes are never projected to players. Save files track exploration of this proposal only and do not rewrite campaign history.

## Town illustration manifest

Each requested asset is a separate image at art/<room ID>.png, without text labels, maps, grids, tokens, cutaway diagrams, or GM-only objects. Shared direction: atmospheric painterly coastal-fantasy interior, grounded materials, readable architectural depth, 16:9 environmental view, no people. Every listed feature is visible. Only completed image files count as generated assets.

| Asset | Scene and visible-feature prompt |
| --- | --- |
| t-tavern | Rain-dark harbor tavern, warm amber light; hearth-side repaired stone, long dining tables, chalk menu. No visible secret entrance. |
| t-workshop | Copper-filing marine workshop; disassembled pump, tool bench, hanging spare sleeves. |
| t-archive | Sea-worn public records office; slightly proud ledger shelf, reading counter, shelved tide books. Shelf stays shut, no annex view. |
| t-chapel | Small maritime chapel; glass lamp rack, stone benches, offering basin. |
| t-market | Covered coastal exchange; public route board, net-and-float stalls, produce crates. No legible destination labels. |
| t-home | Modest keeper kitchen; window-frame tally cuts, kitchen table, patched coat on peg. |
| t-beacon | Crown Beacon public maintenance interior; weatherproof equipment rack, permit counter, maintenance direction sign. No extra beacon or engine state. |
| t-signal | Waterfront relay room; numbered signal flags, lift landing, harbor-facing window. |
| t-cellar | Optional discovered old cellar; cider inventory slate, empty oak racks, repaired stair stone. |
| t-survey | Optional discovered survey annex; rolled coastal surveys, covered drafting table, brass drafting ruler. Ordinary surveys only. |
| s-mossmere | Reed-lined road shelter; road milestone, dry bench, reed-thatched roof. |
| s-observatory | Observatory visitor gallery; public sky calendar, instrument cases, brass horizon ring. |
| s-saltfen | Quiet tidal wetland; tide-stained posts, pale reed beds, timber boardwalk over a silver pool. |
| s-wreck | Coastal shingle beach; broken wooden keel, shingle, scattered green sea glass. |
| s-orchard | Sheltered orchard; bent apple shoots, cloth windbreaks, stone path. |

All fifteen assets in this manifest were generated individually with the built-in image tool, copied into this project's art directory, and visually inspected on 2026-09-12. Each is a valid 1672 × 941 PNG. These atmospheric scenes illustrate the location; the dimensioned room plan remains authoritative for exact walls and movement. Incidental illustrative furnishings do not add game interactions, secret routes, destinations or campaign facts.

Content verification: 35 unique rooms, 36 valid room links, seven places, one ferry-deck entry, two optional hidden annexes, and no same-area/same-floor bounding-box overlaps. Every room carries a publicArtKey matching its ID and two normalized POIs. Node validation passed. Gortex changes committed; its post-change graph detection could not certify analysis while other workspace edits left the graph stale.
