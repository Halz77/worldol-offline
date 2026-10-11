@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" -Port 8776
if errorlevel 1 pause
