$ErrorActionPreference='Stop'
$featureRoot=Split-Path -Parent $PSScriptRoot
$state=$null
try{$state=Invoke-RestMethod 'http://127.0.0.1:8778/api/status' -TimeoutSec 2}catch{}
if($state){
  if($state.projectRoot -ne $featureRoot -or $state.port -ne 8778){throw 'Feature port belongs to another project.'}
  $control=Get-Content -LiteralPath (Join-Path $featureRoot 'logs\feature\control.json') -Raw | ConvertFrom-Json
  if($control.pid -ne $state.pid -or $control.projectRoot -ne $featureRoot){throw 'Feature control mismatch.'}
  Invoke-RestMethod 'http://127.0.0.1:8778/api/shutdown' -Method Post -Headers @{'X-Worldol-Control'=$control.token} | Out-Null
  for($i=0;$i -lt 40;$i++){if(-not(Get-Process -Id $state.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
}
$env:WORLDOL_PORT='8778'
$env:WORLDOL_SAVES=Join-Path $featureRoot 'feature-saves'
$env:WORLDOL_LOGS=Join-Path $featureRoot 'logs\feature'
Start-Process -FilePath (Join-Path $featureRoot 'runtime\node.exe') -ArgumentList ('"'+(Join-Path $featureRoot 'server.mjs')+'"') -WorkingDirectory $featureRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $featureRoot 'server-8778.stdout.log') -RedirectStandardError (Join-Path $featureRoot 'server-8778.stderr.log') | Out-Null
