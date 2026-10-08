@echo off
title Deploy to Cloudflare
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org , then double-click this file again.
  pause
  exit /b 1
)
node cloudflare\setup.mjs
pause
