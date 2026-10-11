param([ValidateSet(8775,8776,8778,8779)][int]$Port=8775)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'launcher-common.ps1')
$launchProfile=Get-WorldolLaunchProfile $Port
$controlFile=Join-Path (Join-Path $PSScriptRoot $launchProfile.LogFolder) 'control.json'
$owned=Get-WorldolOwnedService $PSScriptRoot $controlFile
if(-not $owned){Write-Host 'No verified service for this copy and save profile. Nothing stopped.';exit}
Invoke-RestMethod ($owned.Url+'/api/shutdown') -Method Post -Headers @{'X-Worldol-Control'=$owned.Control.token} | Out-Null
Write-Host ('Local service stopped: '+$owned.Url+'. Saves retained.')
