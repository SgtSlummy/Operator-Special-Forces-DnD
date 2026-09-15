# Brass Vestibule architectural artwork

Completed a first measured room-art set on 2026-09-13 UTC. This advances the full Unwritten Coast map goal; it is not the completed dungeon or a live campaign cutover.

## Outputs

- `../art/architecture/r01-cutaway.png`: full 18 × 12 × 10 foot vestibule, roof and near walls removed for visibility.
- `../art/architecture/r01-floor-slice.png`: top-down architectural section at four feet, cut from that same mesh.
- `../art/architecture/r01-low-cutaway.png`: oblique view of that four-foot section.
- `../art/architecture/r01-projection.json`: measured dimensions, camera projections and visible feature anchors.
- `review/*.svg` and `review/*.png`: all three views with the same illustrative party positions, portrait pins and five-foot grid. Each is labeled as a placement study, not live tracking.
- Editable complete model: `C:/Users/Hermes/Projects/Unwritten-Coast-Data/architecture/r01-brass-vestibule.blend`.

The room has one occupied floor. The horizontal slice is an architectural section, not a newly invented story. No secret room, check answer or hidden item is painted into these images.

## Local generation and reproducibility

`generate-materials.mjs --generate` made two 512 × 512 tiled surface images through the existing local AUTOMATIC1111 API at `http://127.0.0.1:7860`. It used verbose prompts, 32 DPM++ 2M steps, seeds 419031 and 419032, and the already installed `v1-5-pruned-emaonly` checkpoint (SHA256 `6ce0161689b3853acaa03779ec93eafe75a02f4ced659bee03f50797806fa2fa`). Exact prompts, settings, response metadata and PNG hashes are beside the materials in `.provenance.json` files. Existing shared installation and models were reused without updates or exposure changes.

Blender then built and lit the actual geometry using those SD surface images. These are **Blender renders with locally generated SD materials**, not an assertion that Stable Diffusion independently produced perfectly matching plans. The renderer used Cycles on the detected CUDA GPU, 48 samples, denoising, and 1600 × 1200 output. Objects include individually beveled limestone flags, the brass door and visible chair dent, maintenance hatch, roster sheets, speaking tube, umbrellas, mat and wall lamps.

Portable Blender 4.5.9 LTS was downloaded from the official `https://download.blender.org/release/Blender4.5/` archive. The Windows ZIP matched its official SHA256: `41DA973B9BF95BB312CBEFF4D1982FEB13259B43C821686B9BAFEA4DFE5477CF`. Executable:

`C:/Users/Hermes/LocalFiles/Tools/Blender-4.5.9/blender-4.5.9-windows-x64/blender.exe`

Run from the parent discovery-atlas directory:

```text
node architecture-art/generate-materials.mjs --generate
"C:/Users/Hermes/LocalFiles/Tools/Blender-4.5.9/blender-4.5.9-windows-x64/blender.exe" --background --python-exit-code 1 --python architecture-art/render-vestibule.py
node --test architecture-art/projection.test.mjs
node architecture-art/build-review.mjs
```

The material generator preserves existing outputs. Rendering replaces this task's rendered images and saves a model backup through Blender. No live saves are loaded or changed.

## Verification and integration limits

Seven tests passed: actual PNG dimensions, independently expected orthographic scale, marker coordinates in all three views, room-discovery and geometry checks, filtering of unrecorded notes and off-room players, markup/image-source safety, and SD provenance hashes. The three review SVGs were opened in Chrome, all embedded images decoded, and the resulting PNGs were visually inspected. The renderer log ends with `R01_ARCHITECTURE_COMPLETE` and process exit 0.

`projection.mjs` accepts a recipient-scoped campaign view; it refuses an unknown room or mismatched dimensions. It uses the same normalized party coordinates for every camera. POI labels appear only when the recipient projection records their discovery. Full cutaway labels use object heights; lower cuts use the corresponding floor location for objects above the cut.

**Still to integrate:** this room's door/furnishing placements are authored illustration coordinates and have not been merged with the older schematic layout. The new feature anchors use `R01-a` and `R01-b`, but the old catalog's generic POI coordinates remain unchanged. Update that shared geometry and bind the images/renderer behind the existing discovery checks before using these as the live tactical view. The rest of the dungeon, town/interior sets, true combat miniatures, layer navigation UI and live Discord/Activity binding remain part of the active goal.

The initial model save inside the indexed artwork directory could not rename its temporary file. The complete model was saved successfully outside that watched tree; the first recovery copy is preserved at `C:/Users/Hermes/LocalFiles/UnwrittenCoast/architecture-recovery/r01-first-save.blend`. Blender can return exit 0 despite a Python exception unless `--python-exit-code 1` is specified; subsequent runs used that flag. The initial canvas SVG rasterizer omitted embedded PNGs, so review export now uses Chrome and checks image decoding rather than accepting an empty-background render.

Gortex source writes committed, but full change detection remained unavailable because graph indexing was pending/failed. No configured guard rules; graph contract returned a lower-bound allowance without resolving these new symbols. The executable and rendered-image checks above are the verification evidence.
