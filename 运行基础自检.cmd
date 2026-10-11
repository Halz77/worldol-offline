@echo off
chcp 65001 >nul
cd /d "%~dp0世界online_原版单机"
"%~dp0世界online_原版单机\runtime\node.exe" --test tests/core.test.mjs tests/pets.test.mjs tests/pet-skill-books.test.mjs tests/native-commerce.test.mjs tests/open-portals.test.mjs
if errorlevel 1 pause
