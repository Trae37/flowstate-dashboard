@echo off
REM Launch Brave with Remote Debugging for FlowState Dashboard
REM This enables tab capture functionality

echo Launching Brave with remote debugging on port 9222...
echo.
echo This allows FlowState Dashboard to capture your browser tabs.
echo Close all Brave windows first if Brave is already running.
echo.

REM Try common Brave installation paths
if exist "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222
    echo Brave started with remote debugging enabled.
) else if exist "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222
    echo Brave started with remote debugging enabled.
) else if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222
    echo Brave started with remote debugging enabled.
) else (
    echo Brave not found in common installation locations.
    echo Please manually launch Brave with: brave.exe --remote-debugging-port=9222
)

echo.
pause
