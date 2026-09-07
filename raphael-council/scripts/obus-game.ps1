param(
    [ValidateSet('start', 'stop', 'status')][string]$Action = 'status',
    [string]$ObusRoot = (Join-Path $env:USERPROFILE 'Documents\obus-moa-exe'),
    [string]$Python = (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64\python.exe')
)
$ErrorActionPreference = 'Stop'
$taskStateDir = Join-Path $env:LOCALAPPDATA 'Raphael\host'
$taskReceiptPath = Join-Path $taskStateDir 'obus-game-process.json'
$taskTokenPath = if ($env:RAPHAEL_OBUS_TOKEN_FILE) { $env:RAPHAEL_OBUS_TOKEN_FILE } else { Join-Path $env:USERPROFILE '.occultbus\game-agent\service-token' }
$taskEndpoint = 'http://127.0.0.1:38175/api/game/capabilities'

function Get-GameAgent {
    if (-not (Test-Path -LiteralPath $taskTokenPath)) { return $null }
    $taskToken = (Get-Content -LiteralPath $taskTokenPath -Raw).Trim()
    if ($taskToken -notmatch '^[a-f0-9]{64}$') { return $null }
    try {
        $taskCapabilities = Invoke-RestMethod -Uri $taskEndpoint -Headers @{ 'X-Obus-Game-Token' = $taskToken } -TimeoutSec 3
        if ($taskCapabilities.contract -eq 'raph-obus-game-v1') { return $taskCapabilities }
    } catch { return $null }
    return $null
}

function Get-OwnedProcess {
    if (-not (Test-Path -LiteralPath $taskReceiptPath)) { return $null }
    $taskReceipt = Get-Content -LiteralPath $taskReceiptPath -Raw | ConvertFrom-Json
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$taskReceipt.processId)" -ErrorAction SilentlyContinue
    if ($taskProcess -and $taskProcess.CommandLine -match 'uvicorn backend\.game_agent:app' -and
        $taskProcess.CreationDate.ToUniversalTime().Ticks -eq ([datetime]$taskReceipt.createdAt).ToUniversalTime().Ticks) {
        return $taskProcess
    }
    return $null
}

$taskMutex = [System.Threading.Mutex]::new($false, 'Local\RaphaelObusGameHost')
$taskLocked = $false
try {
    $taskLocked = $taskMutex.WaitOne(10000)
    if (-not $taskLocked) { throw 'Another Obus game host operation is running.' }
    $taskReady = Get-GameAgent
    $taskOwned = Get-OwnedProcess
    if ($Action -eq 'status') {
        @{ ready = [bool]$taskReady; managed = [bool]$taskOwned; endpoint = $taskEndpoint; codexAvailable = [bool]$taskReady.codex_available; freeRoutesAvailable = [bool]$taskReady.remote_routes } | ConvertTo-Json
    } elseif ($Action -eq 'stop') {
        if ($taskOwned) {
            Stop-Process -Id $taskOwned.ProcessId -ErrorAction Stop
            Remove-Item -LiteralPath $taskReceiptPath -Force
            'Stopped the managed Obus game agent. The main Obus runtime remains running.'
        } elseif ($taskReady) {
            'Obus game agent is running outside this host command; it was left running.'
        } else { 'No managed Obus game agent is running.' }
    } elseif ($taskReady) {
        'Reusing the healthy Obus game agent on port 38175.'
    } else {
        if ($taskOwned) { throw 'The managed game agent is starting or unhealthy. Check its logs before restarting.' }
        if (-not (Test-Path -LiteralPath (Join-Path $ObusRoot 'backend\game_agent.py'))) { throw 'Obus game_agent.py was not found. Set -ObusRoot to the Obus checkout.' }
        if (-not (Test-Path -LiteralPath $Python)) { throw 'Python was not found. Set -Python to the Obus Python executable.' }
        if (Get-NetTCPConnection -State Listen -LocalPort 38175 -ErrorAction SilentlyContinue) { throw 'Port 38175 is occupied. The existing service was left running.' }
        New-Item -ItemType Directory -Path $taskStateDir -Force | Out-Null
        $taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $taskProcess = Start-Process -FilePath $Python -ArgumentList '-m uvicorn backend.game_agent:app --host 127.0.0.1 --port 38175' -WorkingDirectory $ObusRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskStateDir "$taskStamp-obus-game-out.log") -RedirectStandardError (Join-Path $taskStateDir "$taskStamp-obus-game-err.log")
        $taskRecord = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskProcess.Id)"
        @{ processId = $taskProcess.Id; createdAt = $taskRecord.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $taskReceiptPath -Encoding UTF8
        for ($taskAttempt = 0; $taskAttempt -lt 15; $taskAttempt++) {
            if (Get-GameAgent) { 'Started the private Obus game agent on port 38175.'; return }
            $taskProcess.Refresh()
            if ($taskProcess.HasExited) { throw "Obus game agent exited. Check logs in $taskStateDir." }
            Start-Sleep -Milliseconds 500
        }
        throw "Obus game agent is still starting or unhealthy. Check logs in $taskStateDir."
    }
} finally {
    if ($taskLocked) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
