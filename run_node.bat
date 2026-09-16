@echo off
cd /d "%~dp0"
git pull
backend\.venv\Scripts\python.exe stream_node.py %*
pause
