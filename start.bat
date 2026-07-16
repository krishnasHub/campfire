@echo off
cd /d "%~dp0"
if not exist node_modules goto install
if not exist server\node_modules goto install
if not exist client\node_modules goto install
goto run
:install
echo Installing dependencies...
call npm run install:all
:run
call npm run dev
