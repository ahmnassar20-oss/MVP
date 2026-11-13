@echo off
title AI Football Performance Analyzer

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Python environment not found!
    echo Please run Setup_Football_Analyzer.bat first.
    pause
    exit /b
)

echo Starting AI Football Analyzer...

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8000/app/"

.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

pause
