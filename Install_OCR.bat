@echo off
title Install OCR - AI Football Performance Analyzer
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Python environment not found. Run Setup_Football_Analyzer.bat first.
    pause
    exit /b
)
echo Installing EasyOCR (large download, please wait)...
.venv\Scripts\python.exe -m pip install "easyocr>=1.7"
if errorlevel 1 (
    echo.
    echo Installation FAILED. Copy the error above and send it.
    pause
    exit /b
)
echo.
echo Done. Close the server window if open, then run Start_Football_Analyzer.bat
pause
