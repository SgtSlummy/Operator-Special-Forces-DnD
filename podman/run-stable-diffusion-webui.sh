#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBUI_DIR="${SCRIPT_DIR}/stable-diffusion-webui"
DATA_DIR="${SCRIPT_DIR}/storage-webui"
MODELS_DIR="${SCRIPT_DIR}/storage-models/models"
CHECKPOINT_DIR="${MODELS_DIR}/Stable-diffusion"
VAE_DIR="${MODELS_DIR}/VAE"
EMBEDDINGS_DIR="${DATA_DIR}/embeddings"
PORT="7860"
CPU="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cpu) CPU="true"; shift ;;
    --port) PORT="${2:?--port requires a number}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ -x "${WEBUI_DIR}/webui-user.sh" ]] || {
  echo "Stable Diffusion WebUI is not installed. Run ./install-stable-diffusion-webui.sh first." >&2
  exit 1
}

mkdir -p "${DATA_DIR}" "${CHECKPOINT_DIR}" "${VAE_DIR}" "${EMBEDDINGS_DIR}"

export COMMANDLINE_ARGS="--data-dir=\"${DATA_DIR}\" --models-dir=\"${MODELS_DIR}\" --ckpt-dir=\"${CHECKPOINT_DIR}\" --vae-dir=\"${VAE_DIR}\" --embeddings-dir=\"${EMBEDDINGS_DIR}\" --api --port=${PORT} --no-download-sd-model"
if [[ "${CPU}" == "true" ]]; then
  export COMMANDLINE_ARGS="${COMMANDLINE_ARGS} --skip-torch-cuda-test --use-cpu=all"
fi

cd "${WEBUI_DIR}"
exec ./webui-user.sh
