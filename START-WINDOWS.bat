@echo off
title Ruchi Food Products
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
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=admin123
echo.
echo  Ruchi Food Products is starting...
echo  Admin page : http://localhost:3000/admin   (password: admin123 - change it in Settings)
echo  Shop page  : http://localhost:3000/
echo  Keep this window open. Close it to stop the app.
echo.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000/admin"
node server.js
pause
