@echo off
rem Atalho na raiz → scripts\install.cmd
rem Não substitui install-bethstudio-release.cmd (continua na raiz).
call "%~dp0scripts\install.cmd" %*
exit /b %ERRORLEVEL%
