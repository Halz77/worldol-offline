@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0世界online_原版单机\start.ps1" -Port 8779 -SaveName xia-v05-qa
if errorlevel 1 pause
