# Neon Keys for Windows: serves the app on localhost and opens it as an Edge (or Chrome) app window
# with its own profile, which remembers MIDI/camera permissions, lesson stars and saved songs.
# Closing the window stops the server. Needs nothing beyond Windows itself: PowerShell serves the
# files, and Edge comes with Windows.
#   powershell -NoProfile -ExecutionPolicy Bypass -File neon-keys.ps1
param(
    [int]$Port = 8024,       # fixed, because the browser keeps saved progress per localhost:port
    [string]$BrowserPath = '',   # path to another Chromium-based browser (Brave, Vivaldi...)
    [string]$ExtraArgs = ''  # extra browser switches, space-separated
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

function Fail([string]$message) {
    [System.Windows.Forms.MessageBox]::Show($message, 'Neon Keys', 'OK', 'Error') | Out-Null
    exit 1
}

# The app files sit next to this script once installed, or in ..\web in the source repository.
$web = @((Join-Path $PSScriptRoot 'web'), (Join-Path $PSScriptRoot '..\web')) |
    Where-Object { Test-Path (Join-Path $_ 'index.html') } | Select-Object -First 1
if (-not $web) { Fail "Neon Keys can't find its app files next to $PSScriptRoot. Try downloading it again." }
$web = (Resolve-Path $web).Path

$browser = @(
    $BrowserPath,
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { Fail 'Neon Keys needs Microsoft Edge or Google Chrome. Please install one of them.' }

$profileDir = Join-Path $env:LOCALAPPDATA 'NeonKeys\profile'
$url = "http://localhost:$Port/"
$browserArgs = @(
    "--app=$url", "--user-data-dir=`"$profileDir`"", '--start-maximized', '--no-first-run',
    '--no-default-browser-check', '--disable-background-mode', '--autoplay-policy=no-user-gesture-required'
)
if ($ExtraArgs) { $browserArgs += $ExtraArgs -split ' ' }

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)
try {
    $listener.Start()
} catch {
    # Already open (a second click on the icon): the first copy is serving, just show the window.
    Start-Process -FilePath $browser -ArgumentList $browserArgs
    exit 0
}

$types = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
    '.txt' = 'text/plain; charset=utf-8'; '.mid' = 'audio/midi'; '.midi' = 'audio/midi'
}

function Send-File($context) {
    $response = $context.Response
    try {
        $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
        if ($path -eq '') { $path = 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $web $path))
        # Only files inside the app folder, never ..\ escapes.
        if (-not $file.StartsWith($web + [IO.Path]::DirectorySeparatorChar) -or -not (Test-Path $file -PathType Leaf)) {
            $response.StatusCode = 404
            return
        }
        $bytes = [IO.File]::ReadAllBytes($file)
        $type = $types[[IO.Path]::GetExtension($file).ToLower()]
        $response.ContentType = if ($type) { $type } else { 'application/octet-stream' }
        $response.Headers['Cache-Control'] = 'no-cache'  # so updated files show up right away
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $response.StatusCode = 500
    } finally {
        $response.Close()
    }
}

$app = Start-Process -FilePath $browser -ArgumentList $browserArgs -PassThru
try {
    $pending = $listener.GetContextAsync()
    while (-not $app.HasExited) {
        if ($pending.Wait(250)) {
            Send-File $pending.Result
            $pending = $listener.GetContextAsync()
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
