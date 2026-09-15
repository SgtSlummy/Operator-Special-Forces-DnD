# Layered atlas handoff

Prepared 2026-09-12 UTC.

## Ready locally

Open http://127.0.0.1:51931/ while the local server is running, or use Start-MapTable.ps1 to restart it. The map table is left open in Codex. The primary browser's five preview markers were saved and preserved on reload. Verification used a separate localhost browser origin so it did not alter those positions.

The asset collection now contains 14 original images: the earlier seven coast/town/room/dungeon maps and seven new layer assets. The interactive table links two detailed 3D overviews to six individual architectural slices:

- Beacon Heart: Foundation, Maintenance ring, Signal gallery, Crown observatory.
- Brinewatch ferry: Quay & passenger deck, Lower hold.

Marker identity, color and position come from one shared record. Floor tabs inspect without moving characters. Stair/landing controls move a selected marker; click/keyboard placement updates both views. Up to eight markers, local persistence, validated save-file import/export, reference grid, current-slice and paired-view PNG downloads are implemented.

Example exports in `exports/`: beacon-b1-paired.png, beacon-b1-slice.png, ferry-f1-paired.png. These use explicitly labeled preview characters. The generation prompts and artwork origins are in PROMPTS.md; manifest.json records all 14 source-image hashes and disclosure categories.

## Verified

- All 10 focused Node model/server tests pass: view-only floor switching, shared projection, inverse registration, tower/ferry transfers, invalid-position rejection, save validation, persistence round trips and server file boundaries.
- Browser verification: keyboard placement changes both views, names synchronize, stairs open the correct layer, ferry hold positions survive reload, reference-grid switch works, PNG export produces local files. Paired ferry and tower exports were visually inspected.
- Desktop 1440px and mobile 390px captures are under `review/`. The mobile page has no horizontal document overflow. Both image assets load. Browser warning/error log was empty after verification.
- Independent visual review accepted the architectural art and matching marker identity, then identified a status overlay obscuring maps. The overlay was removed. The reviewer confirmed that specific fix resolved at both sizes and returned ship for that fix's scope.
- The mechanical design detector's initial missing-image-source warnings were fixed. Its warm-paper-palette warning was intentionally retained to match the user's reference artwork.

Gortex impact, mutation receipts, detection, tests, guards and contract operations were attempted. Detection primarily reports unrelated tracked modifications and omits these new untracked files. No guard rules are configured and graph test mapping does not recognize the focused tests. The selected-symbol contract reports a conservative high/lower-bound warning. Direct functional tests and browser evidence above are the acceptance evidence; no whole-project graph-clean claim is made.

## Honest limits

The floor elevations and detailed interiors are proposed architectural additions. Beacon Heart's established 180-foot diameter / 300-foot height is preserved. Painted-map registration is approximate, especially the isometric overview. Broad footprints and the central void are checked, but walls, furniture, door states, movement distances, visibility and gameplay rules require the GM. Reference squares are not a measured grid.

This is a local GM table and manual position tool. It is not a live Discord Activity, bot movement integration or fog-of-war client. Full cutaways reveal other floors. No player names or actual campaign positions were invented. Live stores, other campaigns, Unity settings and existing cloud configuration were not changed.

## Discord remains pending

Thread: https://discord.com/channels/1463393482306486387/1546676505780944979/threads/1548204446838689882

The Unwritten Coast · 01 — The Ferry With No Shore has one verified introduction post. Map attachments and the opening scene have not been sent. The browser extension rejected local file selection with Not allowed. The user was asked to enable Allow access to file URLs for the ChatGPT browser extension; no confirmation of that setting has arrived. Do not ask them to reconnect Edge again.

OPENING_POST.md contains the ready messages and exact attachment list. After uploads work, post the three public opening images and the opening scene, verify them in the thread, and wait for real player choices. Keep future interiors and GM diagrams for discovery. Do not duplicate the introduction.

## Recovery

Restart the launcher and load the saved positions JSON if necessary. The original generated images are retained alongside the verified project copies. Existing campaign data is untouched. The prior three-pass continuation automation remains paused; this work did not schedule another run.
