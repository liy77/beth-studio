@echo off
rem Instalação fácil do Beth Studio (Windows). Encaminha para install.ps1.
rem Scripts antigos (install-bethstudio-release.*, pack-bethstudio-setup.*) continuam na raiz.
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
