# The requested port selects a save profile; the actual listening port may differ.
function Get-WorldolLaunchProfile([int]$RequestedPort) {
    $saveFolder=@{8775='saves';8776='test-saves';8778='feature-saves';8779='qa-v05-saves'}[$RequestedPort]
    $logFolder=@{8775='logs';8776='logs\test';8778='logs\feature';8779='logs\qa-v05'}[$RequestedPort]
    if(-not $saveFolder){throw 'Unknown save profile.'}
    return @{SaveFolder=$saveFolder;LogFolder=$logFolder}
}
function Get-WorldolOwnedService([string]$ProjectRoot,[string]$ControlFile) {
    try {
        if(-not(Test-Path -LiteralPath $ControlFile)){return $null}
        $control=Get-Content -LiteralPath $ControlFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if($control.projectRoot -ne $ProjectRoot -or $control.port -lt 1 -or $control.port -gt 65535){return $null}
        $url='http://127.0.0.1:'+[int]$control.port
        $state=Invoke-RestMethod ($url+'/api/status') -TimeoutSec 1
        if($state.project -ne 'worldonline-original-offline' -or $state.projectRoot -ne $ProjectRoot -or $state.pid -ne $control.pid -or $state.port -ne $control.port){return $null}
        $process=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$state.pid)
        $node=Join-Path $ProjectRoot 'runtime\node.exe'
        if(-not(Test-Path -LiteralPath $node)){$node=(Get-Command node -ErrorAction Stop).Source}
        $entry=Join-Path $ProjectRoot 'server.mjs'
        if($process.ExecutablePath -ne $node -or -not $process.CommandLine.Contains('"'+$entry+'"')){return $null}
        $listeners=@(Get-NetTCPConnection -LocalPort $control.port -State Listen -ErrorAction Stop | Where-Object {$_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq $state.pid})
        if($listeners.Count -ne 1){return $null}
        return @{State=$state;Control=$control;Url=$url}
    }catch{return $null}
}
function Test-WorldolPortFree([int]$Candidate) {
    $probe=New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback,$Candidate)
    try{$probe.Server.ExclusiveAddressUse=$true;$probe.Start();return $true}
    catch{return $false}
    finally{$probe.Stop()}
}

# Update archives contain code only. Keep a separate, immutable pre-update save
# before the new server performs its normal capacity and daily-task migrations.
function Get-WorldolFileSHA256([string]$File) {
    $stream=[IO.File]::OpenRead($File)
    $sha=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}finally{$stream.Dispose();$sha.Dispose()}
}
function Backup-WorldolSaveBeforeUpdate([string]$ProjectRoot,[string]$SaveFolder) {
    $releaseFile=Join-Path $ProjectRoot 'data\offline-update.json'
    $saveFile=Join-Path (Join-Path $ProjectRoot $SaveFolder) 'world.json'
    if(-not(Test-Path -LiteralPath $releaseFile) -or -not(Test-Path -LiteralPath $saveFile)){return}
    $release=Get-Content -LiteralPath $releaseFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if($release.id -notmatch '^[a-zA-Z0-9_-]{1,80}$' -or $SaveFolder -notin @('saves','test-saves','feature-saves','qa-v05-saves')){throw 'Invalid update backup location.'}
    $backupDir=Join-Path (Join-Path (Join-Path $ProjectRoot 'backups\updates') $release.id) $SaveFolder
    $backupFile=Join-Path $backupDir 'world.json'
    $hashFile=Join-Path $backupDir 'world.sha256'
    if(Test-Path -LiteralPath $backupFile){
        if(-not(Test-Path -LiteralPath $hashFile) -or (Get-WorldolFileSHA256 $backupFile) -ne (Get-Content -LiteralPath $hashFile -Raw).Trim()){throw 'The pre-update save backup failed validation. Original saves were not changed.'}
        return
    }
    $bytes=[IO.File]::ReadAllBytes($saveFile)
    $saved=[Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF) | ConvertFrom-Json
    if($saved.schema -ne 1 -or $null -eq $saved.characters){throw 'The existing save could not be validated. Update startup stopped without changing it.'}
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$hash=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','')}finally{$sha.Dispose()}
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Set-Content -LiteralPath $hashFile -Value $hash -Encoding ASCII
    $temp=$backupFile+'.tmp'
    [IO.File]::WriteAllBytes($temp,$bytes)
    Move-Item -LiteralPath $temp -Destination $backupFile
    if((Get-WorldolFileSHA256 $backupFile) -ne $hash){throw 'Pre-update save backup verification failed.'}
    Write-Host ('Pre-update save backup: '+$backupFile)
}
