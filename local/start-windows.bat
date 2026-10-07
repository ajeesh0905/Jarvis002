@echo off
REM Starts Ruchi Food Products on this PC. Data is saved in the "data" folder next to this project.
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again. & pause & exit /b 1)
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=admin123
echo.
echo Starting... open http://localhost:3000/admin on this PC.
echo Keep this window open. Close it to stop the app.
echo.
node server.js
pause
