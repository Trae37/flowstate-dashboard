# IDE Capture & Restoration - Complete Implementation

## Overview
Comprehensive IDE capture and restoration for VS Code and Cursor, tracking workspace state, open files, and recent projects.

## Features Implemented

### ✅ Must-Have Features (All Implemented)

#### 1. Running IDE Detection
- **VS Code**: Detects `Code.exe` (Windows) or VS Code process (macOS)
- **Cursor**: Detects `Cursor.exe` (Windows) or Cursor process (macOS)
- **Process checking**: Uses `tasklist` (Windows) or `ps aux` (macOS) to verify IDE is running

**Code**: `ide-capture.ts:113-134`

#### 2. Open Workspace Paths
- Reads workspace storage from IDE state directories:
  - VS Code: `%APPDATA%\Code\User\workspaceStorage`
  - Cursor: `%APPDATA%\Cursor\User\workspaceStorage`
- Extracts `workspace.json` files to get currently open workspaces
- Supports both folders and multi-root workspaces

**Code**: `ide-capture.ts:193-213`

#### 3. Active Files
- Reads `state.vscdb` SQLite database from workspace storage
- Extracts `file:///` URIs to identify open files
- Filters for existing files only
- Removes duplicates

**Code**: `ide-capture.ts:216-233`

#### 4. Recent Workspaces
- Reads `globalStorage/storage.json` for workspace history
- Extracts last 10 recently opened workspaces/folders
- Supports various storage key formats:
  - `workbench.panel.recentlyOpenedWorkspaces`
  - `history.recentlyOpenedPathsList`
- Decodes `file://` URIs to filesystem paths

**Code**: `ide-capture.ts:172-190`

#### 5. Restoration Logic
- Opens IDE with original workspaces
- Tries `code`/`cursor` CLI commands first
- Falls back to executable paths if CLI not in PATH:
  - VS Code: `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`
  - Cursor: `%LOCALAPPDATA%\Programs\cursor\Cursor.exe`
- Opens workspaces in order of priority:
  1. Currently open workspaces
  2. First open file (if no workspace)

**Code**: `ide-capture.ts:246-293`

### ⏸️ Nice-to-Have Features (Not Yet Implemented)

#### 4. Cursor Positions in Files
- Would require parsing editor state JSON
- Would track line/column for each open file
- **Complexity**: Medium (30-45 min)
- **Value**: Low for MVP (nice to have but not critical)

#### 5. Split Editor Layout
- Would require parsing layout state
- Would restore split views and tab groups
- **Complexity**: High (1-2 hours)
- **Value**: Medium (UX improvement)

#### 6. Terminal Tabs Within IDE
- Already captured separately by terminal-capture.ts
- Integrated terminals filtered out (parent process = IDE)
- **Status**: Covered by terminal restoration

#### 7. Extensions Running
- Would require parsing extensions state
- Would need extension installation on restore
- **Complexity**: High (2+ hours)
- **Value**: Low (extensions typically persist across sessions)

---

## Architecture

### File Structure

```
src/main/
  ├── ide-capture.ts      # New: Comprehensive IDE capture/restore
  ├── capture.ts          # Updated: Uses ide-capture.ts
  └── restore.ts          # Updated: Uses ide-capture.ts
```

### Data Flow

#### Capture Flow
```
1. User triggers capture
2. capture.ts calls captureVSCodeSessions()
3. captureVSCodeSessions() imports ide-capture.ts
4. ide-capture.ts detects running IDEs
5. For each IDE:
   a. Read state directory
   b. Parse workspace storage
   c. Extract open files from state.vscdb
   d. Read recent workspaces from globalStorage
6. Return IDESession objects
7. capture.ts creates assets with metadata
8. Save to database
```

#### Restore Flow
```
1. User triggers restore
2. restore.ts loads code assets
3. restoreCodeAsset() checks metadata for IDE info
4. If IDE session found:
   a. Import ide-capture.ts
   b. Call restoreIDESession()
   c. Open IDE with workspace paths
5. If not IDE session (legacy):
   a. Fallback to simple file opening
```

---

## State Files Used

### VS Code / Cursor State Locations

**Windows**:
- VS Code: `%APPDATA%\Code\User`
- Cursor: `%APPDATA%\Cursor\User`

**macOS**:
- VS Code: `~/Library/Application Support/Code/User`
- Cursor: `~/Library/Application Support/Cursor/User`

### Key Files Parsed

#### 1. `globalStorage/storage.json`
**Purpose**: Recent workspaces history

**Example Structure**:
```json
{
  "history.recentlyOpenedPathsList": {
    "entries": [
      {
        "folderUri": "file:///C:/Users/User/project1",
        "label": "project1"
      },
      {
        "folderUri": "file:///C:/Users/User/project2"
      }
    ]
  }
}
```

**What We Extract**:
- `folderUri` from each entry
- Decode file:// URIs to paths
- Take last 10 entries

#### 2. `workspaceStorage/{id}/workspace.json`
**Purpose**: Currently open workspace info

**Example Structure**:
```json
{
  "folder": "file:///C:/Users/User/active-project"
}
```

**What We Extract**:
- `folder` field
- Decode to filesystem path

#### 3. `workspaceStorage/{id}/state.vscdb`
**Purpose**: Open editors/files

**What We Do**:
- Read as text (it's a SQLite DB but we extract URIs via regex)
- Match `file:///...` patterns
- Decode URIs to paths
- Verify files exist

---

## URI Decoding

VS Code/Cursor store paths as `file://` URIs. We decode them:

**Examples**:
```
file:///C:/Users/User/project
→ C:\Users\User\project

file:///home/user/project
→ /home/user/project
```

**Code**: `ide-capture.ts:238-257`

---

## Restoration Examples

### Example 1: Cursor with Workspace
**Captured**:
```json
{
  "ideName": "Cursor",
  "workspacePaths": ["C:\\Users\\User\\flowstate-dashboard"],
  "openFiles": [
    { "path": "C:\\Users\\User\\flowstate-dashboard\\src\\main\\capture.ts" },
    { "path": "C:\\Users\\User\\flowstate-dashboard\\src\\main\\restore.ts" }
  ],
  "recentWorkspaces": [
    "C:\\Users\\User\\flowstate-dashboard",
    "C:\\Users\\User\\the-foundry"
  ]
}
```

**Restoration Command**:
```bash
cursor "C:\Users\User\flowstate-dashboard"
```

**Result**: Cursor opens with the flowstate-dashboard workspace, files may auto-reopen based on Cursor's own state management.

### Example 2: VS Code with Multiple Files
**Captured**:
```json
{
  "ideName": "VSCode",
  "workspacePaths": [],
  "openFiles": [
    { "path": "C:\\Users\\User\\Documents\\notes.md" },
    { "path": "C:\\Users\\User\\Desktop\\script.js" }
  ]
}
```

**Restoration Command**:
```bash
code "C:\Users\User\Documents\notes.md"
```

**Result**: VS Code opens the first file. User can access other files via recent files menu.

---

## Integration with Existing Capture

The IDE capture integrates seamlessly with existing FlowState components:

### Capture Integration
```typescript
// capture.ts creates 4 types of assets:
const captureSteps = [
  { key: 'vsCode', runner: captureVSCodeSessions },   // ← Enhanced
  { key: 'terminal', runner: captureTerminalSessions },
  { key: 'browser', runner: captureBrowserTabs },
  { key: 'notes', runner: captureNoteSessions },
];
```

### Restore Integration
```typescript
// restore.ts order:
1. Terminals (including Claude Code)
2. Wait for Claude Code init
3. IDEs (VS Code/Cursor)           // ← Added
4. Notes
5. Browsers (visual assets last)
```

---

## Testing

### Manual Test Steps

1. **Capture Test**:
   ```
   1. Open Cursor with flowstate-dashboard workspace
   2. Have 2-3 files open
   3. Trigger FlowState capture
   4. Check database: Should see code asset with metadata
   ```

2. **Restore Test**:
   ```
   1. Close Cursor
   2. Trigger FlowState restore
   3. Verify: Cursor opens with flowstate-dashboard workspace
   ```

### What to Verify

#### Capture
- ✅ IDE detected as running
- ✅ Workspace path captured
- ✅ Open files listed (check metadata)
- ✅ Recent workspaces listed

#### Restore
- ✅ IDE opens with correct workspace
- ✅ No errors in console
- ✅ Workspace folder structure loads

---

## Known Limitations

### 1. Cursor Positions Not Preserved
- Files reopen but cursor position is not tracked
- IDE's own state management may restore positions
- **Impact**: Minor UX issue

### 2. Editor Layout Not Preserved
- Split views not captured
- Tab groups not preserved
- **Impact**: Medium UX issue, but not critical for MVP

### 3. Terminal Tabs Within IDE Not Captured
- These are filtered out during terminal capture (parent = IDE)
- **Workaround**: Use external Windows Terminal for dev work
- **Impact**: Known design decision

### 4. State File Format Changes
- VS Code/Cursor may change state file formats in updates
- **Mitigation**: Graceful fallbacks if parsing fails
- **Impact**: Potential maintenance burden

---

## Future Enhancements

### P1 - Next Release
- [ ] Capture cursor positions in files
- [ ] Capture editor split layout
- [ ] Add VS Code Insiders support
- [ ] Add JetBrains IDEs (IntelliJ, WebStorm, etc.)

### P2 - Nice to Have
- [ ] Extension state capture/restore
- [ ] Terminal tabs within IDE (if needed)
- [ ] Theme/settings preservation
- [ ] Window size/position

---

## Troubleshooting

### IDE Not Detected
**Symptom**: Capture shows 0 IDE sessions
**Causes**:
1. IDE not running
2. Process name mismatch

**Fix**:
- Check Task Manager for `Code.exe` or `Cursor.exe`
- Verify state directory exists

### Workspace Not Opening
**Symptom**: IDE opens but wrong workspace
**Causes**:
1. Workspace path no longer exists
2. CLI command not in PATH

**Fix**:
- Check logs for "workspace path no longer exists"
- Verify `code`/`cursor` command works in terminal

### No Files Captured
**Symptom**: Workspace captured but openFiles empty
**Causes**:
1. state.vscdb not readable
2. No files were open during capture

**Fix**:
- Not critical - workspace still restores
- User can reopen files manually

---

**Implementation Complete**: 2025-11-18
**Files Created**: `src/main/ide-capture.ts` (293 lines)
**Files Modified**: `src/main/capture.ts`, `src/main/restore.ts`
**Build Status**: ✅ Successful
**Test Status**: ⏸️ Ready for manual testing
