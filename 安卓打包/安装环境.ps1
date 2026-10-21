# =============================================================================
#  世界OL 单机版 —— 安卓构建环境安装（一次性，约 600 MB–1 GB 下载）
#
#  **不需要管理员权限**：
#    JDK 用免安装 zip 解压到工具目录，Android SDK 也装在工具目录，
#    环境变量只写到「用户」作用域，全程不碰系统目录。
#
#  会安装（2026-10-20 起默认落在 E:\apk_pack_tool，不再占 C 盘）：
#    1. Eclipse Temurin JDK 21  → E:\apk_pack_tool\jdk-21
#    2. Android commandline-tools → E:\apk_pack_tool\android-sdk\cmdline-tools\latest
#    3. Android SDK：platform-tools / platforms;android-36 / build-tools;36.0.0
#    4. Gradle 用户目录（发行包 + 依赖缓存）→ E:\apk_pack_tool\gradle-home
#
#  standalone 版没有原生代码（服务端已被 esbuild 打成纯 JS 跑在 WebView 里），
#  所以不需要 NDK 和 CMake，比第一代方案少下约 2 GB。
#
#  用法：powershell -ExecutionPolicy Bypass -File .\安装环境.ps1
#        换盘/换目录：-SdkRoot <路径> -JdkRoot <路径> -GradleUserHome <路径>
# =============================================================================
[CmdletBinding()]
param(
    [string]$SdkRoot = 'E:\apk_pack_tool\android-sdk',
    [string]$JdkRoot = 'E:\apk_pack_tool\jdk-21',
    [string]$GradleUserHome = 'E:\apk_pack_tool\gradle-home'
)

# 注意：PowerShell 5.1 在 ErrorActionPreference='Stop' 时，原生程序（javac / sdkmanager）
# 向 stderr 写任何东西都会被当成致命错误，所以这里用 'Continue'，逐条检查 $LASTEXITCODE。
$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

function Write-Step([string]$Text) { Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "  [!]  $Text" -ForegroundColor Yellow }

function Download-File {
    param([string]$Url, [string]$OutFile, [string]$Label = '')
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.UserAgent = 'worldol-packager'
    $request.Timeout = 60000
    $request.ReadWriteTimeout = 300000
    $response = $request.GetResponse()
    try {
        $total = $response.ContentLength
        $stream = $response.GetResponseStream()
        $file = [IO.File]::Create($OutFile)
        try {
            $buffer = New-Object byte[] (1MB)
            $done = 0
            $next = 0
            while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $file.Write($buffer, 0, $read)
                $done += $read
                if ($done -ge $next) {
                    $next = $done + 50MB
                    if ($total -gt 0) { Write-Host ("    {0} {1:N0} / {2:N0} MB" -f $Label, ($done / 1MB), ($total / 1MB)) }
                    else { Write-Host ("    {0} {1:N0} MB" -f $Label, ($done / 1MB)) }
                }
            }
        } finally { $file.Dispose(); $stream.Dispose() }
    } finally { $response.Close() }
}

# ---------------------------------------------------------------------------
Write-Step '0/4 环境自检'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw ' 未找到 node。请先安装 Node.js 18+（https://nodejs.org）。' }
Write-Ok ("node " + (& node -v))

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Write-Ok '当前是管理员（本脚本不需要）' } else { Write-Ok '当前不是管理员（本脚本不需要管理员）' }

# ---------------------------------------------------------------------------
Write-Step '1/4 安装 JDK 21'

$jdkTarget = $JdkRoot

function Test-Jdk21([string]$JdkPath) {
    if (-not $JdkPath) { return $false }
    $javac = Join-Path $JdkPath 'bin\javac.exe'
    if (-not (Test-Path -LiteralPath $javac)) { return $false }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try { $v = (& $javac -version 2>&1) -join '' } finally { $ErrorActionPreference = $previous }
    return ($v -match '21\.')
}

$jdkHome = $null
foreach ($candidate in @($env:JAVA_HOME, $jdkTarget)) {
    if (Test-Jdk21 $candidate) { $jdkHome = $candidate; break }
}
if ($jdkHome) { Write-Ok ("已安装：" + $jdkHome) }
if (-not $jdkHome) {
    $zip = Join-Path $env:TEMP 'worldol-jdk21.zip'
    # Adoptium 官方 API：总是取 latest 的 JDK 21 GA（windows x64）
    $url = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse'
    Write-Host '  下载 JDK 21（约 190 MB）…'
    Download-File -Url $url -OutFile $zip -Label 'JDK21'

    $tmp = Join-Path $env:TEMP ('worldol-jdk-' + [guid]::NewGuid().ToString('N'))
    Write-Host '   解压中 …'
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem -LiteralPath $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
    if (-not $inner) { $inner = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1 }
    if (-not $inner) { throw 'JDK 解压后找不到目录结构' }
    if (Test-Path -LiteralPath $jdkTarget) { Remove-Item -LiteralPath $jdkTarget -Recurse -Force }
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $jdkTarget) -Force
    Move-Item -LiteralPath $inner.FullName -Destination $jdkTarget
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    $jdkHome = $jdkTarget
}
if (-not (Test-Jdk21 $jdkHome)) { throw 'JDK 21 安装后验证失败' }
$env:JAVA_HOME = $jdkHome
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jdkHome, 'User')
Write-Ok ("JAVA_HOME = " + $jdkHome)

# ---------------------------------------------------------------------------
Write-Step '2/4 安装 Android commandline-tools'

$sdkManager = Join-Path $SdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
if (Test-Path -LiteralPath $sdkManager) {
    Write-Ok 'commandline-tools 已存在'
} else {
    $zip = Join-Path $env:TEMP 'android-cmdline-tools.zip'
    $url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
    Write-Host '  下载 commandline-tools（约 150 MB）…'
    Download-File -Url $url -OutFile $zip -Label 'cmdline-tools'
    $tmp = Join-Path $env:TEMP ('cmdline-tools-' + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $target = Join-Path $SdkRoot 'cmdline-tools\latest'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -Path (Join-Path $tmp 'cmdline-tools\*') -Destination $target -Recurse -Force
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Write-Ok ('已解压到 ' + $target)
}

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $SdkRoot, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $SdkRoot, 'User')
Write-Ok ("ANDROID_HOME = " + $SdkRoot)

# Gradle 用户目录（wrapper 发行包 + 依赖缓存，默认在 C:\Users\<用户>\.gradle，
# 几百 MB 到 1 GB）。统一放到工具目录，和 JDK / SDK 一起管理。
$null = New-Item -ItemType Directory -Path $GradleUserHome -Force
$env:GRADLE_USER_HOME = $GradleUserHome
[Environment]::SetEnvironmentVariable('GRADLE_USER_HOME', $GradleUserHome, 'User')
Write-Ok ("GRADLE_USER_HOME = " + $GradleUserHome)

# ---------------------------------------------------------------------------
Write-Step '3/4 接受 SDK 许可'
# sdkmanager --licenses 是交互式的，用一串 y 喂给它
$answers = ('y' + [Environment]::NewLine) * 60
$answers | & $sdkManager --sdk_root=$SdkRoot --licenses | Out-Null
Write-Ok '许可已接受'

# ---------------------------------------------------------------------------
Write-Step '4/4 安装 SDK 组件（体积大，请耐心）'
$packages = @(
    'platform-tools',
    'platforms;android-36',
    'build-tools;36.0.0'
)
foreach ($pkg in $packages) {
    Write-Host ("  -> " + $pkg)
    & $sdkManager --sdk_root=$SdkRoot $pkg
    if ($LASTEXITCODE -ne 0) { Write-Warn2 ("安装失败（可稍后重试）：" + $pkg) }
}
Write-Ok 'SDK 组件安装结束'

# ---------------------------------------------------------------------------
# 供 构建APK.ps1 直接 source，避免依赖「重开终端才生效」的系统环境变量
$envFile = Join-Path $PSScriptRoot '环境.ps1'
@(
    "# 由 安装环境.ps1 自动生成，请勿手改；重新装环境会覆盖。",
    "# 打包工具链在 E:\apk_pack_tool（JDK / Android SDK / Gradle 用户目录）。",
    "`$env:JAVA_HOME = '$jdkHome'",
    "`$env:ANDROID_HOME = '$SdkRoot'",
    "`$env:ANDROID_SDK_ROOT = '$SdkRoot'",
    "`$env:GRADLE_USER_HOME = '$GradleUserHome'"
) | Set-Content -LiteralPath $envFile -Encoding UTF8

Write-Host ''
Write-Host '================ 环境就绪 ================' -ForegroundColor Green
Write-Host ("JAVA_HOME        : " + $jdkHome)
Write-Host ("ANDROID_HOME     : " + $SdkRoot)
Write-Host ("GRADLE_USER_HOME : " + $GradleUserHome)
Write-Host ("NDK              : 不需要（standalone 无原生代码）")
Write-Host ("环境文件         : " + $envFile)
Write-Host ''
Write-Host '接下来直接跑：' -ForegroundColor Yellow
Write-Host '  powershell -ExecutionPolicy Bypass -File .\构建APK.ps1'
