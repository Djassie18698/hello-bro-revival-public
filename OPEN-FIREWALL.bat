@echo off
rem Lets other devices reach the Hello Bro server. Right-click this file -> "Run as administrator" (only once).
netsh advfirewall firewall add rule name="Hello Bro server" dir=in action=allow protocol=TCP localport=18080
echo.
echo Done. If it says "Ok." the rule was added.
pause
