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

REM Make sure required Python packages are installed. We only run pip when a
REM dependency is actually missing, so normal launches stay fast and offline.
%PYTHON_CMD% -c "import gymnasium" >nul 2>nul
if errorlevel 1 (
    echo Installing required Python packages from requirements.txt ...
    %PYTHON_CMD% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Failed to install the required packages.
        echo You can try running this manually: %PYTHON_CMD% -m pip install -r requirements.txt
        pause
        exit /b 1
    )
)

%PYTHON_CMD% serve.py
pause
