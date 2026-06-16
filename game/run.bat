@echo off
REM Double-click this file (Windows) to launch the King vs Queen RL arena.
REM It runs the ONE all-in-one server: serves the page, trains both models live,
REM and opens your browser automatically. Close this window to stop.
cd /d "%~dp0"
python serve.py
pause
