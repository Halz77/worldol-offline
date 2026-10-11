$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$state=Invoke-RestMethod 'http://127.0.0.1:8781/api/status' -TimeoutSec 3
if($state.projectRoot -ne $projectRoot -or $state.project -ne 'worldonline-original-offline'){throw 'Wrong QA service'}
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.pid)"
if($process.ExecutablePath -ne (Join-Path $projectRoot 'runtime\node.exe') -or $process.CommandLine -notlike '*server.mjs*'){throw 'Wrong QA process'}
$control=Get-Content -LiteralPath (Join-Path $projectRoot 'logs\supply-qa\control.json') -Raw | ConvertFrom-Json
Invoke-RestMethod 'http://127.0.0.1:8781/api/shutdown' -Method Post -Headers @{'X-Worldol-Control'=$control.token} | Out-Null
Wait-Process -Id $state.pid -Timeout 10 -ErrorAction SilentlyContinue
Write-Output 'Supply QA stopped'
