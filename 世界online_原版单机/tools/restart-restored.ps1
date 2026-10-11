param([ValidateSet(8775,8776,8778)][int[]]$Ports=@(8775,8776,8778))
$ErrorActionPreference='Stop'
$restoredRoot=Split-Path -Parent $PSScriptRoot
$entry=Join-Path $restoredRoot 'server.mjs'
$runtime=Join-Path $restoredRoot 'runtime\node.exe'
$backup=Join-Path $restoredRoot ('backups\deploy_v03_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
$owned=@()
foreach($port in $Ports){
 $state=$null
 try{$state=Invoke-RestMethod "http://127.0.0.1:$port/api/status" -TimeoutSec 2}catch{}
 $listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue
 if($listener -and -not $state){throw "Port $port has an unrecognized listener."}
 if($state){
  if($state.projectRoot -ne $restoredRoot -or $state.project -ne 'worldonline-original-offline' -or $state.port -ne $port){throw "Port $port belongs to another service."}
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.pid)"
  if($proc.ExecutablePath -ne $runtime -or $proc.CommandLine -notmatch [regex]::Escape($entry) -or $listener.OwningProcess -ne $state.pid){throw "Process ownership mismatch on $port."}
  $logFolder=switch($port){8775 {'logs'} 8776 {'logs\test'} 8778 {'logs\feature'}}
  $control=Get-Content -LiteralPath (Join-Path $restoredRoot "$logFolder\control.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  if($control.pid -ne $state.pid -or $control.projectRoot -ne $restoredRoot -or $control.port -ne $port){throw "Control ownership mismatch on $port."}
  $owned+=@{port=$port;state=$state;control=$control}
 }
}
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($service in $owned){
 Invoke-RestMethod "http://127.0.0.1:$($service.port)/api/shutdown" -Method Post -Headers @{'X-Worldol-Control'=$service.control.token} | Out-Null
 for($attempt=0;$attempt -lt 50;$attempt++){if(-not(Get-Process -Id $service.state.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
 if(Get-Process -Id $service.state.pid -ErrorAction SilentlyContinue){throw "Service $($service.port) did not stop; no process was killed."}
}
foreach($folder in @('saves','test-saves','feature-saves')){
 $source=Join-Path $restoredRoot $folder
 if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination $backup -Recurse}
}
foreach($port in $Ports){
 if($port -eq 8778){& (Join-Path $PSScriptRoot 'restart-feature.ps1')}
 else{& (Join-Path $restoredRoot 'start.ps1') -NoBrowser -Port $port}
}
$result=@()
foreach($port in $Ports){
 $state=$null
 for($attempt=0;$attempt -lt 30;$attempt++){try{$state=Invoke-RestMethod "http://127.0.0.1:$port/api/status" -TimeoutSec 1;break}catch{Start-Sleep -Milliseconds 100}}
 if(-not $state -or $state.projectRoot -ne $restoredRoot -or $state.version -ne '0.3.0'){throw "Updated service $port failed its identity/version check."}
 $result+=@{port=$port;pid=$state.pid;version=$state.version;characters=$state.characters}
}
@{backup=$backup;updatedAt=(Get-Date -Format o);services=$result} | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $restoredRoot 'logs\deployment-v03.json') -Encoding utf8
Write-Output "Backup: $backup"
$result | ForEach-Object {[pscustomobject]@{port=$_.port;pid=$_.pid;version=$_.version;roles=$_.characters.Count}} | Format-Table
