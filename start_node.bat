@echo off
title CloudKH Streaming PC Node Service
cd /d "%~dp0"

echo ============================================================
echo   CloudKH Gaming PC Streaming Service Launcher
echo ============================================================
echo.

if exist "backend\.venv\Scripts\python.exe" (
    if exist ".node_config.json" (
        echo [*] Starting CloudKH Node Daemon...
        backend\.venv\Scripts\python.exe -u stream_node.py
    ) else (
        echo [*] Node configuration missing. Running setup...
        call setup_node.bat
    )
) else (
    echo [*] Python virtual environment not found. Running initial setup...
    call setup_node.bat
)

pause
