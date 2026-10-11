@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Port 8776 -SaveName acceptance
if errorlevel 1 pause
