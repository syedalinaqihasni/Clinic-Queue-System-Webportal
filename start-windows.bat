@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
start "Clinic Queue System" http://127.0.0.1:4173
node server.js
pause
