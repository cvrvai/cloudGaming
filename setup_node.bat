@echo off
setlocal enabledelayedexpansion
title CloudKH Gaming PC Node Setup
cd /d "%~dp0"

echo ============================================================
echo   CloudKH Gaming PC Node Setup ^& Launcher
echo ============================================================
echo.

:: 1. Check Python
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    where py >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [!] ERROR: Python 3 was not found on this system.
        echo [*] Please install Python 3.10+ from https://www.python.org/downloads/
        echo [*] IMPORTANT: Ensure you check "Add python.exe to PATH" during installation.
        echo.
        pause
        exit /b 1
    ) else (
        set PYTHON_CMD=py -3
    )
) else (
    set PYTHON_CMD=python
)

:: 2. Setup Virtual Environment
if not exist "backend\.venv\Scripts\python.exe" (
    echo [*] Creating Python virtual environment (backend\.venv)...
    %PYTHON_CMD% -m venv backend\.venv
    if %ERRORLEVEL% NEQ 0 (
        echo [!] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [*] Installing required streaming dependencies...
    backend\.venv\Scripts\python.exe -m pip install --upgrade pip
    backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    if %ERRORLEVEL% NEQ 0 (
        echo [!] Warning: Some dependencies failed to install. Continuing...
    )
) else (
    echo [*] Python virtual environment detected.
)

:: 3. Check GStreamer
set GST_FOUND=0
if exist "%LOCALAPPDATA%\Programs\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe" set GST_FOUND=1
if exist "C:\Program Files\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe" set GST_FOUND=1
if exist "C:\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe" set GST_FOUND=1

if "!GST_FOUND!"=="0" (
    echo.
    echo [!] NOTE: GStreamer 1.0 (MSVC 64-bit) was not detected.
    echo [*] For 60 FPS DirectX 11 screen capture, please download and install:
    echo     https://gstreamer.freedesktop.org/data/pkg/windows/
    echo     (Install both the 'msvc_x86_64' Runtime and Development .msi packages)
    echo.
) else (
    echo [*] GStreamer DirectX 11 capture pipeline detected.
)

:: 4. Launch or Pair
if exist ".node_config.json" (
    echo [*] Saved PC configuration found. Starting streaming node...
    backend\.venv\Scripts\python.exe -u stream_node.py
) else (
    echo.
    echo ------------------------------------------------------------
    echo   PAIR THIS GAMING PC WITH CLOUDKH
    echo ------------------------------------------------------------
    echo   1. Log into your Admin Dashboard: https://cloudkh.space
    echo   2. Navigate to "Fleet Rigs" and click "+ Pair Gaming PC"
    echo   3. Enter the 6-digit Pairing Code generated on screen:
    echo.
    set /p PAIR_CODE="Enter 6-digit Pairing Code (e.g. 123-456): "
    if "!PAIR_CODE!"=="" (
        echo [!] No code entered. You can run setup_node.bat again when you have a code.
        pause
        exit /b 1
    )
    echo.
    echo [*] Pairing this PC with CloudKH backend...
    backend\.venv\Scripts\python.exe -u stream_node.py --api https://api.cloudkh.space --code !PAIR_CODE!
)

pause
