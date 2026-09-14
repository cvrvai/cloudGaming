@echo off
title CloudKH Streaming PC Node Service
cd /d "%~dp0"

echo ============================================================
echo   CloudKH Gaming PC Streaming Service Launcher
echo ============================================================
echo.

if exist "backend\.venv\Scripts\python.exe" (
    echo [*] Starting CloudKH Node Daemon...
    backend\.venv\Scripts\python.exe -u stream_node.py
) else (
    echo [!] Python virtualenv not found in backend\.venv
    pause
    exit /b 1
)

pause
