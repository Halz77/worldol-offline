$ErrorActionPreference='Stop'
$catalogRoot=Split-Path -Parent $PSScriptRoot
if($catalogRoot -ne 'F:\世界OL项目\世界online_原版单机'){throw 'Unexpected project root'}
$catalogVersion=(Get-Content -LiteralPath (Join-Path $catalogRoot 'package.json') -Raw | ConvertFrom-Json).version
$backupRoot=Join-Path $catalogRoot ('backups\catalog_saves_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
if(Test-Path -LiteralPath $backupRoot){throw 'Backup already exists'}
New-Item -ItemType Directory -Path $backupRoot | Out-Null
$folders=@{8775='saves';8776='test-saves';8778='feature-saves';8779='qa-v05-saves'}
$services=@()
foreach($port in 8775,8776,8778,8779){
 $url="http://127.0.0.1:$port"
 $before=Invoke-RestMethod "$url/api/status" -TimeoutSec 3
 $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($before.pid)"
 $listeners=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop
 if($before.projectRoot -ne $catalogRoot -or $before.port -ne $port -or $owner.ExecutablePath -ne (Join-Path $catalogRoot 'runtime\node.exe') -or $owner.CommandLine -notlike ('*'+(Join-Path $catalogRoot 'server.mjs')+'*') -or ($listeners.OwningProcess | Where-Object {$_ -ne $before.pid})){throw "Owner mismatch on $port"}
 & (Join-Path $catalogRoot 'stop.ps1') -Port $port
 for($attempt=0;$attempt -lt 40;$attempt++){
  if(-not(Get-Process -Id $before.pid -ErrorAction SilentlyContinue)){break}
  Start-Sleep -Milliseconds 100
 }
 if($attempt -eq 40){throw "Shutdown timed out on $port"}
 $source=Join-Path $catalogRoot $folders[$port]
 $backup=Join-Path $backupRoot $folders[$port]
 Copy-Item -LiteralPath $source -Destination $backup -Recurse
 $saveFile=Join-Path $source 'world.json'
 $saveHash=(Get-FileHash -LiteralPath $saveFile -Algorithm SHA256).Hash
 & (Join-Path $catalogRoot 'start.ps1') -NoBrowser -Port $port
 $after=Invoke-RestMethod "$url/api/status" -TimeoutSec 3
 $library=Invoke-RestMethod "$url/api/content-library" -TimeoutSec 8
 $newHash=(Get-FileHash -LiteralPath $saveFile -Algorithm SHA256).Hash
 if($after.version -ne $catalogVersion -or $after.projectRoot -ne $catalogRoot -or $after.pid -eq $before.pid -or $newHash -ne $saveHash -or -not $library.counts.equipmentDetails){throw "Deployment or save verification failed on $port"}
 $services+=[pscustomobject]@{port=$port;version=$after.version;beforePid=$before.pid;pid=$after.pid;characters=$after.characters.Count;saveFolder=$folders[$port];saveSHA256=$saveHash;saveUnchanged=$true;counts=$library.counts}
}
$report=[pscustomobject]@{time=(Get-Date -Format o);version=$catalogVersion;backup=$backupRoot;services=$services}
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $catalogRoot 'analysis\catalog-deployment.json') -Encoding utf8
$services | Format-Table port,version,pid,characters,saveUnchanged
Write-Output $backupRoot
