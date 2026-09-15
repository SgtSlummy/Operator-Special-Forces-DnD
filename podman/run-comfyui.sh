#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for directory in \
  storage \
  storage-models/models/checkpoints \
  storage-models/models/loras \
  storage-models/hf-hub \
  storage-models/torch-hub \
  storage-user/input \
  storage-user/output \
  storage-user/workflows; do
  mkdir -p "$ROOT/$directory"
done

CLI_ARGS="--listen 0.0.0.0 --disable-api-nodes"
GPU_ARGS=(--device nvidia.com/gpu=all --security-opt label=disable)
if [[ "${1:-}" == "--cpu" ]]; then
  CLI_ARGS="--cpu $CLI_ARGS"
  GPU_ARGS=(--security-opt label=disable)
fi

podman run --rm --name dnd-comfyui \
  -p 127.0.0.1:8188:8188 \
  -v dnd-comfyui-root:/root \
  -v "$ROOT/storage-models/models:/root/ComfyUI/models" \
  -v "$ROOT/storage-models/hf-hub:/root/.cache/huggingface/hub" \
  -v "$ROOT/storage-models/torch-hub:/root/.cache/torch/hub" \
  -v "$ROOT/storage-user/input:/root/ComfyUI/input" \
  -v "$ROOT/storage-user/output:/root/ComfyUI/output" \
  -v "$ROOT/storage-user/workflows:/root/ComfyUI/user/default/workflows" \
  "${GPU_ARGS[@]}" \
  -e UV_CACHE_DIR=/tmp/uv-cache \
  -e "CLI_ARGS=$CLI_ARGS" \
  docker.io/yanwk/comfyui-boot:cu126-slim
