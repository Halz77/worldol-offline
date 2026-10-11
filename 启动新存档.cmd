@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0世界online_原版单机\start.ps1" -Port 8775 -SaveName offline
if errorlevel 1 pause
