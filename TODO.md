# FlowState Dashboard - Development TODO List

## 🚀 Priority 1: Core Terminal & Recovery

### 1.1 Claude Code Terminal Capture & Recovery
- [x] Fix Windows Terminal spawning to use `-w new` (prevent IPC blocking)
- [x] Remove event listeners from spawn to enable true detachment
- [x] Change `stdio` to `'ignore'` for full detachment
- [x] Run blocking commands (`npm run dev`, `electron`) in background using `Start-Process`
- [x] Filter out IDE-integrated terminals from capture
- [x] Add `parentName` and `parentCommandLine` to session metadata
- [x] Implement restoration order: Terminal → Claude Code → Visual Assets
- [x] Add Claude Code process detection/waiting logic
- [ ] **Test end-to-end flow**: Capture → Close → Restore → Verify Claude Code launches immediately
- [ ] **Test visual assets**: Verify browsers/Electron apps open AFTER Claude Code initializes
- [ ] **Test context file**: Verify Claude Code receives context restoration file
- [ ] Add error handling for failed Claude Code launches
- [ ] Add user notification when Claude Code is initializing

### 1.2 Visual Asset Restoration (Electron, Web Apps)
- [x] Implement browser restoration via CDP (Chrome DevTools Protocol)
- [x] Implement browser spawning fallback
- [x] Add restoration order (after Claude Code)
- [ ] **Add Electron app detection** (capture running Electron apps)
- [ ] **Add Electron app restoration** (relaunch with same state)
- [ ] **Add web app state restoration** (restore URL, scroll position, etc.)
- [ ] Test with multiple browser types (Chrome, Edge, Brave, Firefox)
- [ ] Add support for browser profiles/sessions
- [ ] Handle cases where browser debugging is disabled

---

## 💻 Priority 2: IDE Integration & Capture

### 2.1 IDE Detection & Capture
- [ ] **Cursor IDE**
  - [ ] Detect running Cursor instances
  - [ ] Capture workspace path
  - [ ] Capture open files/tabs
  - [ ] Capture split pane layouts
  - [ ] Capture AI chat history (if accessible)
  - [ ] Restore with same workspace and files

- [ ] **VS Code**
  - [ ] Detect running VS Code instances
  - [ ] Capture workspace path
  - [ ] Capture open files/tabs
  - [ ] Capture extensions state
  - [ ] Capture split pane layouts
  - [ ] Restore with same workspace and files

- [ ] **Windsurf**
  - [ ] Research Windsurf process detection
  - [ ] Capture workspace configuration
  - [ ] Restore Windsurf with state

- [ ] **JetBrains IDEs** (IntelliJ, PyCharm, WebStorm, etc.)
  - [ ] Detect running JetBrains IDEs
  - [ ] Capture project path
  - [ ] Capture recent files
  - [ ] Restore with project

- [ ] **Sublime Text**
  - [ ] Detect Sublime instances
  - [ ] Capture workspace/project
  - [ ] Restore state

### 2.2 IDE Restoration
- [ ] Add IDE launch detection (verify IDE opened successfully)
- [ ] Add delay/retry logic for slow IDE launches
- [ ] Handle cases where IDE is already running
- [ ] Restore IDE windows to original monitor/position (if possible)

---

## 🎯 Priority 3: User Experience

### 3.1 App Startup Walkthrough/Onboarding
- [ ] **Fix walkthrough trigger**: Only show on FIRST sign-in after new account registration
  - Current issue: Shows every time user signs in
  - Need to add `hasCompletedOnboarding` flag to user database
  - Set flag to `true` after completing tour OR skipping
- [ ] Add "Skip Tour" button to onboarding
- [ ] Add "Restart Tour" option in settings
- [ ] Improve tour steps with better visuals/animations
- [ ] Add tooltips for key features
- [ ] Create quick start guide

### 3.2 Smart Capture Improvements
- [x] Filter IDE-integrated terminals (Cursor, VS Code, etc.)
- [ ] Make Smart Capture enabled by default for new users
- [ ] Add UI toggle for Smart Capture setting
- [ ] Add "What gets captured?" explanation in UI
- [ ] Show capture statistics (X terminals captured, Y filtered)

---

## 📝 Priority 4: Development Progress Tracking (AI-Powered)

### 4.1 Session Activity Monitoring
- [ ] **Capture AI interactions**
  - [ ] Detect Claude Code conversations (from terminal output or logs)
  - [ ] Detect Cursor AI chat messages
  - [ ] Extract user questions/requests to AI
  - [ ] Extract AI responses/suggestions
  - [ ] Categorize interactions (debugging, feature request, refactoring, etc.)

- [ ] **Track code changes**
  - [ ] Monitor git commits during session
  - [ ] Track file modifications (new, edited, deleted)
  - [ ] Detect significant changes (new features, bug fixes, refactors)

- [ ] **Track development milestones**
  - [ ] Test runs (passed/failed)
  - [ ] Build completions
  - [ ] Deployments
  - [ ] Key achievements

### 4.2 Progress Document Generation
- [ ] **Auto-generate session summary**
  - [ ] Session duration
  - [ ] Files worked on
  - [ ] Features implemented
  - [ ] Bugs fixed
  - [ ] Key AI interactions
  - [ ] Commits made

- [ ] **Cumulative project progress**
  - [ ] Track all sessions for a project
  - [ ] Generate project timeline
  - [ ] Show feature evolution
  - [ ] Track recurring questions/issues

- [ ] **AI-powered insights & recommendations**
  - [ ] Analyze patterns in user questions
  - [ ] Suggest areas needing attention
  - [ ] Recommend code improvements
  - [ ] Identify technical debt
  - [ ] Suggest next steps based on current progress

### 4.3 Progress Tracking UI
- [ ] Add "Session History" page
- [ ] Add "Project Progress" dashboard
- [ ] Add AI insights panel
- [ ] Export progress reports (Markdown, PDF)
- [ ] Share progress with team members
- [ ] Integration with project management tools (optional)

---

## 🔧 Additional Features & Improvements

### Terminal Enhancements
- [ ] Add support for more terminal types (Alacritty, Hyper, iTerm2, etc.)
- [ ] Improve command history restoration
- [ ] Restore terminal tabs/splits
- [ ] Restore terminal scrollback buffer (if possible)
- [ ] Add terminal theme/color scheme restoration

### Browser Enhancements
- [ ] Restore browser zoom level
- [ ] Restore developer tools state (if open)
- [ ] Capture and restore form data (with user permission)
- [ ] Support for private/incognito windows
- [ ] Handle multiple browser windows

### Database & Performance
- [ ] Add database migration system
- [ ] Implement capture compression (reduce storage)
- [ ] Add capture size limits
- [ ] Implement auto-cleanup of old captures
- [ ] Add database backup/export

### Security & Privacy
- [ ] Add option to exclude sensitive files/URLs
- [ ] Encrypt sensitive data in captures
- [ ] Add "Private Mode" capture (no AI tracking, no screenshots)
- [ ] GDPR compliance features
- [ ] Add data retention policies

### Cross-Platform Support
- [ ] Test and fix macOS-specific issues
- [ ] Test and fix Linux-specific issues
- [ ] Add platform-specific documentation
- [ ] Handle platform-specific paths/commands

### Settings & Customization
- [ ] Add customizable keyboard shortcuts
- [ ] Add theme customization (dark/light mode preferences)
- [ ] Add capture triggers (time-based, event-based)
- [ ] Add auto-restore on system startup option
- [ ] Add capture exclusion rules

---

## 🐛 Known Issues to Fix

### High Priority
- [ ] Fix "Port 5173 already in use" when restoring dev server
- [ ] Ensure Electron windows don't block Claude Code initialization
- [ ] Fix metadata corruption warnings
- [ ] Handle cases where terminal script execution fails
- [ ] Fix Windows Terminal profile detection

### Medium Priority
- [ ] Improve error messages for users
- [ ] Add loading states for long operations
- [ ] Fix GPU cache errors (harmless but noisy in logs)
- [ ] Improve process tree depth limit handling
- [ ] Add validation for corrupt database entries

### Low Priority
- [ ] Clean up debug logging (too verbose in production)
- [ ] Optimize PowerShell query performance
- [ ] Reduce capture time for large workspaces
- [ ] Improve UI responsiveness during capture

---

## 📚 Documentation Needed

- [ ] User guide for first-time users
- [ ] Video tutorials for key features
- [ ] FAQ for common issues
- [ ] API documentation for developers
- [ ] Contributing guidelines
- [ ] Architecture documentation
- [ ] Troubleshooting guide

---

## 🚢 Release Checklist

### Before v1.0
- [ ] Complete Priority 1 tasks (Terminal & Recovery)
- [ ] Complete Priority 2 tasks (User Experience)
- [ ] Fix all high-priority bugs
- [ ] Write user documentation
- [ ] Test on Windows, macOS, Linux
- [ ] Create installer/build pipeline
- [ ] Set up error reporting/analytics
- [ ] Create marketing website
- [ ] Prepare demo video

### After v1.0
- [ ] Complete Priority 3 (IDE Integration)
- [ ] Complete Priority 4 (Progress Tracking)
- [ ] Add remaining features
- [ ] Expand platform support
- [ ] Build community/feedback system

---

## 💡 Future Ideas (Backlog)

- [ ] Team collaboration features (share captures)
- [ ] Cloud sync for captures
- [ ] Mobile app for viewing captures
- [ ] Integration with Slack/Discord for notifications
- [ ] AI-powered code review from session data
- [ ] Automated testing suggestions based on changes
- [ ] Performance analytics (track build times, test times)
- [ ] Cost tracking for cloud resources
- [ ] Project health scoring
- [ ] Automated documentation generation from sessions
- [ ] Integration with CI/CD pipelines
- [ ] Voice notes during development
- [ ] Screen recording integration
- [ ] Pomodoro timer integration
- [ ] Focus mode (block distractions during deep work)

---

**Last Updated:** November 16, 2025
**Current Focus:** Priority 1 - Terminal & Recovery Testing (then Priority 2 - IDE Integration)
