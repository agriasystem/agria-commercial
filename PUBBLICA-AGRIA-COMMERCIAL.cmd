@echo off
rem Pubblica la versione stabile di Agria Commercial: SOLO sul PC di sviluppo.
rem Controlli (npm test, e2e, navigator:check), poi git push origin HEAD:stable. Vedi tools\publish-stable.ps1.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\publish-stable.ps1" %*
set "ESITO=%ERRORLEVEL%"
echo.
if not defined AGRIA_NO_PAUSE pause
exit /b %ESITO%
