@echo off
cd /d "%~dp0"
rem For a server open to strangers, set a password and strict sessions (remove "rem " in front):
rem set ADMIN_PASSWORD=change-me
rem set STRICT_SESSIONS=1
if not exist data\ninjainfo.json (
  echo Run SETUP.bat first.
  pause
  exit /b
)
echo Starting Hello Bro server on port 18080 ...
node server.js
pause
