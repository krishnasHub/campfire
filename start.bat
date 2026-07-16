@echo off
cd /d "%~dp0"
if not exist server\node_modules ( echo Installing deps... & npm run install:all )
npm run dev
