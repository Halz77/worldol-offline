@echo off
REM 本文件必须用 GBK(936) 编码保存：cmd 永远是按系统 ANSI 代码页读 .bat 的。
chcp 936 >nul 2>nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo   清理「打包」堆在回收站里的构建垃圾
echo ============================================================
echo   打包时 Gradle 会重建 assets 的中间产物（一次一两万个文件）。
echo   有些环境下这些删除会被记进回收站，攒多了既占空间，
echo   在资源管理器里清空还特别卡（几万个文件要逐个处理）。
echo.

set "DRIVE=%~d0"
if "%DRIVE%"=="" set "DRIVE=F:"
set "LETTER=%DRIVE:~0,1%"

echo   正在统计 %LETTER% 盘的回收站（文件多时几秒钟）...
set "BEFORE=?"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "@(Get-ChildItem -LiteralPath '%DRIVE%\$Recycle.Bin' -Recurse -Force -Filter '$I*' -ErrorAction SilentlyContinue).Count"`) do set "BEFORE=%%A"
echo   当前条目数: !BEFORE!
echo.
echo   注意：这一步会清空 %LETTER% 盘回收站里的**全部**内容 ——
echo         包括你平时删除的其他文件，清空后无法还原。
echo         建议先打开回收站看一眼确认。
echo.
set "ANS="
set /p "ANS=确定清空 %LETTER% 盘回收站吗？(输入 Y 再回车 = 执行，直接回车 = 取消) "
if /i not "!ANS!"=="Y" (
  echo.
  echo   已取消，什么都没做。
  echo.
  pause
  exit /b 0
)
echo.
echo   正在清空（几万个文件，可能需要一会儿）...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Clear-RecycleBin -DriveLetter %LETTER% -Force -ErrorAction SilentlyContinue"
set "AFTER=?"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "@(Get-ChildItem -LiteralPath '%DRIVE%\$Recycle.Bin' -Recurse -Force -Filter '$I*' -ErrorAction SilentlyContinue).Count"`) do set "AFTER=%%A"
echo.
echo ============================================================
echo   完成：!BEFORE! 条  ->  !AFTER! 条
echo ============================================================
echo.
echo   想避免再次堆积：自己双击「一键打包.bat」打包即可 ——
echo   从本机手工跑时，Windows 会直接删除构建中间产物，不进回收站。
echo.
pause
exit /b 0
