# FlowState Self-Capture Prevention Fix

## Problem
The development terminal running `npm run dev:electron` was being filtered out during capture, even though it's a legitimate work terminal that should be captured.

## Root Cause
The self-capture prevention logic was **too aggressive**. It filtered out ANY terminal that:
1. Was in the `flowstate-dashboard` directory
2. Had `electron` or `flowstate` processes running

This meant:
- ❌ Development terminal with `npm run dev:electron` → FILTERED (bad!)
- ✅ FlowState Electron app window → FILTERED (good!)

**Result:** Users developing FlowState couldn't capture their own development terminals!

## Solution
Made the filtering **smarter** by distinguishing between:

### Before (Too Aggressive)
```typescript
const hasFlowStateProcess = runningProcs.some(p =>
  p.includes('flowstate') ||
  (p.includes('electron') && isFlowStateProject)
);
const isFlowStateSelf = isFlowStateProject && hasFlowStateProcess;
```
**Problem:** Filters BOTH dev server AND app window

### After (Smart Filtering)
```typescript
// Only filter if it's actually running the FlowState Electron APP (not dev server)
const isFlowStateApp = runningProcs.some(p =>
  p.includes('flowstate') && !p.includes('node') && !p.includes('npm')
);

// For Electron processes, distinguish dev server from app
const hasElectronApp = isFlowStateProject && runningProcs.some(p => {
  // If electron AND has node/npm → dev server → KEEP IT
  if (p.includes('electron') && (p.includes('node') || p.includes('npm'))) {
    return false;
  }
  // If electron without node/npm → app → FILTER IT
  return p.includes('electron') && !p.includes('node') && !p.includes('npm');
});

const isFlowStateSelf = isFlowStateApp || hasElectronApp;
```
**Solution:** Only filters the actual app, keeps dev servers

## How It Works

### Development Terminal (KEEP)
**Process Tree:**
```
PowerShell
  └─ node.exe (npm)
      └─ electron.exe (dev server)
```
**Detection:**
- Has `electron` in processes ✓
- Also has `node` or `npm` ✓
- **Result:** This is a dev server → **KEEP IT** ✓

### FlowState App Window (FILTER)
**Process Tree:**
```
PowerShell
  └─ flowstate.exe (standalone app)
```
**Detection:**
- Has `flowstate` in processes ✓
- NO `node` or `npm` ✓
- **Result:** This is the app → **FILTER IT** ✓

## Expected Behavior After Fix

### Scenario 1: Developing FlowState
**Open Terminals:**
1. Terminal running `npm run dev:electron` ← Development
2. Terminal running `npm run dev` ← Vite server
3. Terminal with Claude Code ← Work terminal
4. FlowState Electron App (opened from Terminal 1)

**Capture Results:**
- ✅ Terminal 1 (dev:electron) - CAPTURED
- ✅ Terminal 2 (dev) - CAPTURED
- ✅ Terminal 3 (Claude Code) - CAPTURED
- ❌ FlowState App Window - FILTERED (self-capture prevention)

### Scenario 2: Using FlowState Normally
**Open Terminals:**
1. Terminal with Claude Code in another project
2. Terminal running `npm start`
3. FlowState Electron App (standalone)

**Capture Results:**
- ✅ Terminal 1 (Claude Code) - CAPTURED
- ✅ Terminal 2 (npm start) - CAPTURED
- ❌ FlowState App - FILTERED (self-capture prevention)

## Testing
After restarting the Electron app, try capturing with:
1. The `npm run dev:electron` terminal open
2. Other work terminals
3. The FlowState app running

You should now see **4 terminals** captured instead of 3.

## Files Modified
- `src/main/terminal-capture.ts`
  - Updated self-capture detection logic (lines 530-547)
  - Updated filtering reason logging (lines 581-588)

## Benefits
- ✅ Can now develop FlowState while using FlowState
- ✅ Development terminals are properly captured
- ✅ Still prevents actual self-capture (app window)
- ✅ Clearer logging messages
