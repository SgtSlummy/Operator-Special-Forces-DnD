[CmdletBinding()]
param(
    [switch]$Cpu,
    [int]$Port = 7860
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$webuiDir = Join-Path $scriptRoot "stable-diffusion-webui"
$dataDir = Join-Path $scriptRoot "storage-webui"
$modelsDir = Join-Path $scriptRoot "storage-models\models"
$checkpointDir = Join-Path $modelsDir "Stable-diffusion"
$vaeDir = Join-Path $modelsDir "VAE"
$embeddingsDir = Join-Path $dataDir "embeddings"

if (-not (Test-Path (Join-Path $webuiDir "webui-user.bat"))) {
    throw "Stable Diffusion WebUI is not installed. Run .\install-stable-diffusion-webui.ps1 first."
}

foreach ($directory in @($dataDir, $modelsDir, $checkpointDir, $vaeDir, $embeddingsDir)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$arguments = @(
    ('--data-dir="' + $dataDir + '"'),
    ('--models-dir="' + $modelsDir + '"'),
    ('--ckpt-dir="' + $checkpointDir + '"'),
    ('--vae-dir="' + $vaeDir + '"'),
    ('--embeddings-dir="' + $embeddingsDir + '"'),
    "--api",
    "--port=$Port",
    "--no-download-sd-model"
)

if ($Cpu) {
    $arguments += "--skip-torch-cuda-test"
    $arguments += "--use-cpu=all"
}

$env:COMMANDLINE_ARGS = ($arguments -join " ")
$env:WEBUI_LAUNCH_LIVE_OUTPUT = "1"

Push-Location $webuiDir
try {
    & .\webui-user.bat
    if ($LASTEXITCODE -ne 0) {
        throw "Stable Diffusion WebUI exited with code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
