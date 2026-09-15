[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $PSScriptRoot "stable-diffusion-webui")
)

$ErrorActionPreference = "Stop"
$repoUrl = "https://github.com/AUTOMATIC1111/stable-diffusion-webui.git"
$storageModels = Join-Path $PSScriptRoot "storage-models\models"
$storageWebui = Join-Path $PSScriptRoot "storage-webui"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required. Install Git, then run this script again."
}

$python310 = Get-Command py -ErrorAction SilentlyContinue
if (-not $python310) {
    throw "Python Launcher (py) is required. Install Python 3.10.6, then run this script again."
}

$pythonVersion = & py -3.10 --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.10 is required by the upstream WebUI. Detected: $pythonVersion"
}

if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "Stable Diffusion WebUI already exists at $InstallDir"
} elseif (Test-Path $InstallDir) {
    throw "$InstallDir exists but is not a Git checkout. Choose another -InstallDir or remove the incomplete directory."
} else {
    git clone $repoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) {
        throw "The upstream repository could not be cloned."
    }
}

$directories = @(
    (Join-Path $storageModels "Stable-diffusion"),
    (Join-Path $storageModels "Lora"),
    (Join-Path $storageModels "VAE"),
    (Join-Path $storageWebui "embeddings"),
    (Join-Path $PSScriptRoot "training\output")
)

foreach ($directory in $directories) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

Write-Host "Ready. Run .\run-stable-diffusion-webui.ps1 to create the WebUI environment and start the local API."
