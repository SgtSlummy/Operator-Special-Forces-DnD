# Map table surface brief

## Purpose and operating mode

Operate: a local GM table for understanding the location, selecting a floor, manually placing player markers, and exporting maps for Discord. Original detailed fantasy architectural maps lead the surface. The supplied stone, brass, water, and parchment references inform the imagery and restrained interface.

## Shipped scope

- Beacon Heart: a 3D overview and four proposed floor slices at 0, 100, 200, and 275 feet. The canonical envelope remains 180 feet in diameter and 300 feet tall; these interior floor divisions are proposals.
- Ferry: a 3D overview, proposed main deck, and proposed lower hold at -8 feet.
- Manual player markers synchronize across the overview and selected floor slice. The roster provides player names, numbers, and floor locations.
- Discord-ready exports come from the local viewer. The implementation uses static HTML, CSS, and browser modules with a local server; it has no bot integration or live player tracking.

## Composition and interaction

Area selection and horizontal floor navigation precede the paired maps. Desktop gives more width to the floor slice; mobile stacks both complete maps and uses a two-column roster. The GM selects a player, places or updates their position, and exports the desired view. Feedback stays directly below export controls in normal flow.

The reusable visual tokens and component treatment are recorded in DESIGN.md and its .impeccable/design.json sidecar. These files apply only to this isolated viewer. No global workflow preference or campaign-wide redesign is implied.

## Asset provenance and interpretation

Original source images retain signed provenance. PROMPTS.md and manifest.json record origins. The new art is inspired by the supplied examples; it does not claim to be a canonical engineering plan. The proposed floors and ferry arrangement remain visibly distinguished from established campaign dimensions.

## Finish evidence and limits

The visual review identified a sticky status strip covering map content. Status was moved into normal flow, and updated 1440px desktop and 390px mobile captures were reviewed with the obstruction confirmed resolved. The mechanical cream-palette warning is intentionally accepted because the palette follows the reference art.

Ten model/server tests pass according to the implementation validation. This is focused evidence, not a full graph coverage claim or exhaustive accessibility certification. General controls use 44px minimum heights, while map marker targets are smaller. Sidecar component previews are representative documentation rather than a separate production component library. No new tests are required solely for these documentation additions.
