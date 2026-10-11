param([ValidateSet(8779,8782,8783)][int]$Port=8779,[switch]$GrantStrengthLoadout,[switch]$GrantObservedPumpkin,[switch]$GrantBloodMistBook)
$ErrorActionPreference='Stop'
if($GrantStrengthLoadout -and $Port -ne 8779){throw 'Strength grant is restricted to the main local account service.'}
if($GrantObservedPumpkin -and $Port -ne 8779){throw 'Captured pet grant is restricted to the main local account service.'}
if($GrantBloodMistBook -and $Port -ne 8779){throw 'Skill book grant is restricted to the main local account service.'}
if(([int][bool]$GrantStrengthLoadout+[int][bool]$GrantObservedPumpkin+[int][bool]$GrantBloodMistBook) -gt 1){throw 'Run only one save grant per restart.'}
$restoreRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$restoreSaveName=if($Port -eq 8779){'qa-v05-saves'}elseif($Port -eq 8783){'analysis\city-character-qa\saves'}else{'recordings-qa-saves-20260921'}
$restoreLogName=if($Port -eq 8779){'qa-v05'}else{'recordings-qa'}
$restoreSave=Join-Path $restoreRoot ($restoreSaveName+'\world.json')
$restoreLogs=Join-Path $restoreRoot ('logs\'+$restoreLogName)
if($Port -eq 8783){$restoreLogs=Join-Path $restoreRoot 'analysis\city-character-qa\logs'}
$restoreNode=Join-Path $restoreRoot 'runtime\node.exe'
$restoreEntry=Join-Path $restoreRoot 'server.mjs'
$restoreUrl='http://127.0.0.1:'+ $Port
$restoreState=Invoke-RestMethod ($restoreUrl+'/api/status') -TimeoutSec 5
if($restoreState.project -ne 'worldonline-original-offline' -or $restoreState.projectRoot -ne $restoreRoot -or $restoreState.port -ne $Port){throw 'The port belongs to a different project.'}
$restoreProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$restoreState.pid)
if($restoreProcess.ExecutablePath -ne $restoreNode -or -not $restoreProcess.CommandLine.Contains('"'+$restoreEntry+'"')){throw 'Executable identity mismatch.'}
$restoreListener=Get-NetTCPConnection -LocalPort $Port -State Listen
if($restoreListener.OwningProcess -ne $restoreState.pid -or $restoreListener.LocalAddress -ne '127.0.0.1'){throw 'Listener identity mismatch.'}
$restoreControl=Get-Content -LiteralPath (Join-Path $restoreLogs 'control.json') -Raw | ConvertFrom-Json
if($restoreControl.pid -ne $restoreState.pid -or $restoreControl.port -ne $Port -or $restoreControl.projectRoot -ne $restoreRoot){throw 'Control identity mismatch.'}
$restoreBefore=Get-Content -LiteralPath $restoreSave -Raw | ConvertFrom-Json
if($Port -eq 8779 -and -not($restoreBefore.characters | Where-Object {$_.id -eq 1001 -and $_.level -eq 97})){throw 'Expected level 97 test role is missing.'}
Invoke-RestMethod ($restoreUrl+'/api/shutdown') -Method Post -Headers @{'X-Worldol-Control'=$restoreControl.token} | Out-Null
for($n=0;$n -lt 60;$n++){if(-not(Get-Process -Id $restoreState.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
if(Get-Process -Id $restoreState.pid -ErrorAction SilentlyContinue){throw 'Old service has not exited; no force termination attempted.'}
$restoreBackup=Join-Path $restoreRoot ('backups\recordings-runtime-'+$Port+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $restoreBackup | Out-Null
Copy-Item -LiteralPath $restoreSave -Destination (Join-Path $restoreBackup 'world.json')
$restoreHash=(Get-FileHash -LiteralPath $restoreSave -Algorithm SHA256).Hash
$restoreOriginalHash=$restoreHash
$strengthGrantExit=0
if($GrantStrengthLoadout){
    & $restoreNode (Join-Path $restoreRoot 'tools\grant-strength-loadout.mjs') --apply --expected-sha $restoreHash
    $strengthGrantExit=$LASTEXITCODE
    $restoreHash=(Get-FileHash -LiteralPath $restoreSave -Algorithm SHA256).Hash
}
$petGrantExit=0
if($GrantObservedPumpkin){
    & $restoreNode (Join-Path $restoreRoot 'tools\grant-observed-pumpkin.mjs') --apply --expected-sha $restoreHash
    $petGrantExit=$LASTEXITCODE
    $restoreHash=(Get-FileHash -LiteralPath $restoreSave -Algorithm SHA256).Hash
}
$bookGrantExit=0
if($GrantBloodMistBook){
    & $restoreNode (Join-Path $restoreRoot 'tools\grant-pet-skill-book.mjs') --apply --expected-sha $restoreHash
    $bookGrantExit=$LASTEXITCODE
    $restoreHash=(Get-FileHash -LiteralPath $restoreSave -Algorithm SHA256).Hash
}
$env:WORLDOL_PORT=[string]$Port
$env:WORLDOL_SAVES=Join-Path $restoreRoot $restoreSaveName
$env:WORLDOL_LOGS=$restoreLogs
$restorePreStart=Join-Path $restoreBackup 'before-start-world.json'
Copy-Item -LiteralPath $restoreSave -Destination $restorePreStart
$restoreStarted=Start-Process -FilePath $restoreNode -ArgumentList ('"'+$restoreEntry+'"') -WorkingDirectory $restoreRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $restoreRoot ('analysis\recordings-'+$Port+'.stdout.log')) -RedirectStandardError (Join-Path $restoreRoot ('analysis\recordings-'+$Port+'.stderr.log')) -PassThru
$restoreAfter=$null
for($n=0;$n -lt 40;$n++){try{$restoreAfter=Invoke-RestMethod ($restoreUrl+'/api/status') -TimeoutSec 1;if($restoreAfter.pid -eq $restoreStarted.Id){break}}catch{};Start-Sleep -Milliseconds 150}
if(-not $restoreAfter -or $restoreAfter.version -ne '0.6.4' -or $restoreAfter.pid -ne $restoreStarted.Id -or $restoreAfter.projectRoot -ne $restoreRoot){throw 'New service failed startup verification.'}
$restoreStartupHash=(Get-FileHash -LiteralPath $restoreSave -Algorithm SHA256).Hash
$restoreStartupUnchanged=$restoreStartupHash -eq $restoreHash
$restoreDailyReset=$null
if(-not $restoreStartupUnchanged){
    $restoreDailyOutput=& $restoreNode (Join-Path $restoreRoot 'tools\verify-daily-reset-startup.mjs') $restorePreStart $restoreSave $restoreAfter.taskResetDay
    if($LASTEXITCODE -ne 0){throw 'Save changed beyond the expected bag expansion and daily task reset; retained backup requires review.'}
    $restoreDailyReset=$restoreDailyOutput | ConvertFrom-Json
    $restoreHash=$restoreStartupHash
}
$restoreReceipt=[ordered]@{port=$Port;version=$restoreAfter.version;oldPid=$restoreState.pid;pid=$restoreAfter.pid;projectRoot=$restoreRoot;save=$restoreSave;beforeSaveSHA256=$restoreOriginalHash;saveSHA256=$restoreHash;backup=$restoreBackup;saveUnchanged=($restoreOriginalHash -eq $restoreHash);saveUnchangedDuringStartup=$restoreStartupUnchanged;dailyTaskReset=$restoreDailyReset;strengthGrantApplied=([bool]$GrantStrengthLoadout -and $strengthGrantExit -eq 0);characters=@($restoreAfter.characters | Select-Object id,name,level,mapId)}
$restoreReceipt['observedPumpkinGranted']=([bool]$GrantObservedPumpkin -and $petGrantExit -eq 0)
$restoreReceipt['bloodMistBookGranted']=([bool]$GrantBloodMistBook -and $bookGrantExit -eq 0)
$restoreReceipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $restoreRoot ('analysis\recordings-deployment-'+$Port+'.json')) -Encoding utf8
$restoreReceipt | ConvertTo-Json -Depth 5
if($strengthGrantExit -ne 0){throw 'Strength grant did not pass validation; service restarted with the retained save.'}
if($petGrantExit -ne 0){throw 'Pet grant did not pass validation; service restarted with the retained save.'}
if($bookGrantExit -ne 0){throw 'Skill book grant did not pass validation; service restarted with the retained save.'}
