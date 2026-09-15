[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:HF_TOKEN)) {
    throw "Set HF_TOKEN to a Hugging Face token after accepting the stabilityai/stable-diffusion-xl-base-1.0 license."
}

$root = (Resolve-Path $PSScriptRoot).Path
$checkpointDir = Join-Path $root "storage-models/models/checkpoints"
New-Item -ItemType Directory -Force -Path $checkpointDir | Out-Null

$runArgs = @(
    "run", "--rm",
    "-e", "HF_TOKEN=$($env:HF_TOKEN)",
    "-v", "${checkpointDir}:/download",
    "python:3.12-slim",
    "sh", "-lc",
    'pip install --no-cache-dir huggingface_hub && hf download stabilityai/stable-diffusion-xl-base-1.0 sd_xl_base_1.0.safetensors --local-dir /download --token "$HF_TOKEN"'
)

& podman @runArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
