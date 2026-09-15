[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $PSScriptRoot).Path
$required = Join-Path $root "storage-models/models/checkpoints/sd_xl_base_1.0.safetensors"
if (-not (Test-Path -LiteralPath $required)) {
    throw "Base checkpoint not found at $required. Run .\download-sdxl.ps1 first or set up the file manually."
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "training/dataset") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "training/output") | Out-Null

$envDefaults = @{
    BASE_MODEL = "/models/checkpoints/sd_xl_base_1.0.safetensors"
    TRAIN_DIR = "/data/dataset"
    OUTPUT_DIR = "/data/output"
    MODEL_NAME = "dndforge-style"
    EPOCHS = "10"
    NETWORK_DIM = "32"
    NETWORK_ALPHA = "16"
    LEARNING_RATE = "1e-4"
}
$envArgs = @()
foreach ($entry in $envDefaults.GetEnumerator()) {
    $value = [Environment]::GetEnvironmentVariable($entry.Key)
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = $entry.Value
    }
    $envArgs += @("-e", "$($entry.Key)=$value")
}

$runArgs = @(
    "run", "--rm", "--name", "dnd-sdxl-trainer",
    "--device", "nvidia.com/gpu=all",
    "--security-opt", "label=disable",
    "-v", "$(Join-Path $root 'storage-models'):/models",
    "-v", "$(Join-Path $root 'training'):/data"
) + $envArgs + @("dnd-sdxl-trainer:local")

& podman @runArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
