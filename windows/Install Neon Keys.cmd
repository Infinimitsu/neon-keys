@echo off
rem Installs Neon Keys for this user: Start menu and desktop shortcuts, no admin needed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
