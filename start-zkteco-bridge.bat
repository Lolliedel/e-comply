@echo off
title ZKTeco Live20R Hardware Bridge

echo =====================================================================
echo   ZKTeco Live20R / SLK20R Biometric Hardware Bridge
echo   E-comply Compliance Management System
echo =====================================================================
echo.

cd /d "%~dp0"
if exist "zkteco-bridge" cd "zkteco-bridge"

echo [*] Resetting port 43711...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 43711 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1

:: Check direct Python paths
set PY_CMD=""
if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    set PY_CMD="%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
    goto :RUN_PYTHON
)

if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
    set PY_CMD="%LOCALAPPDATA%\Python\bin\python.exe"
    goto :RUN_PYTHON
)

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PY_CMD=python
    goto :RUN_PYTHON
)

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PY_CMD=py
    goto :RUN_PYTHON
)

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    goto :RUN_NODE
)

echo [ERROR] Neither Python nor Node.js could be found.
pause
exit /b 1

:RUN_PYTHON
echo [*] Launching ZKTeco Live20R Native Hardware Bridge...
%PY_CMD% -u bridge.py
goto :END

:RUN_NODE
echo [*] Launching Node.js Bridge Fallback...
node server.js
goto :END

:END
echo.
echo Bridge stopped.
pause
