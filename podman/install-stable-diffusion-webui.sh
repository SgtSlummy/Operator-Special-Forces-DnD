#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${1:-${SCRIPT_DIR}/stable-diffusion-webui}"
REPO_URL="https://github.com/AUTOMATIC1111/stable-diffusion-webui.git"

command -v git >/dev/null 2>&1 || { echo "Git is required." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required." >&2; exit 1; }

python3 --version
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  echo "Stable Diffusion WebUI already exists at ${INSTALL_DIR}"
elif [[ -e "${INSTALL_DIR}" ]]; then
  echo "${INSTALL_DIR} exists but is not a Git checkout." >&2
  exit 1
else
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

mkdir -p \
  "${SCRIPT_DIR}/storage-models/models/Stable-diffusion" \
  "${SCRIPT_DIR}/storage-models/models/Lora" \
  "${SCRIPT_DIR}/storage-models/models/VAE" \
  "${SCRIPT_DIR}/storage-webui/embeddings" \
  "${SCRIPT_DIR}/training/output"

echo "Ready. Run ./run-stable-diffusion-webui.sh to start the local API."
