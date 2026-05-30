@echo off
REM Starts the Rico Net scraper scheduler in the background.
REM Registered with Windows Task Scheduler "At log on" so it survives reboots.
REM Logs go to scheduler.log in this directory.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
start "" /B python scheduler.py
