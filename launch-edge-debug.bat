@echo off
REM Launch Microsoft Edge with Remote Debugging for FlowState Dashboard
REM This enables tab capture functionality

echo Launching Microsoft Edge with remote debugging on port 9222...
echo.
echo This allows FlowState Dashboard to capture your browser tabs.
echo Close all Edge windows first if Edge is already running.
echo.

REM Try common Edge installation paths
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9223
    echo Edge started with remote debugging enabled on port 9223.
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9223
    echo Edge started with remote debugging enabled on port 9223.
) else if exist "%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9223
    echo Edge started with remote debugging enabled on port 9223.
) else (
    echo Edge not found in common installation locations.
    echo Please manually launch Edge with: msedge.exe --remote-debugging-port=9222
)

echo.
pause
