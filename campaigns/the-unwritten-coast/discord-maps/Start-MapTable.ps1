$ErrorActionPreference = 'Stop'
$mapRoot = $PSScriptRoot
$mapUrl = 'http://127.0.0.1:51931/'
$mapReady = $false
try {
    $health = Invoke-RestMethod -Uri ($mapUrl + 'health') -TimeoutSec 2
    if ($health.app -ne 'unwritten-coast-layered-atlas') { throw 'Port 51931 is in use by another app.' }
    $mapReady = $true
} catch {
    if ($_.Exception.Message -like '*another app*') { throw }
}
if (-not $mapReady) {
    $nodeRuntime = (Get-Command node -ErrorAction Stop).Source
    $serverFile = Join-Path $mapRoot 'server.mjs'
    Start-Process -FilePath $nodeRuntime -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $mapRoot -WindowStyle Hidden | Out-Null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $health = Invoke-RestMethod -Uri ($mapUrl + 'health') -TimeoutSec 1; if ($health.app -eq 'unwritten-coast-layered-atlas') { $mapReady = $true; break } } catch { }
    }
}
if (-not $mapReady) { throw 'The map table could not start. Run node server.mjs from this folder to see the error.' }
Start-Process $mapUrl
