param(
 [Parameter(Mandatory=$true)][string]$Source,
 [Parameter(Mandatory=$true)][string]$ExpectedSourceSHA,
 [string]$Account='xia-v05-qa'
)
$ErrorActionPreference='Stop'
$importRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$importNode=Join-Path $importRoot 'runtime\node.exe'
$importEntry=Join-Path $importRoot 'server.mjs'
$importSave=Join-Path $importRoot 'qa-v05-saves\world.json'
$importLogs=Join-Path $importRoot 'logs\qa-v05'
$importUrl='http://127.0.0.1:8779'
if((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -ne $ExpectedSourceSHA){throw 'Source export changed after validation.'}
$importStatus=Invoke-RestMethod ($importUrl+'/api/status') -TimeoutSec 5
if($importStatus.project -ne 'worldonline-original-offline' -or $importStatus.projectRoot -ne $importRoot -or $importStatus.port -ne 8779){throw 'Service identity mismatch.'}
$importProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$importStatus.pid)
if($importProcess.ExecutablePath -ne $importNode -or -not $importProcess.CommandLine.Contains('"'+$importEntry+'"')){throw 'Process identity mismatch.'}
$importListener=Get-NetTCPConnection -LocalPort 8779 -State Listen
if($importListener.LocalAddress -ne '127.0.0.1' -or $importListener.OwningProcess -ne $importStatus.pid){throw 'Listener identity mismatch.'}
$importControl=Get-Content -LiteralPath (Join-Path $importLogs 'control.json') -Raw | ConvertFrom-Json
if($importControl.pid -ne $importStatus.pid -or $importControl.projectRoot -ne $importRoot -or $importControl.port -ne 8779){throw 'Control identity mismatch.'}
$importOutput=Join-Path $importRoot ('backups\character-import-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$importPreview=Join-Path $importRoot 'analysis\character-import-100377202-preview'
& $importNode (Join-Path $importRoot 'tools\import-character-export.mjs') --source $Source --save $importSave --account $Account --out $importPreview --expected-source-sha $ExpectedSourceSHA | Out-Null
if($LASTEXITCODE -ne 0){throw 'Preflight import validation failed; running service retained.'}
Invoke-RestMethod ($importUrl+'/api/shutdown') -Method Post -Headers @{'X-Worldol-Control'=$importControl.token} | Out-Null
for($n=0;$n -lt 60;$n++){if(-not(Get-Process -Id $importStatus.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
if(Get-Process -Id $importStatus.pid -ErrorAction SilentlyContinue){throw 'Service did not shut down; no save was written.'}
$importApplied=$false
try{
 $importBeforeHash=(Get-FileHash -LiteralPath $importSave -Algorithm SHA256).Hash
 & $importNode (Join-Path $importRoot 'tools\import-character-export.mjs') --source $Source --save $importSave --account $Account --out $importOutput --expected-source-sha $ExpectedSourceSHA --apply --expected-sha $importBeforeHash | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Import was rejected; retained save will be restarted.'}
 $importApplied=$true
}finally{
 $env:WORLDOL_PORT='8779'
 $env:WORLDOL_SAVES=Join-Path $importRoot 'qa-v05-saves'
 $env:WORLDOL_LOGS=$importLogs
 $importStarted=Start-Process -FilePath $importNode -ArgumentList ('"'+$importEntry+'"') -WorkingDirectory $importRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $importRoot 'analysis\character-import-runtime.stdout.log') -RedirectStandardError (Join-Path $importRoot 'analysis\character-import-runtime.stderr.log') -PassThru
}
$importAfter=$null
for($n=0;$n -lt 50;$n++){try{$importAfter=Invoke-RestMethod ($importUrl+'/api/status') -TimeoutSec 1;if($importAfter.pid -eq $importStarted.Id){break}}catch{};Start-Sleep -Milliseconds 150}
if(-not $importAfter -or $importAfter.pid -ne $importStarted.Id -or $importAfter.projectRoot -ne $importRoot){throw 'Restart verification failed; original save is in import output.'}
if($importApplied){
 $importReport=Get-Content -LiteralPath (Join-Path $importOutput 'report.json') -Raw | ConvertFrom-Json
 $importActual=$importAfter.characters | Where-Object {$_.id -eq $importReport.roleId}
 if(-not $importActual -or $importActual.name -ne $importReport.name){throw 'Imported role was not loaded.'}
 $importReceipt=[ordered]@{applied=$true;oldPid=$importStatus.pid;pid=$importStarted.Id;url=$importUrl+'/?save='+$Account;roleId=$importActual.id;name=$importActual.name;level=$importActual.level;backup=$importOutput;report=(Join-Path $importOutput 'report.json');saveSHA256=(Get-FileHash -LiteralPath $importSave -Algorithm SHA256).Hash;characters=@($importAfter.characters | Select-Object id,name,level,accountId)}
 $importReceipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $importRoot 'analysis\character-import-deployment.json') -Encoding utf8
 $importReceipt | ConvertTo-Json -Depth 5
}
