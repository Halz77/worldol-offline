# =============================================================================
#  世界OL 单机版 —— 抓取手机启动日志（定位闪退）
#
#  用法：
#    1. 手机开启「开发者选项 → USB 调试」，用数据线连上电脑
#    2. powershell -ExecutionPolicy Bypass -File .\诊断\抓取启动日志.ps1
#    3. 按提示在手机上点开「世界ol共存基座版」，等它闪退
#    4. 回到电脑按回车，日志会存到 诊断\ 目录下
# =============================================================================
[CmdletBinding()]
param(
    [string]$AppId = 'net.worldol.offline'
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

function Write-Step([string]$Text) { Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "  [!]  $Text" -ForegroundColor Yellow }

$outDir = $PSScriptRoot
$sdkRoot = $env:ANDROID_HOME
if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) { $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
# 打包工具链默认在 E:\apk_pack_tool（2026-10-20 从 C 盘迁出），旧路径找不到时兜底
if (-not (Test-Path -LiteralPath $sdkRoot)) {
    $toolSdk = 'E:\apk_pack_tool\android-sdk'
    if (Test-Path -LiteralPath $toolSdk) { $sdkRoot = $toolSdk }
}
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) {
    $adbCmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($adbCmd) { $adb = $adbCmd.Source } else { throw "找不到 adb。请确认已装 platform-tools：$sdkRoot\platform-tools" }
}
Write-Ok ("adb = " + $adb)

Write-Step '检查设备'
$devices = & $adb devices
$devices | ForEach-Object { Write-Host ("  " + $_) }
$online = @($devices | Where-Object { $_ -match "\sdevice$" })
if ($online.Count -eq 0) {
    throw @"
没有检测到已授权的设备。请检查：
  1) 手机「设置 → 关于手机 → 连点版本号 7 次」开启开发者选项
  2) 开发者选项里打开「USB 调试」
  3) 数据线连接电脑，手机上弹出「允许 USB 调试吗？」时点「允许」
  4) 重新运行本脚本
"@
}

Write-Step '清空旧日志'
& $adb logcat -c
& $adb shell "rm -f /data/data/$AppId/files/logs/worldol-boot.log" 2>$null | Out-Null
Write-Ok '已清空 logcat（App 内的启动日志会在下次启动时自动重建）'

Write-Step '请在手机上操作'
Write-Host '  1. 打开「世界ol共存基座版」' -ForegroundColor Yellow
Write-Host '  2. 等它出现闪退 / 卡住' -ForegroundColor Yellow
Write-Host '  3. 完成后回到这里按回车' -ForegroundColor Yellow
Read-Host '  完成后按回车继续' | Out-Null

Write-Step '抓取 logcat'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$allFile = Join-Path $outDir ("启动日志-全部-$stamp.txt")
$keyFile = Join-Path $outDir ("启动日志-关键-$stamp.txt")
$bootFile = Join-Path $outDir ("启动日志-应用内-$stamp.txt")

$all = & $adb logcat -d -v time 2>&1
$all | Set-Content -LiteralPath $allFile -Encoding UTF8
Write-Ok ("全部日志 -> " + $allFile + "  (" + $all.Count + " 行)")

# 只保留和崩溃 / Node / WebView 相关的行
$pattern = 'NODEJS-MOBILE|worldol|AndroidRuntime|FATAL|libc|DEBUG\s*:|chromium|Capacitor|ActivityManager|ActivityTaskManager|lowmemorykiller|OutOfMemory|nodejs|' + [regex]::Escape($AppId)
$key = $all | Where-Object { $_ -match $pattern }
$key | Set-Content -LiteralPath $keyFile -Encoding UTF8
Write-Ok ("关键日志 -> " + $keyFile + "  (" + $key.Count + " 行)")

Write-Step '拉取应用内启动日志'
# debug 包可以 run-as，直接读 App 私有目录里的 worldol-boot.log
$boot = & $adb shell "run-as $AppId cat files/logs/worldol-boot.log" 2>&1
if ($LASTEXITCODE -eq 0 -and $boot -and ($boot -join '') -notmatch 'No such file|not debuggable|Permission denied') {
    $boot | Set-Content -LiteralPath $bootFile -Encoding UTF8
    Write-Ok ("应用内启动日志 -> " + $bootFile)
    Write-Host ''
    Write-Host '---- worldol-boot.log 内容 ----' -ForegroundColor Magenta
    $boot | ForEach-Object { Write-Host ('  ' + $_) }
    Write-Host '-------------------------------' -ForegroundColor Magenta
} else {
    Write-Warn2 '没取到应用内启动日志（可能还没跑到写日志那一步，或 App 已被卸载）'
}

Write-Host ''
Write-Host '================ 抓取完成 ================' -ForegroundColor Green
Write-Host '请把这三个文件（尤其是「关键」和「应用内」）发给助手。' -ForegroundColor Yellow
Write-Host ''
Write-Host '快速自查提示：' -ForegroundColor DarkGray
Write-Host '  · 若「关键」里最后只有 NODEJS-MOBILE 的几行 -> 是 Node 侧的问题，看「应用内」最后一行'
Write-Host '  · 若出现 FATAL EXCEPTION / signal 11 (SIGSEGV) -> 原生崩溃，把整段栈贴出来'
Write-Host '  · 若出现 lowmemorykiller / OutOfMemory -> 内存不足，需要减小资源占用'
Write-Host '  · 若完全没有本 App 的日志 -> 可能装的是旧包，先重新安装 APK'
