@echo off
rem Downloads the newest server version. Your save (hellobro.db) and game data are kept.
cd /d "%~dp0"
if exist hellobro.db (
  if not exist backups mkdir backups
  copy /y hellobro.db "backups\before-update-%date:~-4%%date:~3,2%%date:~0,2%.db" >nul
)
where git >nul 2>nul
if %errorlevel%==0 (
  git pull
) else (
  echo Git is not installed. Download the newest ZIP from GitHub and copy it over this folder
  echo (keep hellobro.db and the data folder).
)
echo Done. Start the server again with START-SERVER.bat.
pause
