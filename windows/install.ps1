# Installs Neon Keys for the current Windows user (no admin needed): copies it to
# %LOCALAPPDATA%\Programs\Neon Keys, adds Start menu and desktop shortcuts, and registers it in
# Settings > Apps so it can be uninstalled there. Run it again to update; saved progress is kept.
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 [-NoDesktopShortcut]
param([switch]$NoDesktopShortcut)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$web = @((Join-Path $here 'web'), (Join-Path $here '..\web')) | Where-Object { Test-Path (Join-Path $_ 'index.html') } | Select-Object -First 1
if (-not $web) { throw "Can't find the app files (web folder) next to $here." }
$version = if (Test-Path (Join-Path $here 'VERSION')) { (Get-Content (Join-Path $here 'VERSION') -Raw).Trim() }
           elseif (Test-Path (Join-Path $here '..\VERSION')) { (Get-Content (Join-Path $here '..\VERSION') -Raw).Trim() } else { '' }

$dest = Join-Path $env:LOCALAPPDATA 'Programs\Neon Keys'
Write-Host "Installing Neon Keys $version to $dest"
if (Test-Path (Join-Path $dest 'web')) { Remove-Item -Recurse -Force (Join-Path $dest 'web') }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Recurse $web (Join-Path $dest 'web')
foreach ($f in 'neon-keys.ps1', 'uninstall.ps1', 'neon-keys.ico') { Copy-Item (Join-Path $here $f) $dest -Force }
Get-ChildItem -Recurse $dest | Unblock-File  # files from a downloaded zip are marked as from the internet

$shell = New-Object -ComObject WScript.Shell
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcuts = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Neon Keys.lnk'))
if (-not $NoDesktopShortcut) { $shortcuts += Join-Path ([Environment]::GetFolderPath('Desktop')) 'Neon Keys.lnk' }
foreach ($path in $shortcuts) {
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $powershell
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\neon-keys.ps1`""
    $link.WorkingDirectory = $dest
    $link.IconLocation = "$dest\neon-keys.ico"
    $link.Description = 'Play the keyboard, light up the screen, and learn songs'
    $link.WindowStyle = 7  # minimized: PowerShell only runs the little web server
    $link.Save()
}

# Settings > Apps entry (per user, so no admin rights needed)
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeonKeys'
New-Item -Force $key | Out-Null
$values = @{
    DisplayName = 'Neon Keys'; DisplayVersion = $version; Publisher = 'Neon Keys'; DisplayIcon = "$dest\neon-keys.ico"
    InstallLocation = $dest; NoModify = 1; NoRepair = 1
    UninstallString = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$dest\uninstall.ps1`""
}
foreach ($name in $values.Keys) { Set-ItemProperty -Path $key -Name $name -Value $values[$name] }

Write-Host 'Done! Open Neon Keys from the Start menu or the desktop.'
Write-Host 'The first time, click Allow when it asks to use MIDI devices.'
