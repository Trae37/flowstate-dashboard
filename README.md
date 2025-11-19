# Flow State Dashboard

A desktop application for capturing and restoring your complete development workspace context - including code files, terminal sessions, browser tabs, and notes.

## Features

- **Workspace Capture**: Automatically capture your current development environment including:
  - Active IDE/editor sessions (VS Code, etc.)
  - Terminal sessions and commands
  - Browser tabs (with extension support)
  - Notes and documentation

- **Workspace Restore**: Restore previously captured workspaces with one click
  - Reopen files in your IDE
  - Restore terminal sessions
  - Reopen browser tabs

- **History Management**: Browse and manage historical workspace captures

- **Automatic Saves**: Configure automatic workspace snapshots at regular intervals or on specific triggers:
  - On git commits
  - On project switches
  - On inactivity detection

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Desktop Framework**: Electron
- **Database**: SQLite (local-first, user owns data)
- **Build Tool**: Vite

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

### Development

Run the app in development mode:

```bash
npm run dev
```

This will:
- Start the Vite dev server for the React app
- Compile the Electron main process
- Launch the Electron application

### Building for Production

Build the application:

```bash
npm run build
```

Build a distributable app:

```bash
npm run build:app
```

## Project Structure

```
flowstate-dashboard/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.ts        # Application entry point
│   │   ├── capture.ts     # Workspace capture logic
│   │   ├── restore.ts     # Workspace restore logic
│   │   └── database.ts    # SQLite database
│   ├── preload/           # Electron preload scripts
│   │   └── preload.ts     # IPC bridge
│   └── renderer/          # React application
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   ├── pages/
│       │   └── styles/
│       └── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## How It Works

### Capture Process

1. **Detection**: The app detects running applications (VS Code, terminals, browsers)
2. **Collection**: Gathers metadata about open files, URLs, and session states
3. **Storage**: Saves all data to local SQLite database
4. **Indexing**: Creates searchable capture history

### Browser Tab Capture

To enable full browser tab capture for **Chrome**, **Brave**, or **Microsoft Edge**:

1. Close all browser windows
2. Launch the browser with remote debugging enabled:
   - **Windows**: Run `launch-chrome-debug.bat`, `launch-brave-debug.bat`, or `launch-edge-debug.bat`
   - **Manual**: Launch with appropriate debug port:
     - Chrome: `chrome.exe --remote-debugging-port=9222`
     - Brave: `brave.exe --remote-debugging-port=9222`
     - Edge: `msedge.exe --remote-debugging-port=9223`
3. Use the browser normally - FlowState will now capture all open tabs

The app will:
- Capture all tab URLs and titles from browsers with debugging enabled
- Show instructions for browsers running without debugging
- Work with multiple browser instances on different debug ports (9222-9225)

**Supported Browsers:**
- Google Chrome (port 9222)
- Brave Browser (port 9222)
- Microsoft Edge (port 9223)

**Note**: Browsers must be started with the debug flag. The helper scripts make this easy!

### Restore Process

1. **Selection**: User selects a capture from history
2. **Parsing**: App reads capture data from database
3. **Execution**: Opens files in IDE, launches terminals, restores browser tabs
4. **Verification**: Confirms successful restoration

## Current Capabilities

### ✅ Fully Implemented

#### Browser Tab Capture
- **Chrome, Brave, and Microsoft Edge** via Chrome DevTools Protocol
  - Captures all open tabs (URLs and titles)
  - Restores tabs in their original browser
  - Detects browsers without debugging and provides instructions
  - Supports multiple browsers simultaneously on different debug ports

#### Advanced Terminal Capture & Restoration
- **Full State Capture** for all terminal types:
  - **Windows Terminal** (with shell type detection)
  - **PowerShell** (Windows PowerShell and PowerShell Core)
  - **CMD** (Command Prompt)
  - **Git Bash**
  - **WSL** (Windows Subsystem for Linux)

- **Captured Information**:
  - Current working directory
  - Command history (last 50 commands)
  - Running processes and their command lines
  - Environment variables
  - Window titles

- **Intelligent Process Detection**:
  - Claude Code CLI sessions
  - Development servers (npm/yarn/pnpm dev)
  - Python scripts
  - Node.js applications
  - Docker containers
  - Any running child processes

- **Smart Restoration**:
  - Reopens terminals in the correct directory
  - Automatically restarts captured processes
  - Creates startup scripts that re-execute running commands
  - Handles special cases (Claude Code, dev servers, etc.)
  - Preserves shell type and environment

#### Other Features
- **VS Code Detection**: Detects running VS Code instances
- **SQLite Database**: Local-first data storage
- **Workspace History**: Browse and restore previous captures

### 🎯 How Terminal Restoration Works

When you restore a terminal session:

1. **Directory Restoration**: Opens the terminal in your original working directory
2. **Process Detection**: Identifies what was running (e.g., `npm run dev`, `claude`, `python script.py`)
3. **Auto-Restart**: Creates a startup script that:
   - Changes to your working directory
   - Restarts detected processes automatically
   - Shows helpful comments about what's being restored
4. **Shell Matching**: Opens the same shell type you were using (PowerShell, CMD, Bash, etc.)

**Example**: If you were running `npm run dev` in a PowerShell terminal at `C:\projects\my-app`, restoration will:
- Open PowerShell
- Navigate to `C:\projects\my-app`
- Execute `npm run dev` automatically

### ⚠️ Current Limitations
1. **Browser Requirement**: Browsers must be launched with `--remote-debugging-port=9222` flag (helper scripts provided)
2. **VS Code Integration**: Detects VS Code but requires VS Code CLI (`code` command) for file opening
3. **Long-Running State**: Cannot restore the exact state of long-running processes (e.g., server logs, active connections), only restart them fresh

## Quick Start: Browser Tab Capture

**First time setup:**

1. Open a terminal in the project directory
2. Choose your browser and run the helper script:
   - Chrome users: Double-click `launch-chrome-debug.bat`
   - Brave users: Double-click `launch-brave-debug.bat`
   - Edge users: Double-click `launch-edge-debug.bat`
3. Your browser will open with debugging enabled
4. Open your usual tabs/websites
5. Launch FlowState Dashboard and click "Capture Workspace"
6. All your browser tabs will be captured!

**Alternative:** Create a desktop shortcut to your browser with the appropriate debug port flag added to the target path.

**Note:** You can run multiple browsers with debugging simultaneously! Each browser uses a different port (Chrome/Brave: 9222, Edge: 9223).

## Future Enhancements

- Firefox support via native Firefox Remote Debugging Protocol
- VS Code extension for deeper integration (workspace files, settings)
- Terminal history restoration via OS-specific APIs
- Cloud sync option (optional, respecting privacy)
- Team workspace sharing
- Smart context detection (AI-powered)
- Cross-platform optimizations (macOS, Linux)

## Database Location

Workspace data is stored locally at:
- **Windows**: `%APPDATA%/flowstate-dashboard/flowstate.db`
- **macOS**: `~/Library/Application Support/flowstate-dashboard/flowstate.db`
- **Linux**: `~/.config/flowstate-dashboard/flowstate.db`

## Privacy & Data Ownership

- All data stored locally on your machine
- No cloud upload required
- You own 100% of your data
- Export functionality coming soon

## License

ISC

## Contributing

This is an MVP. Feedback and contributions welcome!
