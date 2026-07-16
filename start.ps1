Set-Location $PSScriptRoot
if (-not (Test-Path "server/node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  npm run install:all
}
npm run dev
