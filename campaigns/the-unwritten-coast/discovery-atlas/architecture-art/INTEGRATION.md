# Architectural table integration

The existing table now serves R01 illustrations through `GET /api/architecture?room=R01&layer=r01-cutaway`. Accepted layers are `r01-cutaway`, `r01-floor-slice`, and `r01-low-cutaway`. The response is an SVG with embedded local PNG images, current recipient-visible party positions, and only discovered point-of-interest labels. Unknown rooms return 404. Raw architecture files and camera metadata have no public route. If the table revision changes while assets load, delivery returns 409 instead of serving the older projection.

The 3D layers control offers Full room, Floor slice, and Low cutaway for R01 on its own story. Tactical uses the floor slice outside combat. Other locations/stories and active encounters retain the existing maps. The image fits its panel on desktop and mobile. This remains a measured Blender room with local Stable Diffusion surface images and illustrated portrait markers, not a claim of a fully generated 3D dungeon or animated miniatures.

Verification uses temporary isolated table servers and fixture saves; no live campaign state or Discord messages are written. Run from discovery-atlas:

- `node --test architecture-art/delivery.test.mjs architecture-art/projection.test.mjs table.test.mjs table-discord.test.mjs` — 35 passing tests.
- `node architecture-art/browser-test.mjs` — all three layers, current fixture positions, image decoding, map fit, story switching, mobile layout and return to scene.
- `node table-browser-test.mjs` — existing nine walkthrough groups; waits for the asynchronous architectural SVG before its screenshot.

Browser evidence is in `qa/architecture/`. Its four character positions are explicitly test fixtures, not evidence of live campaign movement. The existing long-running preview has not been restarted by this change. Gortex disk edits committed, but graph impact/detection remain unavailable due to older failed and pending index receipts. Symbol contract analysis allowed the behavioral change with lower-bound coverage; actual tests are the verification evidence.

Remaining work includes matching architectural furnishing/door geometry with the broader tactical catalog; architectural combat overlays; more dungeon rooms, town/interior maps and overview art; authenticated Activity and live Discord delivery; and verified private thread topology. Preserve the existing art-studio additions. Do not publish fixture state or claim full campaign completion from these tests.
