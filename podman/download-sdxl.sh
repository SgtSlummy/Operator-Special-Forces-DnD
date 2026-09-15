#!/usr/bin/env bash
set -euo pipefail

: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token after accepting the stabilityai/stable-diffusion-xl-base-1.0 license}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CHECKPOINT_DIR="$ROOT/storage-models/models/checkpoints"
mkdir -p "$CHECKPOINT_DIR"

podman run --rm \
  -e HF_TOKEN \
  -v "$CHECKPOINT_DIR:/download" \
  python:3.12-slim \
  sh -lc 'pip install --no-cache-dir huggingface_hub && hf download stabilityai/stable-diffusion-xl-base-1.0 sd_xl_base_1.0.safetensors --local-dir /download --token "$HF_TOKEN"'
