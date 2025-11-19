# End-to-End Restoration Test Plan

## Purpose
Validate that the complete FlowState Dashboard capture → restore → Claude Code recovery workflow works reliably across different scenarios and edge cases.

## Current Status
- ✅ Terminal detection: Successfully detects all 5 workspace terminals
- ✅ Terminal capture: Captures terminal metadata (PID, shell type, directory, etc.)
- ⚠️ Context file restoration: Partially validated (one successful example)
- ❓ Visual assets restoration: Not yet tested
- ❓ Full workflow integration: Not yet tested end-to-end

---

## Test Scenarios

### Scenario 1: Basic Workspace Restoration
**Description**: Capture and restore the current 5-terminal workspace

**Current Workspace State**:
- Tab 1: Claude Code terminal (PID unknown - current terminal)
- Tab 2: Windows Terminal - no command history (PID 26972)
- Tab 3: Electron terminal running `npm run dev` (PID 20124)
- Tab 4: Electron terminal running `npm run dev` (PID 44264)
- Tab 5: Claude Code terminal (PID varies)

**Test Steps**:
1. Create a FlowState capture with current workspace
2. Verify capture file contains all 5 terminals
3. Close all Windows Terminal tabs
4. Trigger restoration from the capture
5. Verify all 5 terminals restore correctly
6. Verify terminal working directories are correct
7. Verify Electron terminals restart with `npm run dev`
8. Verify Claude Code terminals receive context file

**Expected Results**:
- ✅ 5 terminals restored in Windows Terminal
- ✅ Each terminal has correct shell type (PowerShell/Core)
- ✅ Each terminal opens in correct working directory
- ✅ Electron terminals automatically run `npm run dev`
- ✅ Claude Code terminals display context file prompt
- ✅ Terminal order/arrangement preserved

**Success Criteria**: All terminals restore with correct state and commands

---

### Scenario 2: Claude Code Context Restoration
**Description**: Validate Claude Code receives and processes context files correctly

**Test Steps**:
1. Start Claude Code conversation in terminal
2. Exchange several messages to build context
3. Create FlowState capture
4. Close the Claude Code terminal
5. Restore from capture
6. Check if Claude Code terminal shows context file prompt
7. Verify context file contains conversation history

**Expected Results**:
- ✅ Context file created in temp directory
- ✅ Context file contains:
  - Conversation history
  - Working directory
  - Recent files accessed
  - Project structure
- ✅ Restored Claude Code terminal shows: `Read <context-file> and continue where we left off`
- ✅ User can read the context file to resume work

**Success Criteria**: Claude Code terminals can seamlessly resume conversations

---

### Scenario 3: Mixed Terminal Types
**Description**: Test restoration with different shell types and states

**Workspace Configuration**:
- 2 PowerShell Classic terminals
- 2 PowerShell Core (pwsh) terminals
- 1 terminal running long-running command
- 1 idle terminal with command history
- 1 freshly opened terminal (no history)

**Test Steps**:
1. Open terminals with different shell types
2. Execute various commands in each
3. Leave one terminal running a command
4. Create capture
5. Restore and verify each terminal type

**Expected Results**:
- ✅ PowerShell Classic terminals restore correctly
- ✅ PowerShell Core terminals restore correctly
- ✅ Command history preserved where applicable
- ✅ Long-running commands restart in correct terminals
- ✅ Idle terminals restore without errors

**Success Criteria**: All shell types restore with correct environment

---

### Scenario 4: Visual Assets Restoration
**Description**: Test Electron apps and browsers restore after Claude Code

**Setup**:
- 2 Claude Code terminals
- 2 Electron apps running (flowstate-dashboard dev servers)
- Optional: Browser tabs with specific URLs

**Test Steps**:
1. Create capture with Claude Code + Electron apps
2. Close all terminals and apps
3. Restore from capture
4. Monitor restoration order

**Expected Results**:
- ✅ Claude Code terminals initialize FIRST
- ✅ User sees context file prompts immediately
- ✅ Electron apps launch AFTER Claude Code is ready
- ✅ Electron apps open with correct state
- ✅ No delays or blocking during Claude Code initialization

**Success Criteria**: Visual assets don't block Claude Code from initializing

---

### Scenario 5: Orphaned Terminal Handling
**Description**: Validate script-launched terminals with dead parents restore correctly

**Current Issue**: PIDs 20124 and 44264 have dead parents but are visible in Windows Terminal

**Test Steps**:
1. Create capture with orphaned terminals (electron dev servers)
2. Verify capture detects them despite dead parents
3. Close all terminals
4. Restore and verify orphaned terminals recreate correctly

**Expected Results**:
- ✅ Orphaned terminals detected in capture
- ✅ Restoration recreates them with new parent processes
- ✅ Commands restart correctly (`npm run dev`)
- ✅ Working directories preserved

**Success Criteria**: Orphaned terminals restore as if they were normal terminals

---

### Scenario 6: Error Handling and Edge Cases
**Description**: Test failure modes and recovery mechanisms

**Edge Cases to Test**:

**A. Missing Working Directory**
- Terminal in deleted directory
- Expected: Restore to fallback directory (user home)

**B. Command Failure**
- Terminal running command that fails on restart
- Expected: Show error, don't block other restorations

**C. Permission Issues**
- Terminal in directory without read permissions
- Expected: Graceful fallback, log error

**D. Claude Code Not Installed**
- System without Claude Code binary
- Expected: Skip Claude Code launch, restore other terminals

**E. Partial Restoration**
- Some terminals fail to restore
- Expected: Continue with successful restorations, report failures

**Test Steps**:
1. Create scenarios for each edge case
2. Attempt restoration
3. Verify graceful degradation
4. Check error logging

**Expected Results**:
- ✅ Errors don't crash the restoration process
- ✅ Successful restorations complete
- ✅ Clear error messages for failures
- ✅ User notified of partial restorations

**Success Criteria**: System handles errors gracefully without data loss

---

## Test Execution Plan

### Phase 1: Baseline Testing (Today)
1. ✅ Verify terminal detection (COMPLETED - 5/5 terminals detected)
2. Test Scenario 1: Basic workspace restoration
3. Test Scenario 2: Claude Code context restoration

### Phase 2: Advanced Testing
4. Test Scenario 3: Mixed terminal types
5. Test Scenario 4: Visual assets restoration order
6. Test Scenario 5: Orphaned terminal handling

### Phase 3: Edge Cases and Hardening
7. Test Scenario 6: Error handling
8. Document all edge cases discovered
9. Add error handling for common failures

### Phase 4: Integration and Polish
10. End-to-end workflow validation
11. Performance testing (time to restore)
12. User experience refinements

---

## Success Metrics

**Must Have**:
- [ ] 95%+ terminal restoration success rate
- [ ] Claude Code terminals receive context files 100% of time
- [ ] Zero blocking delays during Claude Code initialization
- [ ] Clear error messages for all failure cases

**Nice to Have**:
- [ ] Restoration completes in < 5 seconds for 5 terminals
- [ ] Window positions/sizes preserved
- [ ] Terminal tab order preserved
- [ ] Visual indicator of restoration progress

---

## Known Issues to Monitor

1. **Orphaned terminal detection**: Currently works but needs validation after restoration
2. **Context file cleanup**: Verify temp files are cleaned up after use
3. **Multiple Claude Code instances**: What happens if both restore simultaneously?
4. **Windows Terminal process churn**: Does rapid terminal creation cause issues?

---

## Next Steps

1. **Run Scenario 1**: Test basic workspace restoration with current 5-terminal setup
2. **Run Scenario 2**: Validate Claude Code context file creation and restoration
3. **Document results**: Record any failures or unexpected behavior
4. **Iterate on fixes**: Address any issues found during testing
5. **Move to Phase 2**: Once baseline scenarios pass consistently

---

## Test Results Log

### Test Run #1 - [Date TBD]
- **Scenario**:
- **Result**:
- **Issues**:
- **Notes**:

---

**Last Updated**: 2025-11-18
**Test Status**: Ready to begin Phase 1
