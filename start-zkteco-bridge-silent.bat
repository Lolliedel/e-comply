@echo off
cd /d "%~dp0"
if exist "zkteco-bridge" cd "zkteco-bridge"

:: Ensure port 43711 is not locked by a zombie process
powershell -NoProfile -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 43711 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1

:: Run python bridge
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python -u bridge.py
    exit /b 0
)

:: Fallback to node server
where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    node server.js
    exit /b 0
)
