@echo off
REM Seamless Scraper Startup (Windows)
REM Starts: Sync Daemon + Scheduler + Dashboard API

cd /d "%~dp0"

echo.
echo ===============================================================================
echo   RICO NET SCRAPER - SEAMLESS STARTUP
echo ===============================================================================
echo.

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Install Python 3.10+ and add to PATH.
    pause
    exit /b 1
)

REM Check requirements
echo Checking dependencies...
pip show playwright >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing requirements...
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install requirements
        pause
        exit /b 1
    )
)

echo.
echo Starting components...
echo.

REM Start Sync Daemon in new window
echo [1/3] Starting Sync Daemon...
start "Sync Daemon" python sync_daemon.py

REM Wait a moment
timeout /t 2 /nobreak

REM Start Scheduler in new window
echo [2/3] Starting Scheduler...
start "Scheduler" python scheduler.py

REM Wait a moment
timeout /t 2 /nobreak

REM Start Dashboard in main window
echo [3/3] Starting Dashboard API...
echo.
echo ===============================================================================
echo   SCRAPER STARTED!
echo ===============================================================================
echo.
echo   Dashboard:  http://localhost:5005
echo   Sync:       Running (logs in sync_daemon.log)
echo   Scheduler:  Running (logs in scheduler.log)
echo.
echo   Three windows should have opened. Minimize them and use the Dashboard above.
echo   Press Ctrl+C in any window to stop that component.
echo.
echo ===============================================================================
echo.

python -m uvicorn dashboard:app --host 0.0.0.0 --port 5005 --reload

pause
