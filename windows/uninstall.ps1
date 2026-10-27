# Removes Neon Keys for the current Windows user. Saved progress (lesson stars, songs) stays in
# %LOCALAPPDATA%\NeonKeys unless -RemoveProgress is given.
param([switch]$RemoveProgress)

$ErrorActionPreference = 'SilentlyContinue'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Neon Keys'
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Neon Keys.lnk')
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Neon Keys.lnk')
Remove-Item -Recurse 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonKeys'
if ($RemoveProgress) { Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'NeonKeys') }
# This script lives in the folder being removed, so delete it from a separate process after exit.
Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$dest`""
Write-Host 'Neon Keys removed.'
