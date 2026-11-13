@echo off
title Setup - AI Football Performance Analyzer
cd /d "%~dp0"
echo Creating virtual environment...
py -m venv .venv
if errorlevel 1 (
    echo Python not found. Install Python 3.10-3.12 from python.org and tick "Add to PATH".
    pause
    exit /b
)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
echo.
echo Setup finished. Now run Start_Football_Analyzer.bat
pause
