# Local image runtime

The project has a local ComfyUI source checkout at `local/ComfyUI`.

This machine has an RTX 3090 with 24 GB VRAM, but it does not currently have the ComfyUI Windows runtime or an image checkpoint installed. The Raphael app therefore stays on its approved-art fallback until the local renderer is ready.

Recommended Windows setup:

1. Download the official NVIDIA portable build from the ComfyUI repository releases:
   `https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z`
2. Extract it under this `local` directory, or use the ComfyUI Desktop installer.
3. Put a compatible checkpoint in `ComfyUI\models\checkpoints`.
4. Start ComfyUI on `127.0.0.1:8188`.
5. Set these values in `raphael-council\.env.local`:

```env
RAPHAEL_IMAGE_BACKEND=comfyui
RAPHAEL_COMFYUI_URL=http://127.0.0.1:8188
RAPHAEL_COMFYUI_WORKFLOW=C:\path\to\portrait-api-workflow.json
RAPHAEL_PORTRAIT_ENABLED=1
```

The workflow must be API-format JSON and may use `__RAPHAEL_PROMPT__`, `__RAPHAEL_SEED__`, and `__RAPHAEL_REFERENCE__`. The adapter only accepts local loopback ComfyUI URLs and validates every returned PNG.
