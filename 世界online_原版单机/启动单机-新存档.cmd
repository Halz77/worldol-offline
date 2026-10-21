@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Port 8775 -SaveName xia-v05-qa
if errorlevel 1 pause
