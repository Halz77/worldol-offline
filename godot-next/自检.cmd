@echo off
rem ==========================================================================
rem  One-click checks for godot-next.
rem  Runs the asset gate first (missing sprites), then every verify_* script.
rem  They must run one after another: several of them share user:// save files.
rem
rem  Usage:  double-click, or run in shell:  自检.cmd
rem  If Godot is somewhere else:  set GODOT=D:\path\Godot_..._console.exe
rem ==========================================================================
chcp 65001 >nul
setlocal

if "%GODOT%"=="" set "GODOT=E:\Godot_v4.7.2-stable_win64\Godot_v4.7.2-stable_win64_console.exe"
if not exist "%GODOT%" (
	echo [FAIL] Godot not found: "%GODOT%"
	echo        set the GODOT environment variable to your Godot_..._console.exe
	exit /b 1
)

set "FAILED="
for %%T in (verify_assets verify_world_map verify_map_editor verify_npc_showcase verify_character_screen verify_equipment verify_appearance verify-data-compile) do (
	echo.
	echo === %%T ===
	"%GODOT%" --headless --path "%~dp0." --script "res://tools/%%T.gd"
	if errorlevel 1 set "FAILED=1"
)

echo.
if defined FAILED (
	echo [FAILED] some checks failed - see the lines above
	exit /b 1
)
echo [OK] all checks passed
exit /b 0
