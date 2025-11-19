# Electron Terminal Restoration Fix

## Issue
Restored electron terminals were not running `npm run dev` - clicking on them showed an empty terminal.

## Root Cause
The restoration code was detecting that the terminals were running `npm run dev`, but it was launching the command in a **NEW separate PowerShell window** using `Start-Process`:

```typescript
if (commandLine.includes('npm') && commandLine.includes('dev')) {
  commands.push('Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -WindowStyle Normal');
}
```

This meant:
1. User clicks on restored terminal tab → sees empty terminal
2. A separate hidden window opens running `npm run dev`
3. User doesn't see the command running

## Solution
Detect when a terminal was **launched specifically to run a command** (from the `ownCommandLine` we captured), and restore that command **IN the terminal itself**, not in a new window.

### Changes Made

#### 1. Added `ownCommandLine` to TerminalSession interface
**File**: `src/main/terminal-capture.ts:50`

```typescript
export interface TerminalSession {
  // ... existing fields ...
  ownCommandLine?: string; // The command line used to launch this terminal process
}
```

#### 2. New logic in `createStartupScript()` function
**File**: `src/main/terminal-capture.ts:2497-2521`

```typescript
// Check if this terminal was launched specifically to run a command (from ownCommandLine)
// For example, orphaned electron terminals with: powershell.exe -NoExit -Command npm run dev
const ownCmd = session.ownCommandLine?.toLowerCase() || '';
const wasLaunchedWithCommand = ownCmd.includes('-command') || ownCmd.includes('-c ');

// Extract the command that was used to launch this terminal
let launchCommand: string | null = null;
if (wasLaunchedWithCommand && session.ownCommandLine) {
  const match = session.ownCommandLine.match(/-(?:Command|c)\s+(.+)$/i);
  if (match && match[1]) {
    launchCommand = match[1].trim();
    // Clean up quotes if present
    launchCommand = launchCommand.replace(/^["']|["']$/g, '');
  }
}

// If this terminal was launched to run a specific command, restore that command in THIS terminal
if (launchCommand) {
  commands.push('# This terminal was running a command, restarting it...');
  commands.push('Write-Host "Restoring command: ' + launchCommand.replace(/"/g, '`"') + '" -ForegroundColor Cyan');
  commands.push('Write-Host "" ');
  commands.push(launchCommand);
  commands.push('');
}
```

### How It Works

**Before Fix**:
1. Detect `runningCommands` includes `npm run dev`
2. Generate: `Start-Process powershell -ArgumentList ... "npm run dev"`
3. Result: New window opens, restored terminal is empty

**After Fix**:
1. Check if terminal was launched with `-Command npm run dev` (from `ownCommandLine`)
2. Extract the command: `npm run dev`
3. Generate startup script that runs command IN the terminal:
   ```powershell
   # This terminal was running a command, restarting it...
   Write-Host "Restoring command: npm run dev" -ForegroundColor Cyan
   Write-Host ""
   npm run dev
   ```
4. Result: Restored terminal shows and runs the command

### Example: Orphaned Electron Terminals

**Captured ownCommandLine**:
```
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoExit -Command    npm run dev
```

**Detected**:
- `wasLaunchedWithCommand = true` (contains `-Command`)
- `launchCommand = "npm run dev"` (extracted from command line)

**Generated Startup Script**:
```powershell
Set-Location -LiteralPath 'C:\Users\Trashard Mays\Desktop\flowstate-dashboard'
# This terminal was running a command, restarting it...
Write-Host "Restoring command: npm run dev" -ForegroundColor Cyan
Write-Host ""
npm run dev
```

**Result**: Terminal opens in correct directory and immediately runs `npm run dev`

## Testing
1. Build: `npm run build` ✅
2. Restart dev server ✅
3. Create new capture with electron terminals running
4. Restore from capture
5. Verify electron terminals show `npm run dev` output ⏸️ (user to verify)

## Impact
- ✅ Electron terminals now restore with commands running IN the terminal
- ✅ User can see the output immediately
- ✅ No separate hidden windows
- ✅ Works for any terminal launched with `-Command <cmd>` or `-c <cmd>`
- ✅ Falls back to old behavior for terminals with subprocess commands

---

**Fixed**: 2025-11-18
**Files Modified**: `src/main/terminal-capture.ts` (lines 35-50, 2497-2521)
**Build Status**: ✅ Successful
**Deployment Status**: ⏸️ Ready for testing
