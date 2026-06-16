@echo off
REM Double-click this file (Windows) to launch the King vs Queen RL arena.
REM It runs the ONE all-in-one server: serves the page, trains both models live,
REM and opens your browser automatically. Close this window to stop.
cd /d "%~dp0"

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 (
    py --version >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=py"
)

if not defined PYTHON_CMD (
    where python >nul 2>nul
    if not errorlevel 1 (
        python --version >nul 2>nul
        if not errorlevel 1 set "PYTHON_CMD=python"
    )
)

if not defined PYTHON_CMD (
    echo Python is not installed or is not available from this terminal.
    echo Install Python from https://www.python.org/downloads/windows/
    echo Make sure "Add python.exe to PATH" is checked during installation.
    pause
    exit /b 1
)

%PYTHON_CMD% serve.py
pause
