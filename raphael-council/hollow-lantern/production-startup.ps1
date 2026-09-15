[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Descriptor,
  [Parameter(Mandatory)][string]$Engine,
  [Parameter(Mandatory)][string]$OutputRoot,
  [Parameter(Mandatory)][string]$DavyRoot,
  [Parameter(Mandatory)][string]$Node,
  [switch]$Install
)
$ErrorActionPreference = 'Stop'
function Confirm-LocalPath([string]$Value) {
  if ($Value -match '(^[\\/]{2}|["\r\n]|[\\/]OneDrive([\\/]| - ))' -or -not [IO.Path]::IsPathRooted($Value)) { throw 'Canonical local paths are required.' }
  $resolved = (Resolve-Path -LiteralPath $Value).ProviderPath
  if ($resolved -match '[\\/]OneDrive([\\/]| - )') { throw 'OneDrive paths are not allowed.' }
  return $resolved
}
$descriptorPath=Confirm-LocalPath $Descriptor
$enginePath=Confirm-LocalPath $Engine
$outputPath=Confirm-LocalPath $OutputRoot
$davyPath=Confirm-LocalPath $DavyRoot
$nodePath=Confirm-LocalPath $Node
$launcher=Join-Path $PSScriptRoot 'production-launch.mjs'
$legacy=Get-CimInstance Win32_Service -Filter "Name='DavyJonesGateway'"
if ($legacy -and ($legacy.StartMode -eq 'Auto' -or $legacy.State -eq 'Running')) { throw 'The legacy automatic Davy gateway must be reconciled with the production owner before installing startup.' }
& $nodePath $launcher --check --descriptor $descriptorPath --engine $enginePath --output-root $outputPath --davy-root $davyPath
if ($LASTEXITCODE -ne 0) { throw 'Production preflight failed. No startup task was installed.' }
if (-not $Install) { Write-Output 'Preflight passed. Startup task remains unchanged.'; return }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$taskName='OPS-DnD-Production'
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne 'Owned OPS DnD runtime after sign-in; requires verified private Obus game worker.') { throw 'The existing task has not been identified as this production supervisor; it was preserved.' }
if ($existing -and $existing.Principal.UserId -notin @($identity.Name,$identity.User.Value)) { throw 'An existing task belongs to another identity; it was preserved.' }
$arguments='"{0}" --start --descriptor "{1}" --engine "{2}" --output-root "{3}" --davy-root "{4}"' -f $launcher,$descriptorPath,$enginePath,$outputPath,$davyPath
$action=New-ScheduledTaskAction -Execute $nodePath -Argument $arguments -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal=New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Owned OPS DnD runtime after sign-in; requires verified private Obus game worker.' -Force | Out-Null
Write-Output 'Startup task installed for the current user. It has not been started.'
