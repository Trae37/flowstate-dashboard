# Terminal Detection Fixes - Summary

## Problem Statement
FlowState Dashboard was only detecting 3 out of 5 Windows Terminal tabs in the user's workspace. The terminals were:
1. Claude Code terminal (not detected)
2. Regular terminal with no history (detected ✓)
3. Electron recovery terminal (not detected)
4. Electron recovery terminal (not detected)
5. Current Claude Code terminal (not detected)

## Root Causes Identified

### 1. **Windows Terminal Children Have No Window Handles**
Windows Terminal child processes (PowerShell running in tabs) don't have their own `MainWindowHandle`. The window handle belongs to the parent Windows Terminal process, not the child shells.

**Impact:** All Windows Terminal tabs were being filtered as "background processes" because:
- `MainWindowHandle = 0`
- `MainWindowTitle = ""` (empty)

### 2. **Orphaned Terminals Were Being Filtered**
Terminals with dead/unknown parents (e.g., from closed Electron apps) were being filtered even though they're still visible Windows Terminal tabs.

**Impact:** The 2 electron recovery terminals (PIDs 20124, 44264) were filtered as "no visible window."

### 3. **IDE Shell Integration Was Too Aggressive**
The previous fix added filtering for Cursor/VSCode shell integration scripts, but it filtered ALL terminals with shell integration, even orphaned ones.

**Impact:** Windows Terminal tabs that previously ran in Cursor (but are now standalone) were being filtered incorrectly.

## Fixes Applied

### Fix #1: Recognize Windows Terminal Children as Visible
**File:** `src/main/terminal-capture.ts` (lines 515-535)

**Before:**
```typescript
const hasWindow = !!session.windowTitle ||
                  !!(metadata.mainWindowHandle && metadata.mainWindowHandle !== 0);
```

**After:**
```typescript
// Check if this session is running inside Windows Terminal
const isWindowsTerminalChild = parentName.includes('windowsterminal') ||
                                parentName === 'wt' ||
                                parentCmd.includes('windowsterminal') ||
                                session.isWindowsTerminal;

// A terminal has a window if:
// 1. It has a window title OR a non-zero window handle, OR
// 2. It's a child of Windows Terminal (visible tab even without own window handle), OR
// 3. It's running an active command (even if parent is unknown, it's likely a user terminal)
const hasWindow = !!session.windowTitle ||
                  !!(metadata.mainWindowHandle && metadata.mainWindowHandle !== 0) ||
                  isWindowsTerminalChild ||
                  hasActiveCommand;
```

**Why:** Windows Terminal tabs ARE visible terminals even though the PowerShell child doesn't have its own window handle.

---

### Fix #2: Detect Active Commands in Orphaned Terminals
**File:** `src/main/terminal-capture.ts` (lines 522-530)

**Added:**
```typescript
// Check if this terminal is running an active long-running command
// Check both parent command line AND the process's own command line
const ownCmd = (metadata.ownCommandLine?.toLowerCase() || '');
const hasActiveCommand = parentCmd.includes('npm run') ||
                         parentCmd.includes('node ') ||
                         ownCmd.includes('npm run') ||
                         ownCmd.includes('node ') ||
                         (session.runningProcesses && session.runningProcesses.length > 0);
```

**Why:** Terminals running dev servers or npm scripts (even with dead parents) are legitimate user terminals that should be captured.

---

### Fix #3: Capture Process's Own Command Line
**File:** `src/main/terminal-capture.ts` (lines 935-946, 1013)

**Added:**
```typescript
// Get the PowerShell process's own command line
let ownCommandLine: string | undefined;
try {
  const ownCmdResult = await execPromise(
    `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`
  ).catch(() => ({ stdout: '' }));
  ownCommandLine = ownCmdResult.stdout?.trim();
} catch (err: any) {
  console.log(`[DEBUG Capture] PowerShell PID ${pid}: Failed to get own command line:`, err?.message);
}

// Store in session object
sessions.push({
  // ... other fields ...
  ownCommandLine: ownCommandLine || undefined,
} as any);
```

**Why:** We need the process's own command line to detect:
1. Terminals launched with commands like `powershell -Command "npm run dev"`
2. IDE shell integration scripts (to avoid false positives)

---

### Fix #4: Only Filter IDE Terminals with Active IDE Parent
**File:** `src/main/terminal-capture.ts` (lines 551-558)

**Before:**
```typescript
// Old code filtered ANY terminal with shell integration
const ideShellIntegration = ownCmd.includes('cursor') && ownCmd.includes('shellintegration') ||
                             ownCmd.includes('vscode') && ownCmd.includes('shellintegration');
const isIdeChild = ideNames.some(ide =>
  parentName.includes(ide) || parentCmd.includes(ide)
) || ideShellIntegration;  // ← This was the problem
```

**After:**
```typescript
// Check if parent is an IDE
// NOTE: We only filter based on parent process, NOT shell integration.
// Orphaned terminals may have IDE shell integration loaded but should still be captured
// (e.g., Windows Terminal tabs that previously ran in Cursor but parent died)
const isIdeChild = ideNames.some(ide =>
  parentName.includes(ide) ||
  parentCmd.includes(ide)
);
```

**Why:** Terminals with shell integration but no active IDE parent are standalone terminals (e.g., moved from Cursor to Windows Terminal, or parent died).

---

## Expected Results After Fixes

### Terminals That SHOULD Be Detected (5 total):
1. ✅ **PID 26972** - Windows Terminal tab, regular terminal
   - Parent: WindowsTerminal → `isWindowsTerminalChild = true` → `hasWindow = true`
2. ✅ **PID 44264** - Windows Terminal tab, electron recovery
   - Has Cursor shell integration BUT parent is dead → `isIdeChild = false` → NOT filtered
   - Has active processes → `hasActiveCommand = true` → `hasWindow = true`
3. ✅ **PID 20124** - Windows Terminal tab, electron recovery
   - Same as #2
4. ✅ **PID 11553** - Windows Terminal tab, Claude Code
   - Parent: WindowsTerminal → detected
5. ✅ **Current terminal** - Windows Terminal tab, Claude Code
   - Parent: WindowsTerminal → detected

### Terminals That SHOULD Be Filtered (9 Cursor IDE terminals):
- All terminals with parent = Cursor → `isIdeChild = true` → filtered correctly

## Testing

To test these fixes:

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Run the FlowState Dashboard app**

3. **Trigger a terminal capture** and check the logs for:
   ```
   [Terminal Capture] Total sessions collected: X
   [Terminal Capture] DEFAULT FILTERING: Filtered Y non-standalone terminal(s)
   ```

4. **Expected outcome:**
   - Should detect ~5 standalone terminals (the Windows Terminal tabs)
   - Should filter ~9 Cursor IDE terminals
   - Should NOT filter orphaned Windows Terminal tabs

## Files Modified
- `src/main/terminal-capture.ts` (main fix)

## Diagnostic Scripts Created
- `debug-terminal-detection.ps1` - Diagnoses which terminals will be detected
- `identify-terminals.ps1` - Shows all standalone terminals with metadata
- `check-visible-windows.ps1` - Checks which processes have actual visible windows
- `check-wt-children.ps1` - Shows all Windows Terminal child processes
- `what-process-am-i.ps1` - Identifies current terminal's PID and parent

## Notes

- Windows Terminal tabs do NOT have their own window handles - the parent Windows Terminal process owns the window
- Orphaned terminals (dead parent) should still be captured if they're in Windows Terminal
- IDE shell integration alone is not a reason to filter - only filter if parent is actively an IDE
- The "hasActiveCommand" check helps identify legitimate user terminals even when parent is unknown
