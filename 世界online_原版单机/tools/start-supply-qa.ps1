$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(Get-NetTCPConnection -LocalPort 8781 -State Listen -ErrorAction SilentlyContinue){throw 'QA port is occupied'}
$env:WORLDOL_PORT='8781'
$env:WORLDOL_SAVES=Join-Path $projectRoot 'supply-qa-saves'
$env:WORLDOL_LOGS=Join-Path $projectRoot 'logs\supply-qa'
$entry=Join-Path $projectRoot 'server.mjs'
Start-Process -FilePath (Join-Path $projectRoot 'runtime\node.exe') -ArgumentList ('"'+$entry+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'supply-qa.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'supply-qa.stderr.log') -PassThru | Select-Object Id,Path
