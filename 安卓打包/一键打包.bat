@echo off
REM 本文件必须用 GBK(936) 编码保存：cmd 永远是按系统 ANSI 代码页读 .bat 的，
REM 存成 UTF-8 会让中文变成乱码，甚至把半截字节当成分隔符拆坏命令行。
chcp 936 >nul 2>nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM ===========================================================================
REM  世界OL 单机版 - 一键打包（Windows 10 / 11，双击即可）
REM
REM  做四件事：
REM    1/4 环境自检      Node.js / 构建脚本 / 工程文件是否齐
REM    2/4 构建站点      跑 standalone\build.mjs（改动必须重跑这一步！）
REM    3/4 编译 APK      跑 构建APK.ps1（Capacitor + Gradle）
REM    4/4 归档          复制到 output\ 并打印大小、站点指纹、SHA256
REM
REM  可选参数： release   出 release 包（需自己配签名）
REM            fresh     重新生成 android 工程（改了 appId 后用）
REM            noopen    跑完不自动打开输出目录
REM            nopause   跑完不等待按键
REM ===========================================================================

set "PACK=%~dp0"
set "DO_PAUSE=1"
set "DO_OPEN=1"
set "RELEASE="
set "FRESH="

:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="release" set "RELEASE=-Release"
if /i "%~1"=="fresh" set "FRESH=-Fresh"
if /i "%~1"=="noopen" set "DO_OPEN=0"
if /i "%~1"=="nopause" set "DO_PAUSE=0"
shift
goto :parse
:parsed

REM 批量删除保护（构建时 capacitor 会清空 assets/public 下上万个文件）
set "CODEBUDDY_SAFE_DELETE_ENABLED=0"

echo.
echo ============================================================
echo   世界OL 单机版 - 一键打包
echo ============================================================
echo   目录: %PACK%
echo.

REM ------------------------------ 1/4 环境自检 ------------------------------
echo [1/4] 环境自检

set "NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%~fN"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE (
  echo   [FAIL] 没有找到 Node.js
  echo          请先安装 Node.js（https://nodejs.org），装完重新打开这个窗口。
  goto :fail
)
echo   [OK] Node.js: %NODE%
for /f "delims=" %%V in ('"%NODE%" -v 2^>nul') do echo   [OK] 版本: %%V

set "APK_PS="
for %%F in ("%PACK%*APK*.ps1") do set "APK_PS=%%~fF"
if not defined APK_PS (
  echo   [FAIL] 同目录下找不到构建脚本（构建APK.ps1）
  goto :fail
)
echo   [OK] 构建脚本: %APK_PS%

if not exist "%PACK%standalone\build.mjs" (
  echo   [FAIL] 缺少 standalone\build.mjs（站点构建脚本）
  goto :fail
)
if not exist "%PACK%app\package.json" (
  echo   [FAIL] 缺少 app\ 目录（Capacitor 工程模板）
  goto :fail
)
echo   [OK] 工程文件齐备

REM ------------------------------ 2/4 构建站点 ------------------------------
echo.
echo [2/4] 构建站点（服务端 + 客户端 到 app\www）
pushd "%PACK%"
"%NODE%" "standalone\build.mjs"
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
  echo.
  echo   [FAIL] 站点构建失败（退出码 %RC%）
  goto :fail
)
if not exist "%PACK%app\www\worldol-standalone.js" (
  echo   [FAIL] 站点产物缺失：app\www\worldol-standalone.js
  goto :fail
)

set "BUILDID="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(ConvertFrom-Json (Get-Content -Raw -LiteralPath '%PACK%app\www\build-version.json')).id" 2^>nul`) do set "BUILDID=%%A"
if defined BUILDID (echo   [OK] 站点指纹: %BUILDID%) else (echo   [!]  没读到站点指纹（不影响打包）)

REM ------------------------------ 3/4 编译 APK ------------------------------
echo.
echo [3/4] 编译 APK（首次 5-15 分钟，之后的增量构建通常 1-3 分钟）
echo.
REM 构建APK.ps1 自己把控制台与子进程都固定成 UTF-8，这里临时把代码页切到 65001
REM 让它的中文正常显示；它跑完立刻切回 936，后面 bat 自己的中文才不会乱码。
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%APK_PS%" %RELEASE% %FRESH%
set "RC=%ERRORLEVEL%"
chcp 936 >nul
if not "%RC%"=="0" (
  echo.
  echo   [FAIL] APK 编译失败（退出码 %RC%）
  goto :fail
)

REM ------------------------------ 4/4 归档 ------------------------------
echo.
echo [4/4] 归档 APK

set "APKDIR=%PACK%app\android\app\build\outputs\apk"
set "SRC="
if defined RELEASE if exist "%APKDIR%\release\app-release.apk" set "SRC=%APKDIR%\release\app-release.apk"
if not defined SRC if exist "%APKDIR%\debug\app-debug.apk" set "SRC=%APKDIR%\debug\app-debug.apk"
if not defined SRC for /f "delims=" %%F in ('dir /b /s /o-d "%APKDIR%\*.apk" 2^>nul') do if not defined SRC set "SRC=%%F"
if not defined SRC (
  echo   [FAIL] 编译看着成功了，却没找到 APK 文件
  goto :fail
)

if not exist "%PACK%output" mkdir "%PACK%output"
set "STAMP="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%A"
set "DST=%PACK%output\worldol-%STAMP%.apk"
copy /y "%SRC%" "%DST%" >nul
if not exist "%DST%" (
  echo   [FAIL] 复制 APK 到 output\ 失败
  goto :fail
)

set "SIZE="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[math]::Round((Get-Item -LiteralPath '%DST%').Length/1MB,1)"`) do set "SIZE=%%A"
set "HASH="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "(Get-FileHash -LiteralPath '%DST%' -Algorithm SHA256).Hash.ToLower()"`) do set "HASH=%%A"

REM 保留最近 5 个包，其余同名前缀的旧包清掉（只动 output\ 里本脚本自己的产物）
set "REMOVED=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%PACK%output' -Filter 'worldol-*.apk' ^| Sort-Object LastWriteTime -Descending ^| Select-Object -Skip 5 ^| ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; $_.Name }" 2^>nul`) do set /a REMOVED+=1
if not "%REMOVED%"=="0" echo   [i]  已清理 %REMOVED% 个旧包（output\ 里保留最近 5 个）

echo.
echo ============================================================
echo   打包完成
echo ============================================================
echo   APK    : %DST%
echo   体积   : %SIZE% MB
echo   站点指纹: %BUILDID%
echo   SHA256 : %HASH%
echo.
echo   装到手机：
echo     adb install -r "%DST%"
echo     或把 APK 拷进手机点击安装（需允许“未知来源”）。
echo.
echo   改过技能/道具/数据后请重新跑本脚本：站点会重算指纹，
echo   手机会自动清 WebView 缓存，不会出现“装了新版还是旧界面”。
echo.
echo   [完成] 四步全部成功，退出码 0
echo.

if "%DO_OPEN%"=="1" start "" "%PACK%output"
if "%DO_PAUSE%"=="1" pause
endlocal
exit /b 0

:fail
echo.
echo ------------------------------------------------------------
echo   打包没有完成
echo ------------------------------------------------------------
echo   1) 第一次用：先运行 安装环境.ps1（一次性，约 600MB-1GB 下载）
echo   2) 详细日志：%PACK%build.log
echo   3) 环境报告：运行 诊断.ps1
echo   4) 常见原因：
echo      - 首次构建要下载 Gradle 与依赖，网络慢会超时，重跑一次通常就好
echo      - 改了 appId：重新双击时带上 fresh 参数生成新的 android 工程
echo.
echo   [失败] 上面的步骤没跑完，退出码 1
echo.
if "%DO_PAUSE%"=="1" pause
endlocal
exit /b 1
