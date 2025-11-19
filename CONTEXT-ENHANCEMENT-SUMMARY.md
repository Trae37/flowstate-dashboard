# Claude Code Context File Enhancement

## Overview
Enhanced the terminal restoration context file to provide Claude Code with much more actionable information when resuming work after a session interruption.

## New Sections Added

### 1. 🎯 Resume Instructions
**Purpose:** Provide clear, step-by-step instructions to Claude Code on how to resume work.

**Content:**
- Explicit instructions to read through all context
- Steps to check active tasks and suggested next steps
- Guidance on continuing work or asking the user

**Impact:** Claude Code now knows exactly what it's supposed to do instead of asking generic questions.

### 2. 📝 Last Session Summary
**Purpose:** Auto-generate a summary of what was being worked on.

**Infers from:**
- Recently modified files (indicates active development)
- Git status (uncommitted changes suggest work in progress)
- Command history (dev servers running, etc.)

**Example Output:**
```
You were actively working in the C:\Users\...\flowstate-dashboard directory.
2 file(s) were modified in the last hour, suggesting active development.
You have 3 uncommitted change(s) in git.
A development server was running before Claude Code was launched.
```

### 3. ✅ Active Tasks
**Purpose:** List concrete tasks that need attention.

**Infers from:**
- Modified files in git (suggests code changes to review/commit)
- Recently edited files (work that may need continuation)
- Untracked files (new files that might need to be added to git)

**Example Output:**
```
**Review and commit changes:**
  - Review the modified files listed in Git Status section
  - Consider committing or continuing work on these changes

**Continue work on recently modified files:**
  - src/main/terminal-capture.ts
  - FIX-SUMMARY.md
  - check-terminals.js
```

### 4. 🚀 Suggested Next Steps
**Purpose:** Provide specific, actionable commands Claude Code can offer to execute.

**Infers from:**
- Command history (identifies dev server commands to restart)
- Git status (suggests `git diff` if there are changes)
- Recent files (suggests continuing with the most recently edited file)

**Example Output:**
```
1. **Restart the development server** (it was running before):
   ```bash
   npm run dev
   ```

2. **Review uncommitted changes:**
   ```bash
   git diff
   ```

3. **Continue editing recent files:**
   - Start with: `src/main/terminal-capture.ts`

4. Ask the user if they want to continue with these tasks or work on something else
```

### 5. ⚙️ Resumption Mode
**Purpose:** Set expectations for how Claude Code should behave.

**Current Mode:** Interactive (ask before resuming work)

**Content:**
- Specifies that Claude should ask before executing commands
- Prevents automatic execution of potentially disruptive actions
- Can be enhanced in the future to support "automatic" mode

## Implementation Details

### Helper Functions Created

1. **`inferSessionSummary(claude: ClaudeCodeContext)`**
   - Analyzes context to create a natural language summary
   - Checks recently modified files, git status, and command history

2. **`inferActiveTasks(claude: ClaudeCodeContext)`**
   - Creates a task list based on git status and file changes
   - Prioritizes by recency and type of change

3. **`inferNextSteps(claude: ClaudeCodeContext)`**
   - Suggests specific commands to run
   - Detects common patterns (dev servers, git operations)
   - Always asks user for confirmation at the end

### Context File Structure
The enhanced context file now has this structure:

```markdown
# FlowState Session Restoration Context

## 🎯 Resume Instructions
[Clear instructions for Claude Code]

## 📝 Last Session Summary
[Auto-generated summary of what was being worked on]

## ✅ Active Tasks
[Specific tasks that need attention]

## 🚀 Suggested Next Steps
[Actionable steps with commands]

## ⚙️ Resumption Mode
[How Claude should behave when resuming]

## Working Directory
[Current directory]

## Git Status
[Branch, modified files, untracked files]

## Recently Modified Files
[Files changed in last 60 minutes]

## Commands Before Claude Started
[Command history]

## Project Structure
[Project files]

## Session Metadata
[Timestamp, startup command]
```

## Benefits

### Before Enhancement
```
Claude Code: "I can see you were working on flowstate-dashboard.
What would you like me to help with?"
```

### After Enhancement
```
Claude Code: "I can see from the context file that you were actively developing
in the flowstate-dashboard project. You have uncommitted changes in terminal-capture.ts
and the dev server was running.

Here's what I suggest:

1. Restart the dev server (npm run dev)
2. Review your uncommitted changes (git diff)
3. Continue editing terminal-capture.ts

Would you like me to proceed with these steps, or would you prefer to work on something else?"
```

## Future Enhancements

### Potential Additions
1. **Automatic Mode**: Allow users to enable fully automatic resumption
2. **Task Persistence**: Save actual TODO items from the previous session
3. **Conversation History**: Capture last N messages from Claude Code
4. **Error Detection**: Identify if the session was interrupted due to an error
5. **Time-based Suggestions**: Different suggestions based on how long ago the session was

### Configuration Options
Future versions could support user preferences:
- `resumptionMode: 'interactive' | 'automatic' | 'ask-first'`
- `restartDevServers: boolean`
- `autoCommitChanges: boolean`
- `maxContextDepth: number`

## Testing

To test the enhanced context:
1. Start working on a project with Claude Code
2. Make some file changes
3. Start a dev server (npm run dev)
4. Trigger a FlowState capture
5. Restore the terminal
6. Read the generated context file

The context file should now include:
- ✅ Clear resume instructions
- ✅ Summary of what you were working on
- ✅ List of active tasks
- ✅ Suggested next steps with commands
- ✅ Resumption mode preferences

## Files Modified
- `src/main/terminal-capture.ts`
  - Added `inferSessionSummary()` function
  - Added `inferActiveTasks()` function
  - Added `inferNextSteps()` function
  - Enhanced `generateClaudeContextFile()` to include new sections
