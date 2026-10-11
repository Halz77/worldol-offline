$ErrorActionPreference='Stop'
$qaProjectRoot=Split-Path -Parent $PSScriptRoot
if(Get-NetTCPConnection -LocalPort 8782 -State Listen -ErrorAction SilentlyContinue){throw 'QA port is occupied'}
$env:WORLDOL_PORT='8782'
$env:WORLDOL_SAVES=Join-Path $qaProjectRoot 'recordings-qa-saves-20260921'
$env:WORLDOL_LOGS=Join-Path $qaProjectRoot 'logs\recordings-qa'
$qaEntry=Join-Path $qaProjectRoot 'server.mjs'
if(-not(Test-Path -LiteralPath (Join-Path $env:WORLDOL_SAVES 'world.json'))){throw 'QA save is missing'}
Start-Process -FilePath (Join-Path $qaProjectRoot 'runtime\node.exe') -ArgumentList ('"'+$qaEntry+'"') -WorkingDirectory $qaProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $qaProjectRoot 'analysis\recordings-qa.stdout.log') -RedirectStandardError (Join-Path $qaProjectRoot 'analysis\recordings-qa.stderr.log') -PassThru | Select-Object Id,Path
