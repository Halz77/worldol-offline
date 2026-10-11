@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0世界online_原版单机\stop.ps1" -Port 8779
if errorlevel 1 pause
