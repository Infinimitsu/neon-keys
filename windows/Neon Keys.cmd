@echo off
rem Runs Neon Keys straight from this folder, without installing it.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0neon-keys.ps1"
