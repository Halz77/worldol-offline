@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "FAIL=0"
set "GAME="
for /d %%D in ("%~dp0*") do if exist "%%~fD\server.mjs" set "GAME=%%~fD"
if not defined GAME (
  echo [FAIL] Game directory not found.
  set "FAIL=1"
  goto :summary
)
cd /d "%GAME%"

set "NODE=runtime\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================================
echo  WorldOL Offline - Basic Self Check
echo ============================================================
echo.

echo [1/4] Runtime and files...
"%NODE%" --version >nul 2>nul
if errorlevel 1 (
  echo   [FAIL] Node.js not found.
  set "FAIL=1"
) else (
  echo   [ OK ] Node.js
  "%NODE%" --version
)
if not exist "server.mjs" (
  echo   [FAIL] server.mjs is missing.
  set "FAIL=1"
) else (
  echo   [ OK ] server.mjs
)
if not exist "saves\world.json" echo   [WARN] saves\world.json is missing; the server will create one.
if not exist "default-save\world.json" echo   [WARN] default-save\world.json is missing.

echo.
echo [2/4] Save and override JSON...
"%NODE%" tools\check-data.mjs
if errorlevel 1 set "FAIL=1"

echo.
echo [3/4] Syntax...
"%NODE%" tools\check-syntax.mjs
if errorlevel 1 set "FAIL=1"

echo.
echo [4/4] Core tests...
"%NODE%" --test tests\core.test.mjs tests\pets.test.mjs tests\pet-skill-books.test.mjs tests\native-commerce.test.mjs tests\open-portals.test.mjs
if errorlevel 1 set "FAIL=1"

:summary
echo.
if "%FAIL%"=="0" (
  echo [RESULT] PASS
  echo.
  echo For the full suite run: npm test
) else (
  echo [RESULT] FAIL - see the messages above.
)

if /I "%~1"=="nopause" exit /b %FAIL%
pause
exit /b %FAIL%
