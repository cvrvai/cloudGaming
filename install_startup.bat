@echo off
title Install CloudKH 24/7 Autostart on Windows Boot
cd /d "%~dp0"

echo ============================================================
echo   Install CloudKH Node into Windows Startup (24/7 Always On)
echo ============================================================
echo.

set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CloudKH_Node.lnk"
set "TARGET_BAT=%~dp0run_node.bat"
set "WORKING_DIR=%~dp0"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_BAT%'; $s.WorkingDirectory = '%WORKING_DIR%'; $s.WindowStyle = 7; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo [OK] CloudKH Node has been added to Windows Startup!
    echo.
    echo The streaming daemon will now automatically launch whenever this PC powers on or reboots.
    echo Location: "%SHORTCUT_PATH%"
) else (
    echo [!] Failed to create startup shortcut.
)

echo.
pause
