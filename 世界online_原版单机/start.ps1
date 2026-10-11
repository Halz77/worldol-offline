param([switch]$NoBrowser,[ValidateSet(8775,8776,8778,8779)][int]$Port=8775,[string]$SaveName='')
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
. (Join-Path $projectRoot 'launcher-common.ps1')
$launchProfile=Get-WorldolLaunchProfile $Port
if(-not $SaveName){$SaveName=if($Port -eq 8776){'acceptance'}elseif($Port -eq 8779){'xia-v05-qa'}else{'offline'}}
$controlFile=Join-Path (Join-Path $projectRoot $launchProfile.LogFolder) 'control.json'
$sha=[System.Security.Cryptography.SHA256]::Create()
try{$lockKey=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-','')}finally{$sha.Dispose()}
$mutex=New-Object System.Threading.Mutex($false,('Local\WorldOLLauncher-'+$lockKey))
$locked=$false
$previousEnv=@{WORLDOL_PORT=$env:WORLDOL_PORT;WORLDOL_SAVES=$env:WORLDOL_SAVES;WORLDOL_LOGS=$env:WORLDOL_LOGS}
try {
    try{$locked=$mutex.WaitOne(20000)}catch [System.Threading.AbandonedMutexException]{$locked=$true}
    if(-not $locked){throw 'Another launcher is still starting this copy. Try again shortly.'}
    $owned=Get-WorldolOwnedService $projectRoot $controlFile
    if($owned){$url=$owned.Url}
    else {
        Backup-WorldolSaveBeforeUpdate $projectRoot $launchProfile.SaveFolder
        $node=Join-Path $projectRoot 'runtime\node.exe'
        if(-not(Test-Path -LiteralPath $node)){$node=(Get-Command node -ErrorAction Stop).Source}
        $entry=Join-Path $projectRoot 'server.mjs'
        $url=$null
        $candidates=@($Port)+@(8775..8875 | Where-Object {$_ -ne $Port})
        foreach($candidate in $candidates){
            if(-not(Test-WorldolPortFree $candidate)){continue}
            $env:WORLDOL_PORT=[string]$candidate
            $env:WORLDOL_SAVES=Join-Path $projectRoot $launchProfile.SaveFolder
            $env:WORLDOL_LOGS=Join-Path $projectRoot $launchProfile.LogFolder
            $stderr=Join-Path $projectRoot ('server-'+$candidate+'.stderr.log')
            $started=Start-Process -FilePath $node -ArgumentList ('"'+$entry+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot ('server-'+$candidate+'.stdout.log')) -RedirectStandardError $stderr -PassThru
            $candidateUrl='http://127.0.0.1:'+$candidate
            for($attempt=0;$attempt -lt 60;$attempt++){
                Start-Sleep -Milliseconds 150
                try{
                    $state=Invoke-RestMethod ($candidateUrl+'/api/status') -TimeoutSec 1
                    if($state.project -eq 'worldonline-original-offline' -and $state.projectRoot -eq $projectRoot -and $state.pid -eq $started.Id -and $state.port -eq $candidate){$url=$candidateUrl;break}
                }catch{}
                $started.Refresh();if($started.HasExited){break}
            }
            if($url){break}
            $started.Refresh()
            if($started.HasExited -and (Test-Path -LiteralPath $stderr) -and (Get-Content -LiteralPath $stderr -Raw) -match 'EADDRINUSE'){continue}
            throw ('Server did not start. See '+$stderr)
        }
        if(-not $url){throw 'No free local port was found in 8775-8875.'}
    }
}finally{
    $env:WORLDOL_PORT=$previousEnv.WORLDOL_PORT;$env:WORLDOL_SAVES=$previousEnv.WORLDOL_SAVES;$env:WORLDOL_LOGS=$previousEnv.WORLDOL_LOGS
    if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()
}
$playUrl=$url+'/?save='+[uri]::EscapeDataString($SaveName)
Write-Host ('World online offline: '+$playUrl)
if(-not $NoBrowser){Start-Process $playUrl}
