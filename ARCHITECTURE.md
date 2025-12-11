# FlowState Dashboard - Architecture Documentation

## Overview

FlowState Dashboard is an Electron-based desktop application that captures, stores, and restores developer workspace state including IDEs, terminals, browsers, and code context.

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐         ┌──────────────┐            │
│  │ Main Process │ ◄─────► │ Renderer     │            │
│  │ (Node.js)    │  IPC    │ (React/Vite) │            │
│  └──────────────┘         └──────────────┘            │
│         │                                              │
│         ├──► Database (SQL.js)                        │
│         ├──► File System                               │
│         ├──► Process Management                        │
│         └──► System APIs                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Process Separation

- **Main Process**: Node.js runtime, handles:
  - Database operations
  - File system access
  - Process detection and management
  - System-level operations
  - IPC handlers

- **Renderer Process**: Browser runtime (Chromium), handles:
  - React UI
  - User interactions
  - State management
  - API calls via IPC

- **Preload Script**: Bridge between main and renderer, exposes safe APIs

## Core Components

### 1. Database Layer (`src/main/database.ts`)

- **Technology**: SQL.js (in-memory SQLite)
- **Storage**: Local file (`flowstate.db` in userData directory)
- **Schema**:
  - `users`: User accounts and authentication
  - `sessions`: Authentication sessions
  - `work_sessions`: Work period groupings
  - `captures`: Workspace capture records
  - `assets`: Individual capture components (code, terminal, browser, notes)
  - `settings`: User preferences

- **Key Functions**:
  - `initDatabase()`: Initialize/create database
  - `prepare()`: Create parameterized SQL queries
  - `saveDatabase()`: Persist in-memory database to disk

### 2. Authentication (`src/main/auth.ts`)

- **Password Hashing**: SHA-256 (simple, suitable for local-first app)
- **Session Management**: Token-based, 30-day expiration
- **Functions**:
  - `createUser()`: Register new user
  - `loginUser()`: Authenticate and create session
  - `verifySession()`: Validate session token
  - `logoutUser()`: Invalidate session

### 3. Session Management (`src/main/session-management.ts`)

- **Purpose**: Organize captures into work periods
- **Key Features**:
  - Auto-create sessions on login
  - Archive sessions on logout
  - Auto-recovery detection
  - Session grouping by date

### 4. Capture System (`src/main/capture.ts`)

- **Workflow**:
  1. Create capture record
  2. Run capture steps (IDE, Terminal, Browser, Notes)
  3. Save assets to database
  4. Persist to disk

- **Capture Steps**:
  - IDE Capture (`ide-capture.ts`)
  - Terminal Capture (`terminal-capture.ts`)
  - Browser Capture (`browser-integration.ts`)
  - Notes Capture (`note-integration.ts`)

### 5. Archive Management (`src/main/archive-management.ts`)

- **Purpose**: Handle archiving and deletion of individual items
- **Hierarchy**: Session → Capture → Asset
- **Rules**:
  - Archiving a session replaces individual component archives
  - Archived items are never auto-deleted
  - Only non-archived items are cleaned up when limit reached

### 6. Security (`src/main/utils/security.ts`)

- **Input Validation**: Email, username, password, IDs
- **SQL Injection Prevention**: Parameter sanitization
- **Rate Limiting**: Login, signup, capture operations
- **Path Sanitization**: Prevent directory traversal

## Data Flow

### Capture Flow

```
User clicks "Capture" 
  → Dashboard.handleCapture()
  → IPC: capture-workspace
  → Main: captureWorkspace()
  → Create capture record
  → Run capture steps (parallel)
  → Save assets to database
  → Return capture ID
  → Dashboard refreshes
```

### Restore Flow

```
User clicks "Restore"
  → IPC: restore-workspace
  → Main: restoreWorkspace()
  → Load capture and assets
  → Restore in order:
    1. Terminals
    2. Claude Code (if applicable)
    3. IDEs
    4. Browsers/Visual assets
  → Return success
```

### Session Flow

```
User logs in
  → Archive existing sessions
  → Create new session
  → Load current session
  → Filter captures by session
  → Display in dashboard
```

## Frontend Architecture

### Component Structure

```
App
├── AuthProvider (Context)
├── Routes
│   ├── Login
│   ├── Signup
│   ├── Onboarding
│   ├── Dashboard
│   │   ├── SessionSidebar
│   │   ├── Header
│   │   ├── CaptureCard (list)
│   │   └── FeatureTour
│   ├── ContextDetail
│   │   └── AssetCard (list)
│   ├── Settings
│   └── Archive
```

### State Management

- **React Context**: Authentication state (`AuthContext`)
- **Local State**: Component-specific state (`useState`)
- **IPC**: Data fetching from main process

### Key Components

- **SessionSidebar**: Left navigation with session list
- **CaptureCard**: Display capture summary
- **AssetCard**: Display individual asset (terminal, browser, etc.)
- **Header**: Top bar with capture button and settings

## Security Considerations

### Current Security Measures

1. **SQL Injection Prevention**:
   - Parameterized queries with `prepare()`
   - Input sanitization in `security.ts`
   - Type validation for parameters

2. **Authentication**:
   - Password hashing (SHA-256)
   - Session tokens (64-char hex)
   - Session expiration (30 days)

3. **Input Validation**:
   - Email format validation
   - Password strength checks
   - Username format validation
   - ID validation (positive integers)

4. **Rate Limiting**:
   - Login: 5 attempts per 15 minutes
   - Signup: 3 attempts per hour
   - Capture: 10 per minute

### Security Recommendations

1. **Password Hashing**: Consider upgrading to bcrypt or argon2 for production
2. **Session Security**: Add session rotation and refresh tokens
3. **Data Encryption**: Consider encrypting sensitive data at rest
4. **Command Injection**: Review all `exec()` calls for user input sanitization

## File Structure

```
flowstate-dashboard/
├── src/
│   ├── main/              # Electron main process
│   │   ├── database.ts    # Database operations
│   │   ├── auth.ts        # Authentication
│   │   ├── capture.ts     # Capture orchestration
│   │   ├── session-management.ts
│   │   ├── archive-management.ts
│   │   ├── utils/
│   │   │   └── security.ts
│   │   └── migrations/
│   ├── renderer/          # React frontend
│   │   ├── src/
│   │   │   ├── pages/     # Route pages
│   │   │   ├── components/ # Reusable components
│   │   │   └── contexts/  # React contexts
│   └── preload/           # IPC bridge
├── dist/                  # Compiled output
└── package.json
```

## IPC Communication

### Main → Renderer
- `main-process-log`: Log messages
- `power-status-changed`: Power status updates

### Renderer → Main
- `capture-workspace`: Create new capture
- `restore-workspace`: Restore capture
- `get-captures`: Fetch capture list
- `auth-*`: Authentication operations
- `session-*`: Session management
- `archive-*`: Archive operations

## Database Schema

See `src/main/database.ts` for full schema. Key tables:

- **users**: User accounts
- **sessions**: Auth sessions
- **work_sessions**: Work period groupings
- **captures**: Capture records
- **assets**: Capture components

## Error Handling

- **Database Errors**: Logged, don't crash app
- **IPC Errors**: Return `{ success: false, error: string }`
- **Capture Errors**: Continue with partial capture
- **Restore Errors**: Log and notify user

## Performance Considerations

- **Database**: In-memory SQL.js, saved to disk periodically
- **Capture**: Parallel execution of capture steps
- **UI**: React optimizations (memo, useMemo where needed)
- **Cleanup**: Auto-delete old non-archived captures (100 limit)

## Future Improvements

1. **Security**:
   - Upgrade password hashing
   - Add data encryption
   - Improve session security

2. **Architecture**:
   - Add service layer abstraction
   - Implement proper error boundaries
   - Add logging/monitoring

3. **Code Quality**:
   - Add unit tests
   - Improve type safety
   - Standardize error handling
   - Add JSDoc comments







