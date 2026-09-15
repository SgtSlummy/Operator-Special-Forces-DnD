[CmdletBinding()]
param(
    [switch]$Cpu
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $PSScriptRoot).Path
$directories = @(
    "storage",
    "storage-models/models/checkpoints",
    "storage-models/models/loras",
    "storage-models/hf-hub",
    "storage-models/torch-hub",
    "storage-user/input",
    "storage-user/output",
    "storage-user/workflows"
)

foreach ($directory in $directories) {
    New-Item -ItemType Directory -Force -Path (Join-Path $root $directory) | Out-Null
}

$cliArgs = "--listen 0.0.0.0 --disable-api-nodes"
$runArgs = @(
    "run", "--rm", "--name", "dnd-comfyui",
    "-p", "127.0.0.1:8188:8188",
    "-v", "dnd-comfyui-root:/root",
    "-v", "$(Join-Path $root 'storage-models/models'):/root/ComfyUI/models",
    "-v", "$(Join-Path $root 'storage-models/hf-hub'):/root/.cache/huggingface/hub",
    "-v", "$(Join-Path $root 'storage-models/torch-hub'):/root/.cache/torch/hub",
    "-v", "$(Join-Path $root 'storage-user/input'):/root/ComfyUI/input",
    "-v", "$(Join-Path $root 'storage-user/output'):/root/ComfyUI/output",
    "-v", "$(Join-Path $root 'storage-user/workflows'):/root/ComfyUI/user/default/workflows",
    "--security-opt", "label=disable"
)

if ($Cpu) {
    $cliArgs = "--cpu $cliArgs"
} else {
    $runArgs += @("--device", "nvidia.com/gpu=all")
}

$runArgs += @(
    "-e", "UV_CACHE_DIR=/tmp/uv-cache",
    "-e", "CLI_ARGS=$cliArgs",
    "docker.io/yanwk/comfyui-boot:cu126-slim"
)

& podman @runArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
