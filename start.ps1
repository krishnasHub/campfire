Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules") -or -not (Test-Path "server/node_modules") -or -not (Test-Path "client/node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  npm run install:all
}
npm run dev
