@echo off
REM Copies the data folder to a dated backup folder next to it. Copy that folder to a USB drive or Google Drive too.
cd /d "%~dp0.."
set STAMP=%date:~-4%-%date:~3,2%-%date:~0,2%
xcopy /E /I /Y data "backups\data-%STAMP%" >nul && echo Backup saved in backups\data-%STAMP%
pause
