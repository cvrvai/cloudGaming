@echo off
title CloudKH 24/7 Gaming PC Node Daemon
cd /d "%~dp0"

:: Disable Windows Console QuickEdit mode to prevent accidental freeze on mouse click
reg add HKCU\Console /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1

echo ============================================================
echo   CloudKH Gaming PC 24/7 Persistent Streaming Daemon
echo ============================================================
echo.

:daemon_loop
echo [%TIME%] Syncing latest updates...
git pull --ff-only 2>nul

echo [%TIME%] Starting CloudKH Streaming Node...
backend\.venv\Scripts\python.exe -u stream_node.py %*

echo.
echo [%TIME%] [!] Stream node stopped or crashed (Exit Code: %ERRORLEVEL%).
echo [%TIME%] [*] Automatically restarting in 3 seconds to keep PC online 24/7...
echo [%TIME%] (Press Ctrl+C to exit completely)
timeout /t 3 /nobreak >nul
goto daemon_loop

