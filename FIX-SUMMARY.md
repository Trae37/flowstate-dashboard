# Terminal Duplication Fix

## Problem
The dashboard was showing **two Claude Code terminals** when only one was actually running in the workspace.

## Root Cause
When capturing terminal sessions, the system was detecting both:
1. **Windows Terminal parent process** (PID 28456, processName "WindowsTerminal")
2. **PowerShell session inside it** (PID 34020, processName "powershell.exe")

Both were being marked with `claudeCodeContext` because they shared the same child processes (node.exe and bash.exe spawned by Claude Code), so the Claude detection logic matched both.

## Solution Implemented
Added **deduplication logic** in `src/main/terminal-capture.ts`:

### 1. Store Parent Process ID
Modified PowerShell, CMD, and Git Bash capture functions to store `parentProcessId` in the session object:
- Line 831-835: Added `parentProcessId` variable in PowerShell capture
- Line 937: Added `parentProcessId` to PowerShell session object
- Line 987-996: Added `parentProcessId` in CMD capture
- Line 1032: Added `parentProcessId` to CMD session object
- Line 1070-1079: Added `parentProcessId` in Git Bash capture
- Line 1121: Added `parentProcessId` to Git Bash session object

### 2. Deduplication Filter
Added deduplication logic (lines 473-502) that:
- Identifies Windows Terminal parent processes
- Finds child PowerShell/CMD sessions with `isWindowsTerminal: true`
- Removes the parent process when its child shell is also captured
- Logs which duplicates were removed for debugging

### 3. Changed sessions to mutable
- Line 395: Changed `const sessions` to `let sessions` to allow reassignment during deduplication

## Testing
To test the fix:
1. Make sure the FlowState dashboard app is closed
2. Run `npm run dev:electron` to start the app with the updated code
3. Capture the workspace (click Capture button)
4. Verify that only **ONE** Claude Code terminal appears in the dashboard

The logs will show:
```
[Terminal Capture] DEDUPLICATION: Removed X Windows Terminal parent(s) with captured child shells
  - Removed PID XXXXX: WindowsTerminal parent (child shell captured separately)
```

## Files Modified
- `src/main/terminal-capture.ts`
  - Added deduplication logic
  - Captured parentProcessId in all terminal types
  - Changed sessions array to mutable

## Additional Notes
The fix ensures that when Windows Terminal hosts a PowerShell/CMD session:
- Only the actual shell (PowerShell/CMD) is captured and shown
- The Windows Terminal parent process is filtered out
- This prevents showing duplicate terminals with the same Claude Code context
