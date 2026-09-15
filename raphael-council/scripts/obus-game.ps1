param(
    [ValidateSet('start', 'stop', 'status')][string]$Action = 'status',
    [string]$ObusRoot = (Join-Path $env:USERPROFILE 'Documents\obus-moa-exe'),
    [string]$Python = (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64\python.exe'),
    [string]$Endpoint,
    [string]$TokenFile
)
$ErrorActionPreference = 'Stop'

# Read only these two literal settings. Never source .env.local or interpolate it.
$taskSettings = @{}
$taskEnvFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.local'
if (Test-Path -LiteralPath $taskEnvFile) {
    foreach ($taskLine in Get-Content -LiteralPath $taskEnvFile) {
        if ($taskLine -notmatch '^\s*(?:export\s+)?(RAPHAEL_OBUS_URL|RAPHAEL_OBUS_TOKEN_FILE)\s*=\s*(.*?)\s*$') { continue }
        $taskKey = $Matches[1]
        if (($taskKey -eq 'RAPHAEL_OBUS_URL' -and ($PSBoundParameters.ContainsKey('Endpoint') -or $null -ne $env:RAPHAEL_OBUS_URL)) -or
            ($taskKey -eq 'RAPHAEL_OBUS_TOKEN_FILE' -and ($PSBoundParameters.ContainsKey('TokenFile') -or $null -ne $env:RAPHAEL_OBUS_TOKEN_FILE))) { continue }
        $taskValue = $Matches[2]
        if ($taskValue.StartsWith('"')) {
            if ($taskValue -notmatch '^"([^"]*)"\s*(?:#.*)?$') { throw 'Invalid quoted Obus host setting in .env.local.' }
            $taskValue = $Matches[1]
        } elseif ($taskValue.StartsWith("'")) {
            if ($taskValue -notmatch "^'([^']*)'\s*(?:#.*)?$") { throw 'Invalid quoted Obus host setting in .env.local.' }
            $taskValue = $Matches[1]
        } else {
            $taskValue = ($taskValue -replace '\s+#.*$', '').Trim()
        }
        $taskSettings[$taskKey] = $taskValue
    }
}
if (-not $PSBoundParameters.ContainsKey('Endpoint')) {
    $Endpoint = if ($null -ne $env:RAPHAEL_OBUS_URL) { $env:RAPHAEL_OBUS_URL }
        elseif ($taskSettings.ContainsKey('RAPHAEL_OBUS_URL')) { $taskSettings.RAPHAEL_OBUS_URL }
        else { 'http://127.0.0.1:38175' }
}
# Validate the original string before URI normalization can discard unsafe parts.
if ($Endpoint -notmatch '\Ahttp://(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})/?\z') {
    throw 'Obus endpoint must be an HTTP loopback URL with an explicit port and no credentials, path, query or fragment.'
}
$taskPort = [int]$Matches[2]
if ($taskPort -gt 65535) { throw 'Obus endpoint port must be between 1 and 65535.' }
$taskBaseUrl = "http://127.0.0.1:$taskPort"
$taskEndpoint = "$taskBaseUrl/api/game/capabilities"
$taskStateDir = Join-Path $env:LOCALAPPDATA 'Raphael\host'
$taskReceiptPath = Join-Path $taskStateDir 'obus-game-process.json'
$taskDataRoot = if ($env:OBUS_GAME_DATA_DIR) { $env:OBUS_GAME_DATA_DIR } else { Join-Path $env:USERPROFILE '.occultbus\game-agent' }
$taskBackendTokenPath = [IO.Path]::GetFullPath((Join-Path $taskDataRoot 'service-token'))
if (-not $PSBoundParameters.ContainsKey('TokenFile')) {
    $TokenFile = if ($null -ne $env:RAPHAEL_OBUS_TOKEN_FILE) { $env:RAPHAEL_OBUS_TOKEN_FILE }
        elseif ($taskSettings.ContainsKey('RAPHAEL_OBUS_TOKEN_FILE')) { $taskSettings.RAPHAEL_OBUS_TOKEN_FILE }
        else { $taskBackendTokenPath }
}
if ([string]::IsNullOrWhiteSpace($TokenFile)) { throw 'Obus token-file setting must name a file.' }
$taskTokenPath = [IO.Path]::GetFullPath($TokenFile)
$taskObusRoot = [IO.Path]::GetFullPath($ObusRoot)
$taskPython = [IO.Path]::GetFullPath($Python)
$taskArguments = "-m uvicorn backend.game_agent:app --host 127.0.0.1 --port $taskPort"

function Get-GameAgent {
    try {
        if (-not (Test-Path -LiteralPath $taskTokenPath)) { return $null }
        $taskToken = (Get-Content -LiteralPath $taskTokenPath -Raw).Trim()
        if ($taskToken -notmatch '^[a-f0-9]{64}$') { return $null }
        $taskCapabilities = Invoke-RestMethod -Uri $taskEndpoint -Headers @{ 'X-Obus-Game-Token' = $taskToken } -TimeoutSec 3 -MaximumRedirection 0
        if ($taskCapabilities.contract -eq 'raph-obus-game-v1') { return $taskCapabilities }
    } catch { return $null }
    return $null
}

function Get-OwnedProcess {
    try {
        if (-not (Test-Path -LiteralPath $taskReceiptPath)) { return $null }
        $taskReceipt = Get-Content -LiteralPath $taskReceiptPath -Raw | ConvertFrom-Json
        if ($taskReceipt.schema -ne 'raphael-obus-game-process-v2' -or $taskReceipt.endpoint -cne $taskBaseUrl -or
            $taskReceipt.obusRoot -ine $taskObusRoot -or $taskReceipt.python -ine $taskPython) { return $null }
        $taskProcessId = 0
        if (-not [int]::TryParse([string]$taskReceipt.processId, [ref]$taskProcessId) -or $taskProcessId -le 0) { return $null }
        $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId" -ErrorAction SilentlyContinue
        if ($taskProcess -and $taskProcess.ExecutablePath -ieq $taskPython -and
            $taskProcess.CommandLine -match ('\s' + [regex]::Escape($taskArguments) + '$') -and
            $taskProcess.CreationDate.ToUniversalTime().Ticks -eq ([datetime]$taskReceipt.createdAt).ToUniversalTime().Ticks) {
            return $taskProcess
        }
    } catch { return $null }
    return $null
}

# Serialize configuration changes too: an old receipt is never overwritten while
# another game-agent process exists, even if the selected port has changed.
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
            "Stopped the managed Obus game agent on port $taskPort. The main Obus runtime remains running."
        } elseif ($taskReady) {
            'Obus game agent is running outside this host command; it was left running.'
        } else { 'No managed Obus game agent is running.' }
    } elseif ($taskReady) {
        "Reusing the healthy Obus game agent on port $taskPort."
    } else {
        if ($taskOwned) { throw 'The managed game agent is starting or unhealthy. Check its logs before restarting.' }
        if ($taskTokenPath -ine $taskBackendTokenPath) { throw 'The configured health token file does not match the backend data directory service-token. Keep the data directory unchanged and use its token file.' }
        if (-not (Test-Path -LiteralPath (Join-Path $taskObusRoot 'backend\game_agent.py'))) { throw 'Obus game_agent.py was not found. Set -ObusRoot to the Obus checkout.' }
        if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Python was not found. Set -Python to the Obus Python executable.' }
        if (Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue) { throw "Port $taskPort is occupied. The existing service was left running." }
        if (Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%backend.game_agent:app%'" -ErrorAction Stop) {
            throw 'An existing Obus game-agent process was left running. Resolve its endpoint or health before starting another.'
        }
        New-Item -ItemType Directory -Path $taskStateDir -Force | Out-Null
        $taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $taskProcess = Start-Process -FilePath $taskPython -ArgumentList $taskArguments -WorkingDirectory $taskObusRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskStateDir "$taskStamp-obus-game-out.log") -RedirectStandardError (Join-Path $taskStateDir "$taskStamp-obus-game-err.log")
        $taskRecord = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskProcess.Id)"
        @{ schema = 'raphael-obus-game-process-v2'; processId = $taskProcess.Id; createdAt = $taskRecord.CreationDate.ToUniversalTime().ToString('o'); endpoint = $taskBaseUrl; obusRoot = $taskObusRoot; python = $taskPython } | ConvertTo-Json | Set-Content -LiteralPath $taskReceiptPath -Encoding UTF8
        for ($taskAttempt = 0; $taskAttempt -lt 15; $taskAttempt++) {
            if (Get-GameAgent) { "Started the private Obus game agent on port $taskPort."; return }
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
