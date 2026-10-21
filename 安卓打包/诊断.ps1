# Diagnostic helper (ASCII only on purpose: PowerShell 5.1 misreads non-BOM UTF-8 scripts).
# Writes a UTF-8 report so the editor can read it without mojibake.
param(
    [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]

function Add([string]$Text) { $lines.Add($Text) }

function Show-Bom([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { Add ("MISSING  " + $Path); return }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    Add ("BOM=" + $hasBom.ToString().PadRight(5) + " size=" + $bytes.Length.ToString().PadLeft(8) + "  " + $Path)
}

Add '=== build.log (last 80 lines, decoded) ==='
$log = Join-Path $Root 'build.log'
if (Test-Path -LiteralPath $log) {
    $bytes = [IO.File]::ReadAllBytes($log)
    $isUtf16 = ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE)
    $text = if ($isUtf16) { [Text.Encoding]::Unicode.GetString($bytes) } else { [Text.Encoding]::UTF8.GetString($bytes) }
    Add ("encoding=" + $(if ($isUtf16) { 'UTF-16LE' } else { 'UTF-8' }) + " size=" + $bytes.Length)
    $all = $text -split "`r?`n"
    $tail = $all | Select-Object -Last 80
    foreach ($l in $tail) { Add $l }
} else { Add 'build.log not found' }

Add ''
Add '=== BOM check on gradle files ==='
Show-Bom (Join-Path $Root 'app\android\build.gradle')
Show-Bom (Join-Path $Root 'app\android\settings.gradle')
Show-Bom (Join-Path $Root 'app\android\gradle.properties')
Show-Bom (Join-Path $Root 'app\android\gradle\wrapper\gradle-wrapper.properties')
Show-Bom (Join-Path $Root 'app\android\app\build.gradle')
Show-Bom (Join-Path $Root 'app\android\variables.gradle')

Add ''
Add '=== gradle.properties ==='
$gp = Join-Path $Root 'app\android\gradle.properties'
if (Test-Path -LiteralPath $gp) { Add ([IO.File]::ReadAllText($gp)) }

Add ''
Add '=== wrapper distributionUrl ==='
$wp = Join-Path $Root 'app\android\gradle\wrapper\gradle-wrapper.properties'
if (Test-Path -LiteralPath $wp) { Add ([IO.File]::ReadAllText($wp)) }

Add ''
Add '=== APK output ==='
$apkDir = Join-Path $Root 'app\android\app\build\outputs\apk'
Get-ChildItem -LiteralPath $apkDir -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue | ForEach-Object {
    Add ($_.FullName + '  ' + [math]::Round($_.Length / 1MB) + ' MB')
}

$out = Join-Path $Root 'diagnose.txt'
[IO.File]::WriteAllText($out, ($lines -join "`r`n"), (New-Object Text.UTF8Encoding $false))
Write-Host ("Report written to " + $out)
