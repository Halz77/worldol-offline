$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(Get-NetTCPConnection -LocalPort 8781 -State Listen -ErrorAction SilentlyContinue){throw 'QA port is occupied'}
$env:WORLDOL_PORT='8781'
$env:WORLDOL_SAVES=Join-Path $projectRoot 'equipment-qa-saves'
$env:WORLDOL_LOGS=Join-Path $projectRoot 'logs\equipment-qa'
$entry=Join-Path $projectRoot 'server.mjs'
Start-Process -FilePath (Join-Path $projectRoot 'runtime\node.exe') -ArgumentList ('"'+$entry+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'equipment-qa.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'equipment-qa.stderr.log') -PassThru | Select-Object Id,Path
