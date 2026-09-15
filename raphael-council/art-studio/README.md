# Campaign Art Studio

The Unwritten Coast's local ComfyUI workbench creates character portraits, location art, item illustrations, and map illustrations. It preserves every version with its prompt, seed, model, and API workflow.

## Open it

- Studio: http://127.0.0.1:51960/
- Full ComfyUI editor: http://127.0.0.1:8188/
- Existing isolated DM table: http://127.0.0.1:51950/ — choose **Illustrate this scene**.

From this folder, run `./Start-ArtStudio.ps1` in PowerShell. It starts the studio and its renderer in the background when needed, and prints the addresses. It does not start the separate game table. Alternatively, run `node server.mjs --start-engine` in a terminal.

The Raphael web app also links to the studio on its Illustrations page when viewed locally. Embedding there is offered on 127.0.0.1; other local hostnames use the standalone link.

## Create and use artwork

1. Choose Character, Location, Item, or Map; write a title and visual brief. **Try an example** loads a starter brief for the selected type.
2. Pick a canvas. **Fine-tune the image** exposes the installed model, steps, seed, and negative prompt. Leave the seed empty for a new composition.
3. Choose **Create artwork**. The preview tracks this exact job; the collection keeps older versions. **Make a variation** restores the saved brief with a fresh seed.
4. Save a PNG, or open the studio through the DM table to enable **Use at the table**. The game panel receives only the projected room description and no player access keys.
5. In **Workflow editor**, download the selected image's workflow. In ComfyUI, press Ctrl+O to open that JSON, or drag it into the editor. The seven linked nodes are editable, including the exact seed and prompt. Changes run directly in the advanced editor remain in ComfyUI's output/history; the studio collection tracks jobs created by its creation form.

The table handoff is a temporary local scene preview. **Restore campaign art**, refreshing the page, changing location, or rendering a different view restores campaign artwork. The original game state, coordinate maps, discoveries, player views, and Discord messages are not changed by generation. Save PNG in the studio for the generated image; existing table scene-card exports use the campaign artwork.

Map output is illustrative. Exact room layouts, distances, line of sight, and movement still come from the campaign's tactical maps. The installed SD 1.5 checkpoint is a working local baseline; prompt adherence and fine detail depend on the model. Other model families can require different workflows in the full editor.

## Local installation

Project root: `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`.

- ComfyUI source: `local/ComfyUI` in that project.
- Isolated Python environment: `raphael-council/art-studio/.runtime`.
- Shared existing checkpoint: `C:/Users/Hermes/stable-diffusion-data/models/Stable-diffusion/v1-5-pruned-emaonly.safetensors`, referenced by `model-paths.yaml`.
- Studio records and PNGs: `art-studio/data/{job-id}.json` and `.png`.
- Renderer output/input/user data and logs: `art-studio/data/comfy-*` and `comfyui.log`.

Runtime and generated data are gitignored. Back up the entire `data` directory to preserve the collection. No project or model data is stored under OneDrive. The existing AUTOMATIC1111 environment is separate.

Validated installation: ComfyUI 0.34.0, frontend 1.51.10, Python 3.13.15, PyTorch 2.14.0+cu130 on the RTX 3090. To recreate the isolated environment, run from this folder with `uv` installed:

```powershell
uv venv --python 3.13 .runtime
uv pip install --python .runtime/Scripts/python.exe torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
uv pip install --python .runtime/Scripts/python.exe -r ../../local/ComfyUI/requirements.txt
./Start-ArtStudio.ps1
```

Those install commands resolve current packages; the versions above record the tested environment. Edit `model-paths.yaml` for another local checkpoint directory. The launcher never installs models or custom nodes.

## Recovery and boundaries

Both services bind to 127.0.0.1. Studio writes require a same-origin request and a per-process capability. The renderer launches with cloud API nodes and custom nodes disabled. The advanced editor is the upstream ComfyUI application; optional templates may describe dependencies that are not installed.

A durable request ID is written before queue submission. Repeating a request returns the same job; a lost response never triggers an automatic duplicate generation. **Check status** reconciles the original ComfyUI job. **Recover last request** retries the studio receipt with the same ID. The studio admits at most eight unresolved images. It accepts output only from the matching, successfully completed history record's SaveImage node.

Automatic selected-image checks pause after four minutes. If disconnected, refresh renderer status and check the original job. A renderer restart can lose its in-memory queue/history; an unresolved job then remains uncertain instead of being silently submitted again. Finished PNGs in the studio remain available across restarts.

## Verification

From the project root:

```powershell
node --test raphael-council/art-studio/studio.test.mjs campaigns/the-unwritten-coast/discovery-atlas/table.test.mjs
```

The studio tests cover graph wiring, validation, origin/capability checks, duplicate requests, queue bounds under concurrency, uncertain submission recovery, and saved PNG/workflow persistence. The table suite covers audience filtering and state/capability persistence. TypeScript checks pass with `npx tsc --noEmit` from `raphael-council`.

Browser verification and rendering evidence are recorded in `VERIFICATION.md`.
