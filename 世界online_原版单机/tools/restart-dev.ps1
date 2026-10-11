$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8776 -State Listen -ErrorAction SilentlyContinue
if($listener){
  $ownedProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if($ownedProcess.Name -ne 'node.exe' -or $ownedProcess.CommandLine -notmatch 'server\.mjs'){throw 'Port 8776 belongs to another process.'}
  Stop-Process -Id $ownedProcess.ProcessId
}
$env:WORLDOL_PORT='8776'
$env:WORLDOL_SAVES=Join-Path $projectRoot 'test-saves'
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectRoot 'dev.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'dev.stderr.log') | Select-Object Id
