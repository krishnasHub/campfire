@echo off
REM Convenience launcher — hands off to start.ps1, which self-updates, installs deps,
REM opens the browser, and shuts both server+client down cleanly on Ctrl+C.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
