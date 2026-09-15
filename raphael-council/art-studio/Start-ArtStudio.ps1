[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ($studioRoot -match '(?i)[\\/]OneDrive[\\/]') { throw 'Run the local project copy under C:\Users\Hermes\Projects.' }
$studioUrl = 'http://127.0.0.1:51960'
$studioState = $null
try { $studioState = Invoke-RestMethod "$studioUrl/api/state" -TimeoutSec 3 } catch {}
if (-not $studioState) {
    $studioNode = (Get-Command node -ErrorAction Stop).Source
    $studioPython = Join-Path $studioRoot '.runtime\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $studioPython)) { throw 'The renderer environment is missing. Follow the setup instructions in this folder\README.md.' }
    $studioData = Join-Path $studioRoot 'data'
    New-Item -ItemType Directory -Path $studioData -Force | Out-Null
    $studioArgs = '"' + (Join-Path $studioRoot 'server.mjs') + '" --start-engine'
    Start-Process -FilePath $studioNode -ArgumentList $studioArgs -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioData 'studio.log') -RedirectStandardError (Join-Path $studioData 'studio-error.log') | Out-Null
    for ($attempt = 0; $attempt -lt 15 -and -not $studioState; $attempt++) {
        Start-Sleep -Seconds 1
        try { $studioState = Invoke-RestMethod "$studioUrl/api/state" -TimeoutSec 2 } catch {}
    }
    if (-not $studioState) { throw 'The studio did not start. See data\studio-error.log.' }
}
if (-not $studioState.engine.online -and -not $studioState.engine.starting) {
    Invoke-RestMethod "$studioUrl/api/engine/start" -Method Post -ContentType 'application/json' -Body '{}' -Headers @{ Origin = $studioUrl; 'X-Studio-Capability' = $studioState.capability } -TimeoutSec 20 | Out-Null
}
Write-Host "Campaign art studio: $studioUrl/"
Write-Host 'Game table: http://127.0.0.1:51950/ (choose Illustrate this scene)'
Write-Host 'Node editor: http://127.0.0.1:8188/'
Write-Host 'The renderer may need a moment to finish starting. The studio shows its status.'
