@echo off
rem Hello Bro server: starts the server, opens the Server Manager in your browser, and starts the server again
rem when you press Restart in the manager. Close this window to stop the server.
cd /d "%~dp0"
rem For a server open to strangers, set a password and strict sessions (remove "rem " in front):
rem set ADMIN_PASSWORD=change-me
rem set STRICT_SESSIONS=1
if not exist data\ninjainfo.json (
  echo Run SETUP.bat first.
  pause
  exit /b
)
chcp 65001 >NUL
title Hello Bro Server
set HB_MANAGED=1
start "" /b cmd /c "timeout /t 3 >NUL & start "" http://localhost:18080/manager"
:run
node server.js
if %errorlevel%==3 (echo. & echo   Restarting... & echo. & goto run)
echo.
echo   The server has stopped. Press any key to close this window.
pause >NUL
