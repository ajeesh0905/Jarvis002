@echo off
title Studio app
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org , then double-click this file again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Install the latest LTS version from https://nodejs.org , then try again.
  pause
  exit /b 1
)
if "%ADMIN_PIN%"=="" set ADMIN_PIN=1234
echo.
echo  Studio app is starting...
echo  On this computer : http://localhost:3100     Log in: admin / PIN %ADMIN_PIN%
echo  Same Wi-Fi/office: run  ipconfig  and open  http://YOUR-IP:3100  on the other phones
echo  Keep this window open. Close it to stop the app.
echo.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3100"
node server.js
pause
