$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# 1. Pull the latest code (fast-forward only; harmless if already current)
Write-Host "campfire - checking for updates..." -ForegroundColor Cyan
$before = (git rev-parse HEAD 2>$null)
git pull --ff-only 2>&1 | Write-Host
$after = (git rev-parse HEAD 2>$null)

# 2. Ensure dependencies (incl. better-sqlite3) — install on first run or when code changed
$needInstall = ($before -ne $after) -or
  -not (Test-Path node_modules) -or -not (Test-Path server/node_modules) -or -not (Test-Path client/node_modules)
if ($needInstall) {
  Write-Host "Installing dependencies (incl. better-sqlite3)..." -ForegroundColor Yellow
  npm run install:all
}

# 3. Open the default browser once the client has had a moment to come up
Start-Job { Start-Sleep -Seconds 5; Start-Process "http://localhost:5173" } | Out-Null

# 4. Launch server + client as tracked process trees so Ctrl+C can kill them cleanly
$server = Start-Process cmd -ArgumentList '/c', 'npm run dev --prefix server' -PassThru -NoNewWindow
$client = Start-Process cmd -ArgumentList '/c', 'npm run dev --prefix client' -PassThru -NoNewWindow
Write-Host "`ncampfire running - server http://localhost:3001 | client http://localhost:5173" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop (both shut down automatically).`n" -ForegroundColor DarkGray

try {
  Wait-Process -Id $server.Id, $client.Id
} finally {
  Write-Host "`nStopping campfire..." -ForegroundColor Cyan
  foreach ($p in @($server, $client)) {
    if ($p -and -not $p.HasExited) { taskkill /PID $p.Id /T /F *> $null }
  }
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
}
