@echo off
title Grid World
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py
) else (
  py serve.py
)
pause
