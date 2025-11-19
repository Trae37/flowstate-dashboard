@echo off
REM Launch Chrome with Remote Debugging for FlowState Dashboard
REM This enables tab capture functionality

echo Launching Chrome with remote debugging on port 9222...
echo.
echo This allows FlowState Dashboard to capture your browser tabs.
echo Close all Chrome windows first if Chrome is already running.
echo.

REM Try common Chrome installation paths
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
    echo Chrome started with remote debugging enabled.
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
    echo Chrome started with remote debugging enabled.
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
    echo Chrome started with remote debugging enabled.
) else (
    echo Chrome not found in common installation locations.
    echo Please manually launch Chrome with: chrome.exe --remote-debugging-port=9222
)

echo.
pause
