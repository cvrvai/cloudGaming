@echo off
title CloudKH 24/7 Gaming PC Node Service
cd /d "%~dp0"

:: Disable Windows Console QuickEdit mode to prevent accidental freeze on mouse click
reg add HKCU\Console /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1

echo ============================================================
echo   CloudKH Gaming PC 24/7 Streaming Service Launcher
echo ============================================================
echo.

if not exist "backend\.venv\Scripts\python.exe" (
    echo [*] Python virtual environment not found. Running setup...
    call setup_node.bat
)

if not exist ".node_config.json" (
    echo [*] Node configuration missing. Running pairing setup...
    call setup_node.bat
)

:daemon_loop
echo [%TIME%] Starting CloudKH Streaming Node...
backend\.venv\Scripts\python.exe -u stream_node.py %*

echo.
echo [%TIME%] [!] Stream node stopped or disconnected (Exit Code: %ERRORLEVEL%).
echo [%TIME%] [*] Auto-restarting in 3 seconds to keep PC online 24/7...
echo [%TIME%] (Press Ctrl+C to stop completely)
timeout /t 3 /nobreak >nul
goto daemon_loop

