@echo off
cd /d "%~dp0"
backend\.venv\Scripts\python.exe stream_node.py %*
pause
