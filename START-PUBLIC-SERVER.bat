@echo off
rem Hello Bro PUBLIC server (for strangers over the internet). Same game, but:
rem  - its own save public.db (your private save hellobro.db is not touched) and its own backups in backups-public
rem  - players must log in through the game's account window (game file made by HOST-MY-SERVER.bat with the newest version)
rem  - the admin page and Server Manager ask for a password (asked once below, kept in admin-password.txt)
rem Only one server can run at a time (both use port 18080): close the other one first.
cd /d "%~dp0"
chcp 65001 >nul
title Hello Bro PUBLIC Server
color 0F
where node >nul 2>&1 || (echo. & echo   Node.js is not installed. Get it from https://nodejs.org and run this again. & echo. & pause & exit /b 1)
if not exist admin-password.txt (
  echo.
  echo   Choose a password for the admin page and Server Manager of your public server.
  echo   The browser asks for it; type anything as user name.
  set /p PW="  Password: "
  call echo %%PW%%> admin-password.txt
)
set /p ADMIN_PASSWORD=<admin-password.txt
set DB=public.db
set HB_BACKUPS=backups-public
set LOGIN_LOCK=1
set STRICT_SESSIONS=1
set HB_MANAGED=1
start "" /b cmd /c "timeout /t 3 >nul & start "" http://localhost:18080/manager"
:run
node server.js
if %errorlevel%==3 (echo. & echo   Restarting... & echo. & goto run)
echo.
echo   The server has stopped. Press any key to close this window.
pause >nul
