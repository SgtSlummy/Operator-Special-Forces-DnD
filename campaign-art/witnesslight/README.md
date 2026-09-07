# Witnesslight — campaign image library

Original art direction for The Lanterns of Greyharbor and the optional Behind the Veil expedition. Created with the built-in image generator. Exact prompts and asset paths are in `manifest.json`.

Browse the [searchable gallery](gallery.html) or [combined collection](COLLECTION_INDEX.md) for 66 images: 18 campaign scenes, [24 world views](world/WORLD_INDEX.md), [14 recurring-character portraits](people/PEOPLE_INDEX.md), and [10 lore images](lore/LORE_INDEX.md). Each collection has its own exact-prompt manifest. See the [coverage record](COVERAGE.md) for the connection to the authored campaign.

The gallery opens locally and searches all four collections. GM and conditional images start hidden; these filters help with presentation and are not access controls. After adding generated assets to a manifest, rebuild the gallery from the workspace with `node campaign-art/witnesslight/build-gallery.mjs`.

## Visual identity

Ultra-realistic anatomy, faces, worn materials and believable lighting, rendered with the restrained hand-painted finish of classic D&D book illustration. Dramatic staging and bold chiaroscuro. Amber lantern light, slate shadows and muted mineral colors. Detail belongs at the narrative focal point; backgrounds use broad shapes, atmospheric softness and restful shadows. Avoid intricate ornament everywhere, over-sharpening, particle clouds, plastic skin and clutter.

Architecture, clothing and incidental residents in these images are proposed visual continuity, not new plot facts. No player-character appearances are established. Raphael has no universal bodily appearance: depict his presence through light or the manifestation that a player actually chose.

## Reveal boundaries

- `opening/`: opening Greyharbor, home base and festival establishing views.
- `on-discovery/`: show only when the party encounters the location and can perceive the illustrated features. Review against actual current knowledge before sharing.
- `gm-spoilers/`: Glassmere, the Pale Between and Witness Vault. GM preview only until their features have been discovered.
- `conditional/`: homecoming mood art; use only if an actual return occurs.

Directory names are editorial labels, not access controls. Never share this entire folder or manifest as a player handout. Scenes show possible encounter conditions, not proof that an encounter has happened. Interior art can disclose more than merely knowing a place name. These are narrative illustrations, not scaled battle maps.

## Coverage

Movement I: Greyharbor, Last Hearth, Bellweather, Sunken Archive, Ember Crossing and the Festival. Movement II: Thornwake and returning communities. Movement III: Glassmere and Pale Between. Movement IV: Witness Vault with the settlement undecided; conditional homecoming. Nareth: Saltglass Shore, Drowned Abbey, Reedmarket, Cinderworks, Watchspire, Hollow Choir and Crownfast.

## Updating art after player choices

1. Read the latest validated session outcome or user-provided recap. Record the event ID if available; otherwise identify the recap. Do not treat a proposed branch as history.
2. Identify what the viewer knows and what has visibly changed: damage, repairs, weather, time, allegiance, resident presence, rescued people, losses, or new construction. Do not infer an undiscovered secret from GM access.
3. Choose the closest existing image, inspect it, and pass it as an image reference. Preserve layout, recurring faces, materials and Witnesslight treatment unless the event changes them. For new characters, establish an appearance only from player descriptions or an explicitly recorded visual proposal.
4. Generate only the changed scene or newly encountered place. Never preselect success, death, a political settlement, or a player's actions. The Nareth Veil is distinct from the Concord; its ritualists are people. Edran Voss and Maelor Voss are different characters.
5. Save a sibling `ID-v002.png` (then v003, etc.). Retain earlier versions. Add the exact prompt, reference paths, source event/recap, visible changes, locked features, visibility and current status to the manifest or a companion revision record.
6. Inspect the image for continuity, accidental spoilers, unwanted detail, malformed anatomy and invented outcomes before showing it. Keep only the appropriate player-visible image in a session handout.

### Reusable change prompt

Use Witnesslight: ultra-realistic classic D&D illustration, dramatic natural light, selective focal detail, quiet backgrounds and restrained ornament. Reference image: [path]. Current established scene: [facts]. Source: [event or recap]. Change only: [visible consequences]. Preserve: [location geometry, recurring identities, objects, palette]. Viewer knowledge: [discovered facts]. Exclude: [unrevealed facts and unchosen outcomes]. No text, watermark or UI.

### Session update record

Session / in-world date:
Source events or recap:
Actual player choices and resolved results:
Visible changes:
Characters present and appearance references:
Party-discovered information:
Secrets to exclude:
Base image:
New version:

This library supports future generation in conversation and the [on-demand browser/Discord image service](../../raphael-council/images/README.md). Players may request their view at any time, with no game-action or time cost. The runtime uses host-published observable scene snapshots and approved image references; the library itself is not an automatic game-state listener. Continue by reporting what happened in play, then update the visible projection and use the matching reference to create the next version.
