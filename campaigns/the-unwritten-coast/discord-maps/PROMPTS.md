# Map-generation provenance

Tool: the built-in OpenAI image generation tool, `image_gen.imagegen`. Each final raster was generated as a separate asset. The input reference images were viewed before the edits. Originals remain under `C:/Users/Hermes/.codex/generated_images/01a091fb-3146-7eb0-b710-2b34bc5d41c0/`. The copied files preserve their embedded provenance. These are original campaign illustrations, not reproductions of the user's commercial map references.

## Beacon slices

Reference for all four: `campaign-art/unwritten-coast/v1/on-discovery/07-beacon-heart-cutaway.png`, itself an original built-in image-generation output (`exec-c3f31209-f60a-474c-b3c2-da580d627206.png`).

The exact prompt for each slice is the following shared prefix, one space, then its suffix below.

Shared prefix:

Create ONE original highly detailed architectural battle-map slice derived from this Beacon Heart reference. STRICT ORTHOGRAPHIC TOP-DOWN, square 1536x1536 composition, north at top, no perspective, no text, no labels, no tokens, no grid. Same cylindrical 180-foot diameter tower on every floor: centered precisely at (50%,50%), exterior wall occupies circle radius44% of image, central luminous brass shaft radius8%; warm parchment margin outside tower, slate blue stone, aged brass, fine masonry and machinery, warm tiny lanterns. Preserve an east lift landing at (87%,50%) and west stair landing at (13%,50%); radial east/west passages connect outer circulation to inner ring. These are individual floor plans, no stacked floors, no ghosted higher floors. Readable walkways with exquisite small architectural detail.

### beacon-00.png

Original: `exec-140ac71d-81c7-4310-b67f-a46f1313e887.png`.

GROUND FLOOR: continuous stone floor between central shaft and outer wall, inner round console desk ring at radius19%, six control consoles, cable trenches with brass grilles, four huge radial pipes against perimeter, tools and service cupboards. Wide uncluttered circulating floor. Entrance doorway at south rim. The center glows amber.

### beacon-100.png

Original: `exec-26d3062d-ce93-4d2a-9d57-bb6196c31b23.png`.

LOWER MAINTENANCE RING: a broad circular annular walkway from radius24% to radius40%, balustrade all along its inside edge; deep nearly black open void from radius9% to24% except two narrow east-west railed bridge spokes. Brass pipe manifolds in northeast and southwest perimeter niches; small hoist station north, spares bench south. All walkways warm grey stone with brass trim.

### beacon-200.png

Original: `exec-6d56706e-037a-4a0b-8f4e-8dc276d17421.png`.

UPPER SIGNAL GALLERY: broad annular walkway from radius24% to radius40%, brass inside balustrade; deep nearly black open void from radius9% to24% except two east-west railed bridge spokes. Lens calibration tables in northwest perimeter alcove, astronomical dial south, blue glass instrument cabinets northeast. Clear broad circular circulation; central shaft glows amber.

### beacon-275.png

Original: `exec-175d31c7-690d-4008-aae9-11d8c375b130.png`.

CROWN OBSERVATORY: broad annular walkway from radius24% to radius40%, inside balustrade; dark open void from radius9% to24% except east-west railed bridge spokes. Outer rim lined with delicate brass gear trains and four hydraulic piston plinths; north rim a moon lens cradle, south rim a broad clear viewing apron. Huge central shaft terminates in a jewel-like brass lens cap.

## Ferry layers

Reference for all three: `campaign-art/unwritten-coast/v1/opening/03-ferry-landing.png`, itself an original built-in image-generation output (`exec-43298697-a81f-4cdf-a89b-e02364e4141d.png`). Full exact prompts follow.

### ferry-overview.png

Original: `exec-3ab73924-544c-402a-ad70-438a5e900085.png`.

Create one extremely detailed 3D isometric architectural cutaway of this same small Brinewatch passenger ferry and quay. Landscape composition 1536x1024. Original painted tabletop cartography, blue slate stone, warm amber lamps, dark teal seawater, copper and weathered oak. Preserve quay across back/top and ferry across front/bottom, pointed bow to left and small enclosed wheelhouse at right stern. Show one long ferry with an open main passenger deck with benches, broad gangplank to quay midpoint, and cut away the front-facing hull to reveal a lower cargo deck with ribs, casks, bunks and a narrow clear aisle directly below main deck. Upper deck at roughly 55% image height, lower deck at 76%, boat length spanning x20%-88%. Keep two floors physically connected by a stair near right-side wheelhouse. Harbor office and shed behind quay. Rich miniature architectural detail, readable paths, no people, no tokens, no labels, no words, no grid. Wide parchment margin framing diorama.

### ferry-main.png

Original: `exec-debde674-2426-474c-b622-8f573e883482.png`.

One original architectural FLOOR PLAN of this same passenger ferry and quay, true orthographic overhead, landscape1536x1024. No visible exterior side walls and no perspective. Quay across upper half, vessel below. Boat pointed bow LEFT, stern RIGHT, hull fits x18%-90%, y56%-87%, center y72%. Main deck only: four bench blocks with wide central and side aisles, wheelhouse roof removed near x76%,y72% showing helm and desk; stair to lower deck beside wheelhouse at x70%,y71%. Broad gangplank runs vertically from x52%,y39% quay edge to x52%,y58% ship deck. Harbor office interior at x25%-47%,y5%-24%, storage shed interior x63%-89%,y5%-24%, quay clear path y27%-42%. Exquisitely detailed weathered planks and wet slate, tiny rope coils and lanterns, dark teal water, no humans, no tokens, no text, no labels, no grid.

### ferry-hold.png

Original: `exec-07c96b84-6878-4753-b580-87e22eb5a110.png`.

One original top-down architectural LOWER DECK FLOOR PLAN of the Brinewatch passenger ferry, true orthographic overhead, landscape1536x1024. Keep the exact ship alignment of paired main floor: boat pointed bow LEFT, stern RIGHT, hull fits x18%-90%,y56%-87%, center y72%; all other space is quiet dark teal water with a faint north quay outline across top solely for registration. Show only this single lower floor. Hull roof and upper deck entirely removed, thick curving timber ribs, forward bow locker left, cargo casks and tied crates north-side, six passenger bunks south-side, clear long central aisle at y71%, watertight bulkhead door near x58%, staircase UP at x70%,y71%, small pump and rudder machinery at right. Tiny lamps, worn oak, brass fittings, beautifully painted believable architecture. No perspective, no characters, no tokens, no grid, no text, no labels.

## Inspection and registration

All seven new images were inspected at generation. The generated ferry hold enlarges and recenters the vessel relative to the requested alignment; `model.mjs` therefore applies a dedicated affine transform to its slice. Painted art contains some wall perspective despite the orthographic request. Dimensions and positions are registered illustrations, not precision CAD. The UI and paired-map PNG exports add text and position overlays at render time; they do not overwrite the original artwork.

Earlier original seven-map set: coast region `exec-c61c00a9-106b-4f28-b3d2-40cc5ba1e593.png`; Brinewatch town `exec-f18d30e7-988b-4d7f-9aa9-13f859b07f34.png`; ferry landing as above; Brass Vestibule `exec-f5c602af-f870-42cb-96b5-9a7333ede14d.png`; final GM entry schematic `exec-0ebe900c-d0d0-4433-be3b-5924f323d35f.png`; Storm-Lens Cavern `exec-36a2cc50-0f9e-42b6-8eb7-0a6f7d8b8e55.png`; Beacon Heart as above. The final schematic removes a misleading scale bar from its first draft while retaining the NOT TO SCALE note.
