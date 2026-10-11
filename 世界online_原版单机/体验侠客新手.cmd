@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0start.ps1" -Port 8776 -SaveName xia-v05
if errorlevel 1 pause
