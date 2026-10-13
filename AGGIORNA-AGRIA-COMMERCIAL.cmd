@echo off
rem Aggiorna Agria Commercial alla versione stabile approvata (PC dei commerciali).
rem Si ferma se ci sono modifiche locali; alla fine apre chrome://extensions. Vedi tools\update-workstation.ps1.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-workstation.ps1" %*
set "ESITO=%ERRORLEVEL%"
echo.
if not defined AGRIA_NO_PAUSE pause
exit /b %ESITO%
