@echo off
rem One-time setup: reads your Hello Bro XAPK and builds the app for your server address.
cd /d "%~dp0"
set XAPK=
for %%f in (*.xapk) do set XAPK=%%f
if "%XAPK%"=="" (
  echo Put your Hello Bro v28.0 .xapk file in this folder first, then run SETUP.bat again.
  pause
  exit /b
)
echo Found %XAPK%
echo.
echo Which address will players use to reach this server?
echo   playit.gg:   something.joinmc.link:12345
echo   cloud/home:  1.2.3.4:18080  or  yourname.duckdns.org:18080
echo   same Wi-Fi only: this PC's local IP, e.g. 192.168.1.20:18080
set /p ADDR=Address:
if "%ADDR%"=="" exit /b
python -I tools\setup_from_xapk.py "%XAPK%" %ADDR%
echo.
echo Done. Give players the HelloBro-*.apk from this folder (and the OBB, see README.md).
pause
