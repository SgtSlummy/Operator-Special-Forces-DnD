# Local D&D image generation with AUTOMATIC1111

This is a local image-generation sidecar for `tegridydev/dnd-llm-game` (the linked DNDLLM26 project). It uses [AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui) for prompt-to-image, image-to-image, inpainting, LoRA loading, and its local API.

The WebUI runs on the host with persistent model data in this directory. Podman remains useful for the optional SDXL LoRA trainer, but the upstream AUTOMATIC1111 repository is installed and launched directly with its documented Python/Git workflow.

## Requirements

- Windows 10/11: Python 3.10.6 and Git. The upstream project warns that newer Python versions may not support its Torch setup.
- Podman 4.1+ or Podman Desktop only if you will train the optional D&D LoRA.
- NVIDIA GPU strongly recommended. CPU mode is available for a smoke test but is very slow.
- At least 8 GB VRAM for conservative SDXL LoRA training; 12 GB or more is more comfortable.
- Several tens of GB of storage for the WebUI environment, checkpoint, cache, dataset, and LoRA outputs.

On Windows, keep large model/cache directories outside a slow NTFS-mounted OneDrive path when possible. The launch scripts still use project-local paths by default so the setup is easy to move.

## First run (PowerShell)

From this directory:

```powershell
.\install-stable-diffusion-webui.ps1
.\run-stable-diffusion-webui.ps1
```

The installer clones the upstream repository into `stable-diffusion-webui` and creates the persistent directories. The first launch creates the WebUI virtual environment and downloads Python dependencies. Open <http://127.0.0.1:7860>.

The launcher enables the local API and points the WebUI at the project storage directories. It does not expose the service on the network. Use `-Cpu` for a UI/API smoke test without CUDA:

```powershell
.\run-stable-diffusion-webui.ps1 -Cpu
```

Place a checkpoint at:

```text
storage-models/models/Stable-diffusion/
```

The SDXL base checkpoint should be named `sd_xl_base_1.0.safetensors` if you want to reuse the training scripts below. LoRAs go in `storage-models/models/Lora/`, VAE files in `storage-models/models/VAE/`, and textual-inversion embeddings in `storage-webui/embeddings/`.

## Linux or WSL2

```bash
chmod +x install-stable-diffusion-webui.sh run-stable-diffusion-webui.sh train-sdxl-lora.sh
./install-stable-diffusion-webui.sh
./run-stable-diffusion-webui.sh
```

Use `./run-stable-diffusion-webui.sh --cpu` for a CPU-only smoke test. The WebUI is available at <http://127.0.0.1:7860>.

## Train a D&D LoRA

Put training images and matching caption files in the following layout. The number before the folder name is the repeat count; `dndforge` is the trigger token used in prompts.

```text
training/
├── dataset/
│   └── 10_dndforge/
│       ├── elf-ranger-01.png
│       ├── elf-ranger-01.txt
│       ├── dwarf-cleric-01.png
│       └── dwarf-cleric-01.txt
└── output/
```

A caption can look like:

```text
dndforge, fantasy tabletop character portrait, wood elf ranger, green cloak, short bow, three-quarter view, painted concept art
```

Start with 20–50 legally usable images that share the style or subject you want to learn. Keep captions descriptive so the learned token controls the D&D style/subject instead of replacing every prompt with one memorized composition.

Build the trainer once:

```powershell
podman build -f Containerfile.trainer -t dnd-sdxl-trainer:local .
.\train-sdxl-lora.ps1
```

The trainer expects the base checkpoint at `storage-models/models/Stable-diffusion/sd_xl_base_1.0.safetensors` and writes `.safetensors` LoRA files to `training/output/`. Copy the finished LoRA into `storage-models/models/Lora/`, then load it in AUTOMATIC1111 with a starting weight around `0.6–0.9`.

The training script uses conservative defaults: batch size 1, gradient checkpointing, latent/text-encoder caching, U-Net-only LoRA, FP16, bucketed 1024px training, rank 32, and 10 epochs. Adjust through environment variables, for example:

```powershell
$env:EPOCHS = "20"
$env:NETWORK_DIM = "16"
$env:MODEL_NAME = "dndforge-style"
.\train-sdxl-lora.ps1
```

## API and game integration

The WebUI API is local at `http://127.0.0.1:7860`. Keep both this sidecar and the linked Ollama/React/FastAPI stack bound to loopback. A later game integration can call the AUTOMATIC1111 txt2img, img2img, and progress endpoints without adding a cloud image provider.

Keep the vendored `dnd-data` library under `dnd-data/` as local source material for future game and prompt integrations. It includes JSON datasets for backgrounds, classes, items, monsters, species, and spells. See [dnd-data/PROJECT-INTEGRATION.md](dnd-data/PROJECT-INTEGRATION.md) for the pinned upstream revision and usage examples.

## Relationship to the linked DNDLLM26 app

Run the linked app's Ollama/React/FastAPI stack as documented in its own README. Run this image sidecar separately. The image generator is available at `http://127.0.0.1:7860`; the local API can later be wired into the game's character, hero, or scene screens.

## Sources

- [AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui) — upstream WebUI, AGPL-3.0.
- [SDXL LoRA training](https://github.com/kohya-ss/sd-scripts/blob/main/docs/sdxl_train_network.md)
- [Linked DNDLLM26 project](https://github.com/tegridydev/dnd-llm-game)
- [nick-aschenbach/dnd-data](https://github.com/nick-aschenbach/dnd-data) — vendored D&D datasets and MIT license.
