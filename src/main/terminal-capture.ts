import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from './utils/logger.js';

const execPromise = promisify(exec);

export interface RunningCommand {
  processId: number;
  processName: string;
  commandLine: string;
  workingDirectory?: string;
  executionTime?: number; // How long it's been running (ms)
}

export interface GitStatus {
  branch: string;
  modifiedFiles: string[];
  untrackedFiles: string[];
}

export interface ClaudeCodeContext {
  isClaudeCodeRunning: boolean;
  workingDirectory: string;
  projectFiles: string[];        // Files in the project
  recentlyModifiedFiles: string[]; // Files modified in last hour
  gitStatus?: GitStatus;
  sessionStartTime: Date;
  contextHint?: string;          // User-provided or auto-generated context
  startupCommand?: string;       // Exact command used to start Claude Code
  commandHistoryBeforeStart?: string[]; // Commands executed before Claude Code was started
}

export interface TerminalSession {
  processId: number;
  processName: string;
  shellType: 'PowerShell' | 'CMD' | 'GitBash' | 'WSL' | 'WindowsTerminal' | 'Unknown';
  currentDirectory?: string;
  commandHistory?: string[];
  environmentVariables?: Record<string, string>;
  windowTitle?: string;
  runningProcesses?: string[]; // Child processes running in this terminal
  runningCommands?: RunningCommand[]; // Full details of running commands
  parentProcessId?: number; // For tracking Windows Terminal instances
  lastExecutedCommand?: string; // The last command that was run
  claudeCodeContext?: ClaudeCodeContext; // Enhanced context for Claude Code sessions
  powerShellVersion?: 'Classic' | 'Core'; // Whether it's powershell.exe (Classic) or pwsh.exe (Core)
  isWindowsTerminal?: boolean; // Whether this session is inside Windows Terminal
  ownCommandLine?: string; // The command line used to launch this terminal process
  terminalOutput?: string; // Recent terminal output/scrollback buffer (for conversation capture)
}

export interface TerminalCaptureResult {
  sessions: TerminalSession[];
  totalSessions: number;
  capturedAt: string;
}

function extractClaudeWorkspaceFromCommand(commandLine?: string): string | undefined {
  if (!commandLine) return undefined;
  const normalized = commandLine.trim();
  if (!normalized) return undefined;

  const patterns = [
    /--path\s+["']?([^"'\\n]+)["']?/i,
    /--cwd\s+["']?([^"'\\n]+)["']?/i,
    /claude\s+code\s+["']?([^"'\\n]+)["']?/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim().replace(/^["']|["']$/g, '');
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

function resolveClaudeWorkingDirectory(
  runningCommands?: RunningCommand[],
  fallbackDir?: string
): string | undefined {
  if (!runningCommands || runningCommands.length === 0) {
    return fallbackDir;
  }

  for (const cmd of runningCommands) {
    const cmdLine = cmd.commandLine || '';
    if (!cmdLine.toLowerCase().includes('claude')) {
      continue;
    }
    const extracted = extractClaudeWorkspaceFromCommand(cmdLine);
    if (extracted) {
      return extracted;
    }
  }

  return fallbackDir;
}

function hasClaudeSignal(session: TerminalSession): boolean {
  const containsClaude = (value?: string) =>
    value?.toLowerCase().includes('claude') ?? false;

  if (containsClaude(session.windowTitle)) return true;

  if (session.runningProcesses?.some(proc => containsClaude(proc))) {
    return true;
  }

  if (session.runningCommands?.some(cmd =>
    containsClaude(cmd.commandLine) || containsClaude(cmd.processName)
  )) {
    return true;
  }

  if (session.commandHistory?.some(entry => containsClaude(entry))) {
    return true;
  }

  return false;
}

/**
 * Determine if a terminal session is "idle" and should be filtered in smart capture mode
 */
function isTerminalIdle(session: TerminalSession): boolean {
  // Has meaningful running commands - NOT idle
  if (session.runningCommands && session.runningCommands.length > 0) {
    return false;
  }

  // Has Claude Code running - NOT idle
  if (session.claudeCodeContext?.isClaudeCodeRunning) {
    return false;
  }

  // Has a last executed command that's meaningful - NOT idle
  if (session.lastExecutedCommand && session.lastExecutedCommand.trim()) {
    return false;
  }

  // Check command history for meaningful activity
  if (session.commandHistory && session.commandHistory.length > 0) {
    // Filter out empty commands and common system commands
    const meaningfulCommands = session.commandHistory.filter(cmd => {
      const trimmed = cmd.trim().toLowerCase();
      if (!trimmed) return false;
      
      // Ignore very common/basic commands
      const ignoredCommands = ['cls', 'clear', 'exit', 'cd', 'ls', 'dir', 'pwd'];
      if (ignoredCommands.includes(trimmed)) return false;
      
      // Ignore simple cd commands to home directory
      if (trimmed.startsWith('cd ') && (trimmed.includes('~') || trimmed.includes('users'))) {
        return false;
      }
      
      return true;
    });
    
    // If has meaningful commands in history - NOT idle
    if (meaningfulCommands.length > 0) {
      return false;
    }
  }

  // Check if current directory is not the default home directory
  if (session.currentDirectory) {
    const homeDir = os.homedir().toLowerCase();
    const currentDir = session.currentDirectory.toLowerCase();
    
    // If not in home directory - might be working on something, NOT idle
    if (!currentDir.startsWith(homeDir) && !currentDir.includes('users\\' + os.userInfo().username.toLowerCase())) {
      return false;
    }
  }

  // All checks passed - terminal is IDLE
  if (hasClaudeSignal(session)) {
    return false;
  }

  return true;
}

/**
 * Get current working directory for a process using WMI
 */
async function getCurrentWorkingDirectory(processId: number): Promise<string | undefined> {
  try {
    if (process.platform !== 'win32') return undefined;

    // Method 1: Check if any child processes have a working directory we can use
    const { stdout: childProcs } = await execPromise(
      `powershell -Command "$children = Get-WmiObject Win32_Process | Where-Object {$_.ParentProcessId -eq ${processId}}; $children | Select-Object Name, CommandLine, ExecutablePath | ConvertTo-Json"`,
      { timeout: 5000 }
    ).catch(() => ({ stdout: '' }));

    if (childProcs && childProcs.trim()) {
      try {
        const children = JSON.parse(childProcs);
        const childList = Array.isArray(children) ? children : [children];

        // Look for processes that might have a working directory in their command line
        for (const child of childList) {
          if (child.CommandLine) {
            // For Claude Code (node.js process running Claude CLI)
            const claudeMatch = child.CommandLine.match(/node(?:\.exe)?\s+.*?claude[^\\]*?(?:from|in)\s+["']?([^"'\s]+)["']?/i);
            if (claudeMatch && fs.existsSync(claudeMatch[1])) {
              logger.log(`Found Claude Code working directory from command line: ${claudeMatch[1]}`);
              return claudeMatch[1];
            }

            // For Node.js processes - extract script path
            const nodeMatch = child.CommandLine.match(/node(?:\.exe)?\s+(?:"([^"]+)"|([^\s]+))/i);
            if (nodeMatch) {
              const scriptPath = nodeMatch[1] || nodeMatch[2];
              // Skip node_modules paths
              if (scriptPath && !scriptPath.includes('node_modules') && fs.existsSync(scriptPath)) {
                const dir = path.dirname(scriptPath);
                logger.log(`Found working directory from Node.js script: ${dir}`);
                return dir;
              }
            }

            // For Python processes
            const pythonMatch = child.CommandLine.match(/python(?:\.exe)?\s+(?:"([^"]+)"|([^\s]+))/i);
            if (pythonMatch) {
              const scriptPath = pythonMatch[1] || pythonMatch[2];
              if (scriptPath && fs.existsSync(scriptPath)) {
                const dir = path.dirname(scriptPath);
                logger.log(`Found working directory from Python script: ${dir}`);
                return dir;
              }
            }

            // Check for --cwd or similar flags in command line
            const cwdMatch = child.CommandLine.match(/(?:--cwd|--working-directory)\s+["']?([^"'\s]+)["']?/i);
            if (cwdMatch && fs.existsSync(cwdMatch[1])) {
              logger.log(`Found working directory from --cwd flag: ${cwdMatch[1]}`);
              return cwdMatch[1];
            }
          }
        }
      } catch (e) {
        console.warn('Error parsing child processes:', e);
      }
    }

    // Method 2: Use PowerShell command line parsing
    const { stdout } = await execPromise(
      `powershell -Command "$env:PSModulePath = ''; (Get-WmiObject Win32_Process -Filter \\"ProcessId = ${processId}\\").CommandLine" 2>$null`,
      { timeout: 3000 }
    ).catch(() => ({ stdout: '' }));

    const dir = extractWorkingDirectory(stdout);
    if (dir && fs.existsSync(dir)) {
      logger.log(`Found working directory from PowerShell command line: ${dir}`);
      return dir;
    }

    // Method 3: Default to user home directory
    logger.log(`Using fallback directory: ${os.homedir()}`);
    return os.homedir();
  } catch (error) {
    console.warn(`Could not get working directory for process ${processId}:`, error);
    return os.homedir();
  }
}

/**
 * Get child processes running in a terminal
 */
async function getRunningProcesses(processId: number): Promise<string[]> {
  try {
    if (process.platform !== 'win32') return [];

    const { stdout } = await execPromise(
      `powershell -Command "Get-WmiObject Win32_Process | Where-Object {$_.ParentProcessId -eq ${processId}} | Select-Object -ExpandProperty Name | ConvertTo-Json"`,
      { timeout: 5000 }
    ).catch(() => ({ stdout: '[]' }));

    if (!stdout || stdout.trim() === '') return [];

    try {
      const processes = JSON.parse(stdout);
      return Array.isArray(processes) ? processes : [processes];
    } catch {
      return [];
    }
  } catch (error) {
    return [];
  }
}

/**
 * Get detailed information about running commands in a terminal
 */
async function getRunningCommandDetails(processId: number, depth: number = 0, maxDepth: number = 3): Promise<RunningCommand[]> {
  const commands: RunningCommand[] = [];

  try {
    if (process.platform !== 'win32') return commands;

    // Prevent infinite recursion with depth limit
    if (depth >= maxDepth) {
      console.warn(`[Process Tree] Depth limit (${maxDepth}) reached for process ${processId}, skipping deeper traversal`);
      return commands;
    }

    // Get all child processes with full details
    const { stdout } = await execPromise(
      `powershell -Command "Get-WmiObject Win32_Process | Where-Object {$_.ParentProcessId -eq ${processId}} | Select-Object ProcessId,Name,CommandLine,CreationDate,ExecutablePath | ConvertTo-Json"`,
      { timeout: 5000 }
    ).catch(() => ({ stdout: '[]' }));

    if (!stdout || stdout.trim() === '') return commands;

    try {
      const processes = JSON.parse(stdout);
      const processList = Array.isArray(processes) ? processes : [processes];

      for (const proc of processList) {
        // Calculate how long the process has been running
        let executionTime = 0;
        if (proc.CreationDate) {
          const creationDate = new Date(proc.CreationDate);
          executionTime = Date.now() - creationDate.getTime();
        }

        // Extract working directory from executable path
        let workingDir: string | undefined;
        if (proc.ExecutablePath) {
          workingDir = path.dirname(proc.ExecutablePath);
        }

        let commandLine = (proc.CommandLine || '').toString();
        if (!commandLine && proc.ExecutablePath) {
          commandLine = proc.ExecutablePath;
        }
        if (!commandLine && proc.Name) {
          commandLine = proc.Name;
        }

        commands.push({
          processId: Number(proc.ProcessId) || proc.ProcessId,
          processName: (proc.Name || '').toString(),
          commandLine,
          workingDirectory: workingDir,
          executionTime,
        });
      }

      // Recursively check for grandchildren (e.g., node processes spawned by npm)
      // with depth tracking to prevent infinite loops
      for (const proc of processList) {
        const grandchildren = await getRunningCommandDetails(proc.ProcessId, depth + 1, maxDepth);
        commands.push(...grandchildren);
      }
    } catch (parseError) {
      console.warn('Error parsing process details:', parseError);
    }
  } catch (error) {
    console.warn('Error getting running command details:', error);
  }

  return commands;
}

/**
 * Extract the last executed command from command history
 */
function getLastExecutedCommand(commandHistory: string[]): string | undefined {
  if (!commandHistory || commandHistory.length === 0) return undefined;

  // Get the last non-empty command
  for (let i = commandHistory.length - 1; i >= 0; i--) {
    const cmd = commandHistory[i].trim();
    if (cmd && !cmd.startsWith('#')) {
      return cmd;
    }
  }

  return undefined;
}

/**
 * Capture all active terminal sessions with their state
 */
export async function captureTerminalSessions(): Promise<TerminalCaptureResult> {
  let sessions: TerminalSession[] = [];

  // Logger already forwards to renderer via setRendererLogger
  const logDebug = (...args: any[]) => logger.debug(...args);

  logDebug('[Terminal Capture] Starting terminal capture...');
  logDebug('[Terminal Capture] Platform:', process.platform);

  try {
    if (process.platform === 'win32') {
      // Windows implementation
      logDebug('[Terminal Capture] Windows detected - capturing all terminal types...');
      
      logDebug('[Terminal Capture] Step 1: Capturing Windows Terminal sessions...');
      const windowsTerminalSessions = await captureWindowsTerminalSessions();
      logDebug(`[Terminal Capture]   Found ${windowsTerminalSessions.length} Windows Terminal sessions`);
      
      logDebug('[Terminal Capture] Step 2: Capturing PowerShell sessions...');
      const powershellSessions = await capturePowerShellSessions();
      logDebug(`[Terminal Capture]   Found ${powershellSessions.length} PowerShell sessions`);
      
      logDebug('[Terminal Capture] Step 3: Capturing CMD sessions...');
      const cmdSessions = await captureCMDSessions();
      logDebug(`[Terminal Capture]   Found ${cmdSessions.length} CMD sessions`);
      
      logDebug('[Terminal Capture] Step 4: Capturing Git Bash sessions...');
      const gitBashSessions = await captureGitBashSessions();
      logDebug(`[Terminal Capture]   Found ${gitBashSessions.length} Git Bash sessions`);
      
      logDebug('[Terminal Capture] Step 5: Capturing WSL sessions...');
      const wslSessions = await captureWSLSessions();
      logDebug(`[Terminal Capture]   Found ${wslSessions.length} WSL sessions`);

      sessions.push(...windowsTerminalSessions);
      sessions.push(...powershellSessions);
      sessions.push(...cmdSessions);
      sessions.push(...gitBashSessions);
      sessions.push(...wslSessions);
      
      logDebug(`[Terminal Capture] Total sessions collected: ${sessions.length}`);
    } else if (process.platform === 'darwin') {
      // macOS implementation
      logDebug('[Terminal Capture] macOS detected...');
      sessions.push(...await captureMacOSTerminals());
    } else {
      // Linux implementation
      logDebug('[Terminal Capture] Linux detected...');
      sessions.push(...await captureLinuxTerminals());
    }

    // Capture terminal output for all sessions (to get conversation history)
    logDebug(`[Terminal Capture] Capturing terminal output for ${sessions.length} sessions...`);
    for (const session of sessions) {
      const terminalOutput = await captureTerminalOutput(session);
      if (terminalOutput) {
        session.terminalOutput = terminalOutput;
        logDebug(`[Terminal Capture] Captured terminal output for session ${session.processId} (${terminalOutput.length} bytes)`);
      }
    }

    // Capture Claude Code context for sessions that have Claude running
    logDebug(`[Terminal Capture] Checking ${sessions.length} sessions for Claude Code...`);
    for (const session of sessions) {
      const claudeContext = await captureClaudeCodeContext(session);
      if (claudeContext) {
        session.claudeCodeContext = claudeContext;
        logDebug(`[Terminal Capture] Enhanced Claude Code context captured for session ${session.processId}`);
      }
    }

    logDebug(`[Terminal Capture] ✓ Capture complete: ${sessions.length} sessions found`);
  } catch (error: any) {
    logDebug('[Terminal Capture] ============================================');
    logDebug('[Terminal Capture] ✗ ERROR in captureTerminalSessions()');
    logDebug('[Terminal Capture] ============================================');
    logDebug('[Terminal Capture] Error type:', error?.constructor?.name || typeof error);
    logDebug('[Terminal Capture] Error message:', error?.message || String(error));
    logDebug('[Terminal Capture] Error stack:', error?.stack);
    logDebug('[Terminal Capture] ============================================');
    console.error('Error capturing terminal sessions:', error);
  }

  // ============================================================================
  // DEDUPLICATION: Remove Windows Terminal parent when child shell also captured
  // ============================================================================
  // When both Windows Terminal parent process and its child PowerShell/CMD are
  // captured, remove the parent to avoid duplication
  const windowsTerminalParents = sessions.filter(s => s.processName === 'WindowsTerminal');
  const childShellPIDs = new Set(
    sessions
      .filter(s => s.isWindowsTerminal && s.processName !== 'WindowsTerminal')
      .map(s => s.processId)
  );

  if (windowsTerminalParents.length > 0 && childShellPIDs.size > 0) {
    const duplicateParents = windowsTerminalParents.filter(parent => {
      // Check if any child shell belongs to this Windows Terminal parent
      return sessions.some(child =>
        child.isWindowsTerminal &&
        child.processName !== 'WindowsTerminal' &&
        child.parentProcessId === parent.processId
      );
    });

    if (duplicateParents.length > 0) {
      sessions = sessions.filter(s => !duplicateParents.includes(s));
      logDebug(`[Terminal Capture] DEDUPLICATION: Removed ${duplicateParents.length} Windows Terminal parent(s) with captured child shells`);
      duplicateParents.forEach(p => {
        logDebug(`[Terminal Capture]   - Removed PID ${p.processId}: WindowsTerminal parent (child shell captured separately)`);
      });
    }
  }

  // ============================================================================
  // DEFAULT FILTERING (Always Applied)
  // ============================================================================
  // Filter out IDE-integrated terminals and background processes
  // This ensures we only capture visible, standalone terminal windows

  const nonStandaloneSessions = sessions.filter(session => {
    const metadata = session as any;
    const parentName = metadata.parentName?.toLowerCase() || '';
    const parentCmd = metadata.parentCommandLine?.toLowerCase() || '';

    // Check if this session is running inside Windows Terminal
    // Windows Terminal children don't have their own MainWindowHandle, but they ARE visible terminals
    const isWindowsTerminalChild = parentName.includes('windowsterminal') ||
                                    parentName === 'wt' ||
                                    parentCmd.includes('windowsterminal') ||
                                    session.isWindowsTerminal;

    // Check if this terminal is running an active long-running command
    // Only apply this for PowerShell to catch orphaned script-launched terminals
    // CMD and Git Bash are too noisy (many background processes), so only detect those as Windows Terminal children
    const ownCmd = (metadata.ownCommandLine?.toLowerCase() || '');
    const isPowerShell = session.shellType === 'PowerShell';
    const hasActiveCommand = isPowerShell && (
      parentCmd.includes('npm run') ||
      parentCmd.includes('node ') ||
      ownCmd.includes('npm run') ||
      ownCmd.includes('node ')
    );

    // A terminal has a window if:
    // 1. It has a window title OR a non-zero window handle, OR
    // 2. It's a child of Windows Terminal (visible tab even without own window handle), OR
    // 3. (PowerShell only) It's running an active npm/node command (orphaned script-launched terminals)
    const hasWindow = !!session.windowTitle ||
                      !!(metadata.mainWindowHandle && metadata.mainWindowHandle !== 0) ||
                      isWindowsTerminalChild ||
                      hasActiveCommand;

    // Check if this is a FlowState restored terminal
    // Restored terminals are spawned by flowstate_restore_*.ps1 scripts
    // Check both parent command line AND if it has a window but no parent info
    // (restored terminals might lose their parent process reference after restoration)
    const isFlowStateRestored = parentCmd.includes('flowstate_restore') ||
      (hasWindow && (parentName === '' || parentName === 'unknown'));

    // List of known IDE process names
    const ideNames = ['cursor', 'code', 'visual studio', 'vscode', 'atom', 'sublime', 'webstorm', 'pycharm', 'intellij', 'windsurf'];

    // Check if parent is an IDE
    // NOTE: We only filter based on parent process, NOT shell integration.
    // Orphaned terminals may have IDE shell integration loaded but should still be captured
    // (e.g., Windows Terminal tabs that previously ran in Cursor but parent died)
    const isIdeChild = ideNames.some(ide =>
      parentName.includes(ide) ||
      parentCmd.includes(ide)
    );

    // Check if this terminal is running FlowState itself (prevent self-capture)
    const workingDir = session.currentDirectory?.toLowerCase() || '';
    const isFlowStateProject = workingDir.includes('flowstate-dashboard') || workingDir.includes('flowstate');
    const runningProcs = (session.runningProcesses || []).map(p => p.toLowerCase());

    // Only filter if it's actually running the FlowState Electron APP (not dev server)
    // Dev servers run node/npm, but the app runs as Electron main process
    const isFlowStateApp = runningProcs.some(p =>
      p.includes('flowstate') && !p.includes('node') && !p.includes('npm')
    );

    // For Electron processes, check if it's the dev server (has node in command chain)
    // or the actual app (standalone Electron process)
    const hasElectronApp = isFlowStateProject && runningProcs.some(p => {
      // If it's electron AND has node/npm, it's a dev server - KEEP IT
      if (p.includes('electron') && (p.includes('node') || p.includes('npm'))) {
        return false; // This is dev server, not the app
      }
      // If it's electron without node/npm, it's the app - FILTER IT
      return p.includes('electron') && !p.includes('node') && !p.includes('npm');
    });

    const isFlowStateSelf = isFlowStateApp || hasElectronApp;

    // ALWAYS KEEP FlowState restored terminals (they're legitimate user terminals)
    if (isFlowStateRestored) {
      return false; // Keep restored terminals
    }

    // Filter out if:
    // 1. It's FlowState capturing itself (prevents infinite loop)
    // 2. It's a child of an IDE (IDE will restore its own terminals)
    // 3. It doesn't have a visible window (background processes)
    //    - This includes Windows Terminal background scripts that have no MainWindowTitle
    if (isFlowStateSelf) {
      return true; // Filter out FlowState's own terminal
    }

    if (isIdeChild) {
      return true; // Filter out IDE children
    }

    if (!hasWindow) {
      return true; // Filter out ALL background processes (no window title)
    }

    return false; // Keep terminals with visible windows
  });

  let filteredSessions = sessions.filter(s => !nonStandaloneSessions.includes(s));

  if (nonStandaloneSessions.length > 0) {
    logDebug(`[Terminal Capture] DEFAULT FILTERING: Filtered ${nonStandaloneSessions.length} non-standalone terminal(s):`);
    nonStandaloneSessions.forEach(s => {
      const metadata = s as any;
      const parentName = metadata.parentName?.toLowerCase() || '';
      const parentCmd = metadata.parentCommandLine?.toLowerCase() || '';
      // Use same logic as above for consistency
      const isWindowsTerminalChild = parentName.includes('windowsterminal') ||
                                      parentName === 'wt' ||
                                      parentCmd.includes('windowsterminal') ||
                                      s.isWindowsTerminal;
      const workingDir = s.currentDirectory?.toLowerCase() || '';
      const isFlowStateProject = workingDir.includes('flowstate-dashboard') || workingDir.includes('flowstate');

      let reason = '';
      const procs = (s.runningProcesses || []).map((p: string) => p.toLowerCase());
      const hasFlowStateApp = procs.some(p => p.includes('flowstate') && !p.includes('node') && !p.includes('npm'));
      const hasElectronApp = isFlowStateProject && procs.some(p =>
        p.includes('electron') && !p.includes('node') && !p.includes('npm')
      );

      if (hasFlowStateApp || hasElectronApp) {
        reason = `FlowState app window (self-capture prevented)`;
      } else if (metadata.parentName && ['cursor', 'code', 'vscode'].some(ide => metadata.parentName.toLowerCase().includes(ide))) {
        reason = `IDE integrated (parent: ${metadata.parentName})`;
      } else if (!s.windowTitle && !isWindowsTerminalChild) {
        reason = `background process (parent: ${metadata.parentName || 'unknown'})`;
      }

      logDebug(`[Terminal Capture]   - PID ${s.processId}: ${s.shellType} - ${reason}`);
    });
    logDebug(`[Terminal Capture]   Result: ${filteredSessions.length} visible standalone terminal(s)`);
  }

  // ============================================================================
  // SMART CAPTURE FILTERING (Optional - Additional Layer)
  // ============================================================================
  // If enabled, Smart Capture filters out idle/inactive terminals
  // This is applied ON TOP OF the default filtering above

  try {
    const { getSetting } = await import('./database.js');
    const smartCaptureSetting = getSetting('smartCapture');
    logDebug(`[Terminal Capture] Smart Capture setting value: "${smartCaptureSetting}" (type: ${typeof smartCaptureSetting})`);
    // getSetting returns string | null, so we check for 'true' or 'True'
    const isSmartCaptureEnabled = smartCaptureSetting === 'true' || smartCaptureSetting === 'True';
    logDebug(`[Terminal Capture] Smart Capture enabled check: ${isSmartCaptureEnabled}`);

    if (isSmartCaptureEnabled) {
      const idleSessions = filteredSessions.filter(isTerminalIdle);
      filteredSessions = filteredSessions.filter(s => !isTerminalIdle(s));

      logDebug(`[Terminal Capture] SMART CAPTURE: Additional idle filtering applied:`);
      logDebug(`[Terminal Capture]   - Visible standalone terminals: ${sessions.length - nonStandaloneSessions.length}`);
      logDebug(`[Terminal Capture]   - Idle terminals (filtered): ${idleSessions.length}`);
      logDebug(`[Terminal Capture]   - Active terminals (kept): ${filteredSessions.length}`);

      if (idleSessions.length > 0) {
        logDebug(`[Terminal Capture] Filtered idle sessions:`);
        idleSessions.forEach(s => {
          logDebug(`[Terminal Capture]   - PID ${s.processId}: ${s.shellType} in ${s.currentDirectory || 'unknown dir'}`);
        });
      }
    } else {
      logDebug(`[Terminal Capture] SMART CAPTURE: Disabled - keeping all visible standalone terminals`);
      logDebug(`[Terminal Capture]   - Total sessions detected: ${sessions.length}`);
      logDebug(`[Terminal Capture]   - Non-standalone filtered (default): ${nonStandaloneSessions.length}`);
      logDebug(`[Terminal Capture]   - Final terminal count: ${filteredSessions.length}`);
    }
  } catch (error) {
    console.error('[Terminal Capture] Error checking smart capture setting:', error);
    // If error, don't apply Smart Capture - keep all visible standalone terminals
  }

  return {
    sessions: filteredSessions,
    totalSessions: filteredSessions.length,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Capture Windows Terminal sessions on Windows
 */
async function captureWindowsTerminalSessions(): Promise<TerminalSession[]> {
  const sessions: TerminalSession[] = [];

  try {
    // Get all Windows Terminal processes
    const { stdout } = await execPromise(
      'powershell -Command "Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json"'
    ).catch((error) => {
      // PowerShell might return non-zero exit code even with valid output
      if (error.stdout && error.stdout.trim()) {
        return { stdout: error.stdout };
      }
      throw error;
    });

    if (!stdout || stdout.trim() === '') {
      return sessions;
    }

    const processes = JSON.parse(stdout);
    const processList = Array.isArray(processes) ? processes : [processes];

    for (const proc of processList) {
      try {
        // Windows Terminal hosts other shells (PowerShell, CMD, WSL)
        // Get child processes to determine what shell is running
        const childProcesses = await getRunningProcesses(proc.Id);

        // Determine shell type from child processes and command lines
        let shellType: TerminalSession['shellType'] = 'WindowsTerminal';
        const childLower = childProcesses.map(p => (p || '').toString().toLowerCase());
        if (childLower.some(p => p === 'pwsh.exe' || p === 'pwsh')) {
          shellType = 'PowerShell';
        } else if (childLower.some(p => p === 'powershell.exe')) {
          shellType = 'PowerShell';
        } else if (childLower.some(p => p === 'cmd.exe')) {
          shellType = 'CMD';
        } else if (childLower.some(p => p === 'wsl.exe' || p === 'bash.exe')) {
          shellType = 'WSL';
        }

        // Get working directory
        let currentDirectory = await getCurrentWorkingDirectory(proc.Id);

        // Get detailed running command information first
        const runningCommands = await getRunningCommandDetails(proc.Id);

        const claudeWorkspace = resolveClaudeWorkingDirectory(runningCommands, currentDirectory);
        if (claudeWorkspace && claudeWorkspace !== currentDirectory) {
          logger.log(
            `[Terminal Capture] Windows Terminal PID ${proc.Id}: using Claude workspace ${claudeWorkspace}`
          );
          currentDirectory = claudeWorkspace;
        }

        // Get command history based on shell type
        let commandHistory: string[] = [];
        if (shellType === 'PowerShell') {
          commandHistory = await getPowerShellHistory();
        } else if (shellType === 'WSL') {
          commandHistory = await getBashHistory();
        }

        // Get the last executed command
        const lastExecutedCommand = getLastExecutedCommand(commandHistory);

        const cmdLower = (value?: string) => (value || '').toString().toLowerCase();
        const hasPwshSignal =
          childLower.includes('pwsh.exe') ||
          childLower.includes('pwsh') ||
          runningCommands.some(cmd =>
            cmdLower(cmd.processName) === 'pwsh.exe' ||
            cmdLower(cmd.processName) === 'pwsh' ||
            cmdLower(cmd.commandLine).includes('pwsh'))
        ;
        const hasClassicPsSignal =
          childLower.includes('powershell.exe') ||
          runningCommands.some(cmd =>
            cmdLower(cmd.processName) === 'powershell.exe' ||
            /(^|\s)powershell(\.exe)?(\s|$)/i.test(cmd.commandLine || ''))
        ;

        if (shellType === 'WindowsTerminal' && (hasPwshSignal || hasClassicPsSignal)) {
          shellType = 'PowerShell';
        }

        const powerShellVersion: 'Classic' | 'Core' | undefined =
          shellType === 'PowerShell'
            ? (hasPwshSignal ? 'Core' : 'Classic')
            : undefined;

        sessions.push({
          processId: proc.Id,
          processName: 'WindowsTerminal',
          shellType,
          windowTitle: proc.MainWindowTitle || undefined,
          currentDirectory,
          commandHistory,
          runningProcesses: childProcesses,
          runningCommands,
          lastExecutedCommand,
          environmentVariables: await getCapturedEnvVars(),
          powerShellVersion,
          isWindowsTerminal: true,
        });
      } catch (err) {
        console.warn(`Failed to capture details for Windows Terminal process ${proc.Id}:`, err);
      }
    }
  } catch (error) {
    console.warn('No Windows Terminal sessions found or error capturing:', error);
  }

  return sessions;
}

/**
 * Capture PowerShell sessions on Windows
 */
async function capturePowerShellSessions(): Promise<TerminalSession[]> {
  const sessions: TerminalSession[] = [];

  // Logger already forwards to renderer via setRendererLogger
  const logDebug = (...args: any[]) => logger.debug(...args);

  logDebug('[PowerShell Capture] Starting PowerShell capture...');

  try {
    // Get all PowerShell processes with full executable path for accurate detection
    logDebug('[PowerShell Capture] Querying for PowerShell processes with executable paths...');
    const { stdout } = await execPromise(
      'powershell -Command "Get-Process powershell,pwsh -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle,Path | ConvertTo-Json"'
    ).catch((error) => {
      logDebug('[PowerShell Capture] ExecPromise error (may be non-fatal):', error.message);
      // PowerShell might return non-zero exit code even with valid output
      // Check if we have stdout data anyway
      if (error.stdout && error.stdout.trim()) {
        logDebug('[PowerShell Capture] But stdout exists, using it anyway');
        return { stdout: error.stdout };
      }
      throw error;
    });

    if (!stdout || stdout.trim() === '') {
      logDebug('[PowerShell Capture] No PowerShell processes found (empty stdout)');
      return sessions;
    }

    logDebug('[PowerShell Capture] Raw PowerShell process data:', stdout.substring(0, 200));
    
    let processes;
    try {
      processes = JSON.parse(stdout);
    } catch (parseError: any) {
      logDebug('[PowerShell Capture] ✗ Failed to parse PowerShell process JSON:', parseError.message);
      logDebug('[PowerShell Capture] Raw stdout:', stdout);
      return sessions;
    }
    
    const processList = Array.isArray(processes) ? processes : [processes];
    logDebug(`[PowerShell Capture] Found ${processList.length} PowerShell process(es) to process`);

    for (const proc of processList) {
      try {
        const pid = proc.Id;
        const procName = proc.ProcessName || 'powershell';
        const exePath = (proc.Path || '').trim().toLowerCase();
        const mainWindowHandle = proc.MainWindowHandle || 0;

        logDebug(`[PowerShell Capture] Processing PID ${pid} (${procName}, path: ${exePath || 'unknown'}, window: ${mainWindowHandle})...`);

        // Determine PowerShell version FIRST using the executable path from the query
        let powerShellVersion: 'Classic' | 'Core' = 'Classic';
        if (exePath.includes('pwsh.exe')) {
          powerShellVersion = 'Core';
        } else if (exePath.includes('powershell.exe')) {
          powerShellVersion = 'Classic';
        } else {
          // Fallback to process name
          powerShellVersion = (procName.toLowerCase() === 'pwsh.exe' || procName.toLowerCase() === 'pwsh') ? 'Core' : 'Classic';
        }

        logger.log(`[DEBUG Capture] PowerShell PID ${pid}: ExecutablePath = "${exePath}" -> version ${powerShellVersion}`);
        
        // Check if this PowerShell is running inside Windows Terminal
        let isWindowsTerminal = false;
        const { stdout: parentCheck } = await execPromise(
          `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${pid}\\").ParentProcessId"`,
          { timeout: 3000 }
        ).catch(() => ({ stdout: '' }));

        logger.log(`[DEBUG Capture] PowerShell PID ${pid}: parentCheck = "${parentCheck?.trim() || ''}"`);

        // Declare parent info variables outside the if block so they're available later
        let parentName: string | undefined;
        let parentCommandLine: string | undefined;
        let parentProcessId: number | undefined;

        if (parentCheck && parentCheck.trim()) {
          const parentId = parseInt(parentCheck.trim());
          parentProcessId = parentId;

          // Get parent process name
          const parentNameResult = await execPromise(
            `powershell -Command "(Get-Process -Id ${parentId} -ErrorAction SilentlyContinue).ProcessName"`
          ).catch(() => ({ stdout: '' }));
          parentName = parentNameResult.stdout;

          // Also get parent process command line for more reliable detection
          const parentCmdResult = await execPromise(
            `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${parentId}\\").CommandLine"`
          ).catch(() => ({ stdout: '' }));
          parentCommandLine = parentCmdResult.stdout;

          const parentNameStr = (parentName?.trim() || '').toLowerCase();
          const parentCmdLineStr = (parentCommandLine?.trim() || '').toLowerCase();

          logger.log(`[DEBUG Capture] PowerShell PID ${pid}: parentId = ${parentId}`);
          logger.log(`[DEBUG Capture] PowerShell PID ${pid}: parentName = "${parentName?.trim() || ''}"`);
          logger.log(`[DEBUG Capture] PowerShell PID ${pid}: parentCommandLine = "${parentCommandLine?.trim() || ''}"`);

          // Check if parent is Windows Terminal (either by name or command line)
          // Windows Terminal can appear as: WindowsTerminal.exe, wt.exe, or WindowsTerminal
          const isWT = parentNameStr.includes('windowsterminal') || 
                      parentNameStr === 'wt' ||
                      parentCmdLineStr.includes('windowsterminal.exe') ||
                      parentCmdLineStr.includes(' wt.exe') ||
                      parentCmdLineStr.includes('\\windowsterminal.exe');
          
          if (isWT) {
            isWindowsTerminal = true; // This PowerShell is running in Windows Terminal
            logger.log(`[DEBUG Capture] PowerShell PID ${pid}: ✓ DETECTED as Windows Terminal session`);
          } else {
            logger.log(`[DEBUG Capture] PowerShell PID ${pid}: ✗ NOT in Windows Terminal`);
            logger.log(`[DEBUG Capture] PowerShell PID ${pid}:   parentName check: ${parentNameStr.includes('windowsterminal') || parentNameStr === 'wt'}`);
            logger.log(`[DEBUG Capture] PowerShell PID ${pid}:   parentCmdLine check: ${parentCmdLineStr.includes('windowsterminal.exe') || parentCmdLineStr.includes(' wt.exe')}`);
          }
        } else {
          logger.log(`[DEBUG Capture] PowerShell PID ${pid}: No parent check result, assuming classic console`);
        }

        // Get the PowerShell process's own command line
        // This is important for detecting terminals launched with commands like "powershell -Command npm run dev"
        let ownCommandLine: string | undefined;
        try {
          const ownCmdResult = await execPromise(
            `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`
          ).catch(() => ({ stdout: '' }));
          ownCommandLine = ownCmdResult.stdout?.trim();
          logger.log(`[DEBUG Capture] PowerShell PID ${pid}: ownCommandLine = "${ownCommandLine || ''}"`);
        } catch (err: any) {
          logger.log(`[DEBUG Capture] PowerShell PID ${pid}: Failed to get own command line:`, err?.message);
        }

        // For Windows Terminal sessions, get window title from parent process
        let windowTitle = proc.MainWindowTitle || undefined;
        if (isWindowsTerminal && parentCheck && parentCheck.trim()) {
          const parentId = parseInt(parentCheck.trim());
          try {
            const parentTitleResult = await execPromise(
              `powershell -Command "(Get-Process -Id ${parentId} -ErrorAction SilentlyContinue).MainWindowTitle"`
            ).catch(() => ({ stdout: '' }));
            const parentTitle = parentTitleResult.stdout?.trim();
            if (parentTitle) {
              windowTitle = parentTitle;
              logger.log(`[DEBUG Capture] PowerShell PID ${pid}: Fetched window title from parent WT process: "${windowTitle}"`);
            } else {
              logger.log(`[DEBUG Capture] PowerShell PID ${pid}: Parent WT has no window title`);
            }
          } catch (err: any) {
            logger.log(`[DEBUG Capture] PowerShell PID ${pid}: Failed to get parent WT window title:`, err?.message);
          }
        }

        // Get current directory using enhanced method
        let currentDirectory = await getCurrentWorkingDirectory(pid);

        // Get detailed running command information
        const runningCommands = await getRunningCommandDetails(pid);

        const claudeWorkspace = resolveClaudeWorkingDirectory(runningCommands, currentDirectory);
        if (claudeWorkspace && claudeWorkspace !== currentDirectory) {
          logger.log(
            `[Terminal Capture] PowerShell PID ${pid}: using Claude workspace ${claudeWorkspace}`
          );
          currentDirectory = claudeWorkspace;
        }

        // Get PowerShell history
        const historyResult = await getPowerShellHistory();

        // Get running child processes
        const runningProcesses = await getRunningProcesses(pid);

        // Get the last executed command
        const lastExecutedCommand = getLastExecutedCommand(historyResult);

        logger.log(`[DEBUG Capture] PowerShell PID ${pid} final metadata:`);
        logger.log(`[DEBUG Capture]   processName: ${procName}`);
        logger.log(`[DEBUG Capture]   powerShellVersion: ${powerShellVersion}`);
        logger.log(`[DEBUG Capture]   isWindowsTerminal: ${isWindowsTerminal} (will be saved to database)`);

        sessions.push({
          processId: pid,
          processName: procName,
          shellType: 'PowerShell',
          windowTitle: windowTitle, // Use fetched window title (from parent WT if applicable)
          mainWindowHandle, // Store window handle to detect visible windows even without titles
          currentDirectory,
          commandHistory: historyResult,
          runningProcesses,
          runningCommands,
          lastExecutedCommand,
          environmentVariables: await getCapturedEnvVars(),
          powerShellVersion,
          isWindowsTerminal, // Set whether this is running in Windows Terminal
          parentProcessId, // Store parent process ID for deduplication
          parentName: parentName?.trim() || undefined, // Store parent name for IDE filtering
          parentCommandLine: parentCommandLine?.trim() || undefined, // Store parent command for IDE filtering
          ownCommandLine: ownCommandLine || undefined, // Store process's own command line
        } as any);
        
        logDebug(`[PowerShell Capture] ✓ Successfully captured PID ${pid} (Windows Terminal: ${isWindowsTerminal}, Version: ${powerShellVersion})`);
      } catch (err: any) {
        logDebug(`[PowerShell Capture] ✗ Failed to capture details for PowerShell process ${proc.Id || 'unknown'}:`, err?.message || err);
        logDebug(`[PowerShell Capture] Error stack:`, err?.stack);
        console.warn(`Failed to capture details for PowerShell process ${proc.Id || 'unknown'}:`, err);
      }
    }
    
    logDebug(`[PowerShell Capture] ✓ Capture complete: ${sessions.length} PowerShell session(s) captured`);
  } catch (error: any) {
    logDebug('[PowerShell Capture] ============================================');
    logDebug('[PowerShell Capture] ✗ ERROR in capturePowerShellSessions()');
    logDebug('[PowerShell Capture] Error type:', error?.constructor?.name || typeof error);
    logDebug('[PowerShell Capture] Error message:', error?.message || String(error));
    logDebug('[PowerShell Capture] Error stack:', error?.stack);
    logDebug('[PowerShell Capture] ============================================');
    console.warn('No PowerShell sessions found or error capturing:', error);
  }

  return sessions;
}

/**
 * Capture CMD sessions on Windows
 */
async function captureCMDSessions(): Promise<TerminalSession[]> {
  const sessions: TerminalSession[] = [];

  try {
    const { stdout } = await execPromise(
      'powershell -Command "Get-Process cmd -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json"'
    );

    if (!stdout || stdout.trim() === '') {
      return sessions;
    }

    const processes = JSON.parse(stdout);
    const processList = Array.isArray(processes) ? processes : [processes];

    for (const proc of processList) {
      try {
        // Get parent process info for filtering IDE-integrated terminals
        let parentName: string | undefined;
        let parentCommandLine: string | undefined;
        let parentProcessId: number | undefined;

        try {
          const parentCheck = await execPromise(
            `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${proc.Id}\\").ParentProcessId"`
          ).catch(() => ({ stdout: '' }));

          if (parentCheck && parentCheck.stdout && parentCheck.stdout.trim()) {
            const parentId = parseInt(parentCheck.stdout.trim());
            parentProcessId = parentId;

            const parentNameResult = await execPromise(
              `powershell -Command "(Get-Process -Id ${parentId} -ErrorAction SilentlyContinue).ProcessName"`
            ).catch(() => ({ stdout: '' }));
            parentName = parentNameResult.stdout?.trim();

            const parentCmdResult = await execPromise(
              `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${parentId}\\").CommandLine"`
            ).catch(() => ({ stdout: '' }));
            parentCommandLine = parentCmdResult.stdout?.trim();
          }
        } catch (error) {
          // Parent info is optional - continue without it
        }

        // Get current directory
        const currentDirectory = await getCurrentWorkingDirectory(proc.Id);

        // Get running child processes
        const runningProcesses = await getRunningProcesses(proc.Id);

        // Get detailed running command information
        const runningCommands = await getRunningCommandDetails(proc.Id);

        sessions.push({
          processId: proc.Id,
          processName: 'cmd',
          shellType: 'CMD',
          windowTitle: proc.MainWindowTitle || undefined,
          currentDirectory,
          // CMD doesn't have persistent history in the same way
          commandHistory: [],
          runningProcesses,
          runningCommands,
          environmentVariables: await getCapturedEnvVars(),
          parentProcessId, // Store parent process ID for deduplication
          parentName: parentName || undefined,
          parentCommandLine: parentCommandLine || undefined,
        } as any);
      } catch (err) {
        console.warn(`Failed to capture details for CMD process ${proc.Id}:`, err);
      }
    }
  } catch (error) {
    console.warn('No CMD sessions found or error capturing:', error);
  }

  return sessions;
}

/**
 * Capture Git Bash sessions on Windows
 */
async function captureGitBashSessions(): Promise<TerminalSession[]> {
  const sessions: TerminalSession[] = [];

  try {
    const { stdout } = await execPromise(
      'powershell -Command "Get-Process bash,sh -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json"'
    );

    if (!stdout || stdout.trim() === '') {
      return sessions;
    }

    const processes = JSON.parse(stdout);
    const processList = Array.isArray(processes) ? processes : [processes];

    for (const proc of processList) {
      try {
        // Get parent process info for filtering IDE-integrated terminals
        let parentName: string | undefined;
        let parentCommandLine: string | undefined;
        let parentProcessId: number | undefined;

        try {
          const parentCheck = await execPromise(
            `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${proc.Id}\\").ParentProcessId"`
          ).catch(() => ({ stdout: '' }));

          if (parentCheck && parentCheck.stdout && parentCheck.stdout.trim()) {
            const parentId = parseInt(parentCheck.stdout.trim());
            parentProcessId = parentId;

            const parentNameResult = await execPromise(
              `powershell -Command "(Get-Process -Id ${parentId} -ErrorAction SilentlyContinue).ProcessName"`
            ).catch(() => ({ stdout: '' }));
            parentName = parentNameResult.stdout?.trim();

            const parentCmdResult = await execPromise(
              `powershell -Command "(Get-WmiObject Win32_Process -Filter \\"ProcessId = ${parentId}\\").CommandLine"`
            ).catch(() => ({ stdout: '' }));
            parentCommandLine = parentCmdResult.stdout?.trim();
          }
        } catch (error) {
          // Parent info is optional - continue without it
        }

        // Try to get bash history
        const bashHistory = await getBashHistory();

        // Get current directory
        const currentDirectory = await getCurrentWorkingDirectory(proc.Id);

        // Get running child processes
        const runningProcesses = await getRunningProcesses(proc.Id);

        // Get detailed running command information
        const runningCommands = await getRunningCommandDetails(proc.Id);

        // Get the last executed command
        const lastExecutedCommand = getLastExecutedCommand(bashHistory);

        sessions.push({
          processId: proc.Id,
          processName: proc.ProcessName || 'bash',
          shellType: 'GitBash',
          windowTitle: proc.MainWindowTitle || undefined,
          currentDirectory,
          commandHistory: bashHistory,
          runningProcesses,
          runningCommands,
          lastExecutedCommand,
          environmentVariables: await getCapturedEnvVars(),
          parentProcessId, // Store parent process ID for deduplication
          parentName: parentName || undefined,
          parentCommandLine: parentCommandLine || undefined,
        } as any);
      } catch (err) {
        console.warn(`Failed to capture details for Git Bash process ${proc.Id}:`, err);
      }
    }
  } catch (error) {
    console.warn('No Git Bash sessions found or error capturing:', error);
  }

  return sessions;
}

/**
 * Capture WSL sessions on Windows
 */
async function captureWSLSessions(): Promise<TerminalSession[]> {
  const sessions: TerminalSession[] = [];

  try {
    const { stdout } = await execPromise(
      'powershell -Command "Get-Process wsl -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json"'
    );

    if (!stdout || stdout.trim() === '') {
      return sessions;
    }

    const processes = JSON.parse(stdout);
    const processList = Array.isArray(processes) ? processes : [processes];

    for (const proc of processList) {
      try {
        // Try to get bash history (WSL typically uses bash)
        const bashHistory = await getBashHistory();

        // Get current directory
        const currentDirectory = await getCurrentWorkingDirectory(proc.Id);

        // Get running child processes
        const runningProcesses = await getRunningProcesses(proc.Id);

        // Get detailed running command information
        const runningCommands = await getRunningCommandDetails(proc.Id);

        // Get the last executed command
        const lastExecutedCommand = getLastExecutedCommand(bashHistory);

        sessions.push({
          processId: proc.Id,
          processName: 'wsl',
          shellType: 'WSL',
          windowTitle: proc.MainWindowTitle || undefined,
          currentDirectory,
          commandHistory: bashHistory,
          runningProcesses,
          runningCommands,
          lastExecutedCommand,
          environmentVariables: await getCapturedEnvVars(),
        });
      } catch (err) {
        console.warn(`Failed to capture details for WSL process ${proc.Id}:`, err);
      }
    }
  } catch (error) {
    console.warn('No WSL sessions found or error capturing:', error);
  }

  return sessions;
}

/**
 * Capture terminal sessions on macOS
 */
async function captureMacOSTerminals(): Promise<TerminalSession[]> {
  const sessions: TerminalSession[] = [];

  try {
    // Check for Terminal.app
    const { stdout: terminalPs } = await execPromise(
      'ps aux | grep -i "Terminal.app" | grep -v grep || true'
    );

    if (terminalPs && terminalPs.trim()) {
      const bashHistory = await getBashHistory();
      sessions.push({
        processId: 0,
        processName: 'Terminal',
        shellType: 'Unknown',
        commandHistory: bashHistory,
        environmentVariables: await getCapturedEnvVars(),
      });
    }

    // Check for iTerm
    const { stdout: itermPs } = await execPromise(
      'ps aux | grep -i "iTerm" | grep -v grep || true'
    );

    if (itermPs && itermPs.trim()) {
      const bashHistory = await getBashHistory();
      sessions.push({
        processId: 0,
        processName: 'iTerm',
        shellType: 'Unknown',
        commandHistory: bashHistory,
        environmentVariables: await getCapturedEnvVars(),
      });
    }
  } catch (error) {
    console.warn('Error capturing macOS terminals:', error);
  }

  return sessions;
}

/**
 * Capture terminal sessions on Linux
 */
async function captureLinuxTerminals(): Promise<TerminalSession[]> {
  const sessions: TerminalSession[] = [];

  try {
    const { stdout } = await execPromise(
      'ps aux | grep -E "gnome-terminal|xterm|konsole|terminator" | grep -v grep || true'
    );

    if (stdout && stdout.trim()) {
      const bashHistory = await getBashHistory();
      sessions.push({
        processId: 0,
        processName: 'terminal',
        shellType: 'Unknown',
        commandHistory: bashHistory,
        environmentVariables: await getCapturedEnvVars(),
      });
    }
  } catch (error) {
    console.warn('Error capturing Linux terminals:', error);
  }

  return sessions;
}

/**
 * Get PowerShell command history
 */
async function getPowerShellHistory(): Promise<string[]> {
  try {
    const historyPath = path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Microsoft',
      'Windows',
      'PowerShell',
      'PSReadLine',
      'ConsoleHost_history.txt'
    );

    if (fs.existsSync(historyPath)) {
      const historyContent = fs.readFileSync(historyPath, 'utf-8');
      const commands = historyContent.split('\n').filter((cmd) => cmd.trim());
      // Return last 50 commands
      return commands.slice(-50);
    }
  } catch (error) {
    console.warn('Could not read PowerShell history:', error);
  }

  return [];
}

/**
 * Get Bash command history
 */
async function getBashHistory(): Promise<string[]> {
  try {
    const historyPath = path.join(os.homedir(), '.bash_history');

    if (fs.existsSync(historyPath)) {
      const historyContent = fs.readFileSync(historyPath, 'utf-8');
      const commands = historyContent.split('\n').filter((cmd) => cmd.trim());
      // Return last 50 commands
      return commands.slice(-50);
    }
  } catch (error) {
    console.warn('Could not read Bash history:', error);
  }

  return [];
}

/**
 * Get important environment variables
 */
async function getCapturedEnvVars(): Promise<Record<string, string>> {
  const importantVars = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'PYTHON_HOME',
    'JAVA_HOME',
    'NODE_ENV',
    // NOTE: Do not capture sensitive tokens or credentials (NPM_TOKEN, API keys, etc.)
  ];

  const capturedVars: Record<string, string> = {};

  for (const varName of importantVars) {
    const value = process.env[varName];
    if (value) {
      capturedVars[varName] = value;
    }
  }

  return capturedVars;
}

/**
 * Extract working directory from command line
 */
function extractWorkingDirectory(commandLine: string): string | undefined {
  if (!commandLine) return undefined;

  // Try to extract directory from PowerShell command line
  const dirMatch = commandLine.match(/-WorkingDirectory\s+"([^"]+)"/i);
  if (dirMatch) {
    return dirMatch[1];
  }

  // Try to extract from -NoExit -Command "cd ..."
  const cdMatch = commandLine.match(/cd\s+"([^"]+)"/i);
  if (cdMatch) {
    return cdMatch[1];
  }

  return undefined;
}

/**
 * Get recently modified files in a directory (last 60 minutes)
 */
async function getRecentlyModifiedFiles(
  directory: string,
  minutes: number = 60
): Promise<string[]> {
  try {
    if (!directory || !fs.existsSync(directory)) {
      return [];
    }

    if (process.platform === 'win32') {
      // Use PowerShell to find recently modified files
      const script = `
        Get-ChildItem -Path "${directory}" -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.LastWriteTime -gt (Get-Date).AddMinutes(-${minutes}) -and
          $_.Extension -match '\\.(ts|tsx|js|jsx|py|java|cpp|c|cs|go|rs|vue|svelte|html|css|scss|json|yaml|yml|md)$'
        } |
        Select-Object -First 20 -ExpandProperty FullName
      `.trim();

      const { stdout } = await execPromise(`powershell -Command "${script}"`).catch(() => ({ stdout: '' }));

      if (!stdout || !stdout.trim()) {
        return [];
      }

      return stdout.split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0)
        .map(f => f.replace(directory, '.'));
    } else {
      // Unix-like systems (macOS, Linux)
      const { stdout } = await execPromise(
        `find "${directory}" -type f -mmin -${minutes} -regex '.*\\.(ts|tsx|js|jsx|py|java|cpp|c|cs|go|rs|vue|svelte|html|css|scss|json|yaml|yml|md)$' | head -n 20`
      ).catch(() => ({ stdout: '' }));

      return stdout.split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0)
        .map(f => f.replace(directory, '.'));
    }
  } catch (error) {
    console.warn('Error getting recently modified files:', error);
    return [];
  }
}

/**
 * Get git status for a directory
 */
async function getGitStatus(directory: string): Promise<GitStatus | undefined> {
  try {
    if (!directory || !fs.existsSync(directory)) {
      return undefined;
    }

    // Check if this is a git repository
    const gitDir = path.join(directory, '.git');
    if (!fs.existsSync(gitDir)) {
      return undefined;
    }

    // Get current branch
    const { stdout: branchOutput } = await execPromise('git branch --show-current', {
      cwd: directory
    }).catch(() => ({ stdout: '' }));

    if (!branchOutput || !branchOutput.trim()) {
      return undefined;
    }

    const branch = branchOutput.trim();

    // Get git status
    const { stdout: statusOutput } = await execPromise('git status --short', {
      cwd: directory
    }).catch(() => ({ stdout: '' }));

    const modified: string[] = [];
    const untracked: string[] = [];

    if (statusOutput) {
      statusOutput.split('\n').forEach(line => {
        line = line.trim();
        if (!line) return;

        if (line.startsWith('M ') || line.startsWith(' M')) {
          modified.push(line.substring(2).trim());
        } else if (line.startsWith('??')) {
          untracked.push(line.substring(2).trim());
        }
      });
    }

    return {
      branch,
      modifiedFiles: modified,
      untrackedFiles: untracked
    };
  } catch (error) {
    console.warn('Error getting git status:', error);
    return undefined;
  }
}

/**
 * Get relevant project files in a directory
 */
async function getProjectFiles(directory: string): Promise<string[]> {
  try {
    if (!directory || !fs.existsSync(directory)) {
      return [];
    }

    const files: string[] = [];

    // Read directory contents
    const readDir = (dir: string, depth: number = 0) => {
      if (depth > 3) return; // Limit depth to avoid too much recursion

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip node_modules, .git, dist, build, etc.
          if (entry.name === 'node_modules' ||
              entry.name === '.git' ||
              entry.name === 'dist' ||
              entry.name === 'build' ||
              entry.name === '.next' ||
              entry.name === 'out' ||
              entry.name.startsWith('.')) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);
          const relativePath = fullPath.replace(directory, '.').replace(/\\/g, '/');

          if (entry.isDirectory()) {
            readDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            // Only include source files
            const ext = path.extname(entry.name);
            if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.vue', '.svelte'].includes(ext)) {
              files.push(relativePath);
            }
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    };

    readDir(directory);

    // Limit to first 50 files
    return files.slice(0, 50);
  } catch (error) {
    console.warn('Error getting project files:', error);
    return [];
  }
}

/**
 * Utility function to add timeout to promises
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, defaultValue: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(defaultValue), timeoutMs))
  ]);
}

/**
 * Attempt to capture recent terminal output/conversation
 * This looks for PowerShell transcripts, Claude logs, etc.
 */
async function captureTerminalOutput(session: TerminalSession): Promise<string | undefined> {
  try {
    let output: string | undefined;

    // Approach 1: Check for PowerShell transcript files (if user has transcription enabled)
    if (session.shellType === 'PowerShell') {
      try {
        const transcriptDir = path.join(os.homedir(), 'Documents', 'PowerShell_transcript');
        if (fs.existsSync(transcriptDir)) {
          const transcriptFiles = fs.readdirSync(transcriptDir)
            .filter(f => f.startsWith('PowerShell_transcript'))
            .map(f => ({
              name: f,
              path: path.join(transcriptDir, f),
              mtime: fs.statSync(path.join(transcriptDir, f)).mtime
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

          if (transcriptFiles.length > 0) {
            // Read the most recent transcript (last 10KB only to avoid huge files)
            const transcriptPath = transcriptFiles[0].path;
            const stats = fs.statSync(transcriptPath);
            const start = Math.max(0, stats.size - 10240); // Last 10KB
            const buffer = Buffer.alloc(10240);
            const fd = fs.openSync(transcriptPath, 'r');
            fs.readSync(fd, buffer, 0, 10240, start);
            fs.closeSync(fd);
            output = buffer.toString('utf-8');
            logger.log(`Captured ${output.length} bytes from PowerShell transcript`);
          }
        }
      } catch (err) {
        // Transcript not available, continue to next approach
      }
    }

    // Approach 2: Try to read recent command output using PowerShell's history
    if (!output && session.processId) {
      try {
        // Use PowerShell to get console screen buffer if possible
        // This is a best-effort attempt - may not work for all terminal types
        const cmd = `powershell -NoProfile -NonInteractive -Command "& { $host.UI.RawUI.BufferSize | Out-Null; (Get-History -Count 10 | ForEach-Object { $_.CommandLine }) -join '\\n' }"`;
        const result = execSync(cmd, { timeout: 2000, encoding: 'utf-8' }).trim();
        if (result) {
          output = result;
          logger.log(`Captured command history via PowerShell`);
        }
      } catch (err) {
        // Not available
      }
    }

    // Approach 3: Look for Claude CLI conversation logs/cache
    // Claude Code might store conversation in various locations
    const possibleLogLocations = [
      path.join(os.homedir(), '.anthropic', 'logs'),
      path.join(os.homedir(), '.claude', 'logs'),
      path.join(os.homedir(), '.config', 'claude', 'logs'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'logs'),
      path.join(os.homedir(), 'AppData', 'Local', 'Claude', 'logs'),
    ];

    for (const logDir of possibleLogLocations) {
      if (!output && fs.existsSync(logDir)) {
        try {
          const logFiles = fs.readdirSync(logDir)
            .map(f => ({
              name: f,
              path: path.join(logDir, f),
              mtime: fs.statSync(path.join(logDir, f)).mtime
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

          if (logFiles.length > 0) {
            // Read most recent log file (last 10KB)
            const logPath = logFiles[0].path;
            const stats = fs.statSync(logPath);
            const start = Math.max(0, stats.size - 10240);
            const buffer = Buffer.alloc(Math.min(10240, stats.size));
            const fd = fs.openSync(logPath, 'r');
            fs.readSync(fd, buffer, 0, buffer.length, start);
            fs.closeSync(fd);
            output = buffer.toString('utf-8');
            logger.log(`Captured ${output.length} bytes from Claude log file: ${logPath}`);
            break;
          }
        } catch (err) {
          // Log directory exists but couldn't read files
        }
      }
    }

    return output;
  } catch (error) {
    console.warn('Error capturing terminal output:', error);
    return undefined;
  }
}

/**
 * Parse Claude Code conversation from terminal output
 * Extracts the last 2-3 message exchanges (user questions + Claude responses)
 */
function parseClaudeConversation(terminalOutput: string): string {
  try {
    // Claude Code conversation format typically includes:
    // - User messages (prefixed with ">", "You:", or just the question)
    // - Claude responses (can be multi-line, often with tool uses)

    const lines = terminalOutput.split('\n');
    const messages: { type: 'user' | 'assistant'; content: string[] }[] = [];
    let currentMessage: { type: 'user' | 'assistant'; content: string[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and prompts
      if (!line || line.match(/^PS\s+/)) continue;

      // Detect user message (questions, commands to Claude)
      // Common patterns: lines that look like questions or commands
      if (line.match(/^>/) || line.match(/^\?/) ||
          (currentMessage?.type === 'assistant' && line.length > 10 && line.endsWith('?'))) {
        // Start new user message
        if (currentMessage) messages.push(currentMessage);
        currentMessage = { type: 'user', content: [line.replace(/^>\s*/, '')] };
      }
      // Detect Claude's response (often starts with keywords or contains longer explanations)
      else if (line.match(/^(I'll|Let me|I'm|I can|Based on|Looking at|Here|This|The)/i) ||
               line.match(/<function_calls>/) ||
               (currentMessage?.type === 'user' && line.length > 20)) {
        // Start new assistant message
        if (currentMessage) messages.push(currentMessage);
        currentMessage = { type: 'assistant', content: [line] };
      }
      // Continue current message
      else if (currentMessage && line.length > 0) {
        currentMessage.content.push(line);
      }
    }

    // Add the last message
    if (currentMessage) messages.push(currentMessage);

    // Extract last 2-3 exchanges (user + assistant pairs)
    const exchanges: string[] = [];
    let exchangeCount = 0;
    for (let i = messages.length - 1; i >= 0 && exchangeCount < 3; i--) {
      const msg = messages[i];
      const content = msg.content.join('\n').substring(0, 500); // Limit to 500 chars per message

      if (msg.type === 'user') {
        exchanges.unshift(`**You:** ${content}`);
        exchangeCount++;
      } else {
        exchanges.unshift(`**Claude:** ${content}`);
      }

      // Stop after 3 user messages
      if (msg.type === 'user' && exchangeCount >= 3) break;
    }

    if (exchanges.length > 0) {
      return exchanges.join('\n\n');
    }

    return '';
  } catch (error) {
    console.warn('Error parsing Claude conversation:', error);
    return '';
  }
}

/**
 * Capture Claude Code context if Claude Code is running
 */
async function captureClaudeCodeContext(
  session: TerminalSession
): Promise<ClaudeCodeContext | undefined> {
  try {
    // Enhanced Claude Code detection - check multiple patterns
    let claudeCommand: RunningCommand | undefined;
    
    if (session.runningCommands) {
      // Look for Claude Code processes with various patterns
      claudeCommand = session.runningCommands.find(cmd => {
        const cmdLine = cmd.commandLine?.toLowerCase() || '';
        // Check for various Claude CLI patterns
        return cmdLine.includes('claude') || 
               cmd.processName?.toLowerCase().includes('claude') ||
               (cmd.processName === 'node.exe' && cmdLine.includes('claude'));
      });
    }

    // Also check in running processes list
    if (!claudeCommand && session.runningProcesses) {
      const hasClaudeProcess = session.runningProcesses.some(p => 
        p.toLowerCase().includes('claude')
      );
      
      // If we found Claude in processes but not in commands, try to find it
      if (hasClaudeProcess && session.runningCommands) {
        claudeCommand = session.runningCommands.find(cmd => {
          const cmdLine = cmd.commandLine?.toLowerCase() || '';
          return cmdLine.includes('node') && cmdLine.includes('claude');
        });
      }
    }

    if (!claudeCommand) {
      return undefined;
    }

    let cwd = session.currentDirectory;
    if (!cwd) {
      return undefined;
    }

    logger.log(`Detected Claude Code session in: ${cwd}`);

    // SMART DIRECTORY DETECTION: If we're in the home directory, try to find the actual project directory
    // Claude Code is likely running in a project directory, not the home directory
    if (cwd === os.homedir() || cwd.toLowerCase() === os.homedir().toLowerCase()) {
      logger.log(`[Claude Context] Currently in home directory, searching for actual project directory...`);

      // Method 1: Look for git repositories with recent commits/changes
      const commonProjectDirs = [
        path.join(os.homedir(), 'Desktop'),
        path.join(os.homedir(), 'Documents'),
        path.join(os.homedir(), 'Projects'),
        path.join(os.homedir(), 'repos'),
        path.join(os.homedir(), 'code'),
        path.join(os.homedir(), 'dev'),
      ];

      for (const baseDir of commonProjectDirs) {
        if (!fs.existsSync(baseDir)) continue;

        try {
          // Find all git repositories
          const entries = fs.readdirSync(baseDir, { withFileTypes: true });
          const gitRepos = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => path.join(baseDir, e.name))
            .filter(dir => {
              try {
                return fs.existsSync(path.join(dir, '.git'));
              } catch {
                return false;
              }
            });

          // Check each git repo for recent activity
          for (const gitRepo of gitRepos) {
            try {
              // Check if there are uncommitted changes (files in staging or worktree)
              const { stdout: statusOutput } = await execPromise(
                'git status --short',
                { cwd: gitRepo, timeout: 2000 }
              ).catch(() => ({ stdout: '' }));

              if (statusOutput && statusOutput.trim()) {
                // Has uncommitted changes - this is likely the active project!
                logger.log(`[Claude Context] Found git repository with uncommitted changes: ${gitRepo}`);
                cwd = gitRepo;
                break;
              }

              // Check last commit time
              const { stdout: lastCommit } = await execPromise(
                'git log -1 --format=%ct',
                { cwd: gitRepo, timeout: 2000 }
              ).catch(() => ({ stdout: '' }));

              if (lastCommit && lastCommit.trim()) {
                const commitTime = parseInt(lastCommit.trim()) * 1000; // Convert to milliseconds
                const oneHourAgo = Date.now() - (60 * 60 * 1000);

                if (commitTime > oneHourAgo) {
                  logger.log(`[Claude Context] Found git repository with recent commit: ${gitRepo}`);
                  cwd = gitRepo;
                  break;
                }
              }
            } catch (e) {
              // Skip repos we can't check
            }
          }

          if (cwd !== os.homedir()) break; // Found a directory
        } catch (e) {
          // Skip directories we can't read
        }
      }

      // Method 2: Check command history for cd commands
      if (cwd === os.homedir() && session.commandHistory && session.commandHistory.length > 0) {
        const cdCommand = session.commandHistory
          .slice()
          .reverse()
          .find(cmd => cmd.trim().toLowerCase().startsWith('cd ') || cmd.trim().toLowerCase().startsWith('set-location'));

        if (cdCommand) {
          const match = cdCommand.match(/(?:cd|set-location)\s+["']?([^"']+)["']?/i);
          if (match && match[1]) {
            let targetDir = match[1].trim();

            if (!path.isAbsolute(targetDir)) {
              targetDir = path.resolve(os.homedir(), targetDir);
            }

            if (fs.existsSync(targetDir)) {
              logger.log(`[Claude Context] Found directory from command history: ${targetDir}`);
              cwd = targetDir;
            }
          }
        }
      }

      if (cwd !== os.homedir()) {
        logger.log(`[Claude Context] Detected actual working directory: ${cwd}`);
      } else {
        logger.log(`[Claude Context] Could not detect project directory, using home directory`);
      }
    }

    // Extract the exact command used to start Claude Code
    let startupCommand = 'claude'; // Default fallback
    if (claudeCommand.commandLine) {
      // Try to extract the actual command from the command line
      const cmdLine = claudeCommand.commandLine;
      
      // Look for patterns like: node claude, npx claude, claude --path, etc.
      const claudeMatch = cmdLine.match(/(?:npx\s+)?claude(?:\s+[^\s]+)*/i);
      if (claudeMatch) {
        startupCommand = claudeMatch[0].trim();
      } else if (cmdLine.includes('claude')) {
        // Fallback: extract just the claude part with any immediate flags
        const simplified = cmdLine.match(/(?:node(?:\.exe)?\s+)?(?:.*\/)?(?:npx\s+)?(claude(?:\s+[^\s]+)*)/i);
        if (simplified && simplified[1]) {
          startupCommand = simplified[1].trim();
        }
      }
    }

    // Get command history before Claude Code was started
    // Find the index where Claude was started, then get commands before that
    let commandHistoryBeforeStart: string[] = [];
    if (session.commandHistory && session.commandHistory.length > 0) {
      // Find commands that likely started Claude Code
      const history = session.commandHistory;
      const claudeIndex = history.findIndex(cmd => 
        cmd.toLowerCase().includes('claude')
      );
      
      if (claudeIndex >= 0) {
        // Get the last 10 commands before Claude was started
        commandHistoryBeforeStart = history.slice(Math.max(0, claudeIndex - 10), claudeIndex);
      } else {
        // If we can't find it, use the last few commands
        commandHistoryBeforeStart = history.slice(-5);
      }
    }

    // Get recently modified files with 5 second timeout
    const recentFiles = await withTimeout(
      getRecentlyModifiedFiles(cwd, 60),
      5000,
      []
    );

    // Get git status with 3 second timeout
    const gitStatus = await withTimeout(
      getGitStatus(cwd),
      3000,
      undefined
    );

    // Get project files with 5 second timeout
    const projectFiles = await withTimeout(
      getProjectFiles(cwd),
      5000,
      []
    );

    logger.log(`Claude Code context captured: ${recentFiles.length} recent files, ${projectFiles.length} project files`);
    logger.log(`Claude Code startup command: ${startupCommand}`);

    // Parse conversation from terminal output if available
    let contextHint = '';
    if (session.terminalOutput && session.terminalOutput.length > 0) {
      contextHint = parseClaudeConversation(session.terminalOutput);
      if (contextHint) {
        logger.log(`Parsed Claude Code conversation: ${contextHint.length} chars`);
      }
    }

    return {
      isClaudeCodeRunning: true,
      workingDirectory: cwd,
      projectFiles,
      recentlyModifiedFiles: recentFiles,
      gitStatus,
      sessionStartTime: new Date(),
      contextHint: contextHint || '', // Parsed conversation or empty
      startupCommand,
      commandHistoryBeforeStart
    };
  } catch (error) {
    console.warn('Error capturing Claude Code context:', error);
    return undefined;
  }
}

/**
 * Infer what the user was working on based on context
 */
function inferSessionSummary(claude: ClaudeCodeContext): string {
  const summary: string[] = [];

  // Analyze modified files to infer work type
  let workType = 'development work';
  const modifiedFiles = claude.gitStatus?.modifiedFiles || [];
  const recentFiles = claude.recentlyModifiedFiles || [];

  if (modifiedFiles.length > 0 || recentFiles.length > 0) {
    const allFiles = [...modifiedFiles, ...recentFiles].map(f => f.toLowerCase());

    // Try to infer what type of work based on file names and patterns
    if (allFiles.some(f => f.includes('test') || f.includes('spec'))) {
      workType = 'testing and bug fixes';
    } else if (allFiles.some(f => f.includes('fix') || f.includes('bug'))) {
      workType = 'bug fixes';
    } else if (allFiles.some(f => f.includes('.md') && !f.includes('readme'))) {
      workType = 'documentation and code changes';
    } else if (allFiles.some(f => f.includes('component') || f.includes('page'))) {
      workType = 'UI development';
    } else if (allFiles.some(f => f.includes('api') || f.includes('endpoint'))) {
      workType = 'backend/API development';
    } else if (allFiles.some(f => f.includes('style') || f.includes('.css'))) {
      workType = 'styling and UI work';
    }

    summary.push(`You were actively working on **${workType}** in the \`${claude.workingDirectory}\` directory.`);
  } else {
    summary.push(`Session was active in \`${claude.workingDirectory}\`.`);
  }

  // Provide file-specific context
  if (recentFiles.length > 0) {
    summary.push(`${recentFiles.length} file(s) were modified in the last hour.`);
    // Mention the most important files
    const importantFiles = recentFiles.filter(f =>
      !f.includes('node_modules') &&
      !f.includes('.log') &&
      !f.includes('dist/')
    ).slice(0, 3);
    if (importantFiles.length > 0) {
      summary.push(`Key files: ${importantFiles.map(f => `\`${f}\``).join(', ')}`);
    }
  }

  // Check git status for uncommitted changes
  if (modifiedFiles.length > 0) {
    summary.push(`You have **${modifiedFiles.length} uncommitted change(s)** in git - work in progress.`);
  }

  // Check command history for clues
  if (claude.commandHistoryBeforeStart && claude.commandHistoryBeforeStart.length > 0) {
    const lastCommands = claude.commandHistoryBeforeStart.slice(-5);
    const hasDevServer = lastCommands.some(cmd =>
      cmd.includes('npm run dev') || cmd.includes('npm start') || cmd.includes('dev:electron')
    );
    const hasBuild = lastCommands.some(cmd => cmd.includes('build') || cmd.includes('compile'));
    const hasTest = lastCommands.some(cmd => cmd.includes('test') || cmd.includes('jest') || cmd.includes('vitest'));

    if (hasDevServer) {
      summary.push('A **development server was running** before capture.');
    }
    if (hasBuild) {
      summary.push('The project was being **compiled/built** recently.');
    }
    if (hasTest) {
      summary.push('**Tests were being run** before capture.');
    }
  }

  if (summary.length === 0) {
    summary.push('No specific context available from the previous session.');
  }

  return summary.join(' ');
}

/**
 * Infer active tasks based on git status and recent files
 */
function inferActiveTasks(claude: ClaudeCodeContext): string {
  const tasks: string[] = [];

  // Check git status for work in progress
  if (claude.gitStatus?.modifiedFiles && claude.gitStatus.modifiedFiles.length > 0) {
    tasks.push('**Review and commit changes:**');
    tasks.push('  - Review the modified files listed in Git Status section');
    tasks.push('  - Consider committing or continuing work on these changes');
    tasks.push('');
  }

  // Check for recently modified files
  if (claude.recentlyModifiedFiles && claude.recentlyModifiedFiles.length > 0) {
    const topFiles = claude.recentlyModifiedFiles.slice(0, 5);
    tasks.push('**Continue work on recently modified files:**');
    topFiles.forEach(file => {
      tasks.push(`  - ${file}`);
    });
    if (claude.recentlyModifiedFiles.length > 5) {
      tasks.push(`  - ... and ${claude.recentlyModifiedFiles.length - 5} more`);
    }
    tasks.push('');
  }

  // Check for untracked files
  if (claude.gitStatus?.untrackedFiles && claude.gitStatus.untrackedFiles.length > 0) {
    tasks.push('**New files to review:**');
    tasks.push(`  - ${claude.gitStatus.untrackedFiles.length} untracked file(s) - consider adding to git`);
    tasks.push('');
  }

  if (tasks.length === 0) {
    tasks.push('No specific active tasks detected. Ask the user what they\'d like to work on.');
  }

  return tasks.join('\n');
}

/**
 * Suggest next steps based on command history and project state
 */
function inferNextSteps(claude: ClaudeCodeContext): string {
  const steps: string[] = [];
  let stepNumber = 1;

  // Check if dev server was running
  if (claude.commandHistoryBeforeStart && claude.commandHistoryBeforeStart.length > 0) {
    const lastCommands = claude.commandHistoryBeforeStart.slice(-5);

    // Look for dev server commands
    const devCommand = lastCommands.find(cmd =>
      cmd.includes('npm run dev') ||
      cmd.includes('npm start') ||
      cmd.includes('dev:electron') ||
      cmd.includes('vite')
    );

    if (devCommand) {
      steps.push(`${stepNumber}. **Restart the development server** (it was running before):`);
      steps.push(`   \`\`\`bash`);
      steps.push(`   ${devCommand.trim()}`);
      steps.push(`   \`\`\``);
      stepNumber++;
    }
  }

  // Suggest reviewing changes if there are modified files
  if (claude.gitStatus?.modifiedFiles && claude.gitStatus.modifiedFiles.length > 0) {
    steps.push(`${stepNumber}. **Review uncommitted changes:**`);
    steps.push(`   \`\`\`bash`);
    steps.push(`   git diff`);
    steps.push(`   \`\`\``);
    stepNumber++;
  }

  // Suggest checking recently modified files
  if (claude.recentlyModifiedFiles && claude.recentlyModifiedFiles.length > 0) {
    steps.push(`${stepNumber}. **Continue editing recent files:**`);
    const topFile = claude.recentlyModifiedFiles[0];
    steps.push(`   - Start with: \`${topFile}\``);
    stepNumber++;
  }

  // Default suggestion
  if (steps.length === 0) {
    steps.push('1. Ask the user what they\'d like to work on');
    steps.push('2. Review the project structure and recent files above');
  } else {
    steps.push(`${stepNumber}. Ask the user if they want to continue with these tasks or work on something else`);
  }

  return steps.join('\n');
}

/**
 * Generate a markdown context file for Claude Code session restoration
 */
function generateClaudeContextFile(claude: ClaudeCodeContext): string {
  const lines: string[] = [];

  // SMART WORKING DIRECTORY DETECTION
  // If command history shows a 'cd' command, use that directory for git operations
  // This handles cases where PowerShell reports the old directory before 'cd' completed
  let actualWorkingDir = claude.workingDirectory;

  if (claude.commandHistoryBeforeStart && claude.commandHistoryBeforeStart.length > 0) {
    // Look for the last 'cd' command
    const cdCommand = claude.commandHistoryBeforeStart
      .slice()
      .reverse()
      .find(cmd => cmd.trim().startsWith('cd '));

    if (cdCommand) {
      // Extract the directory from 'cd "path"' or 'cd path'
      const match = cdCommand.match(/cd\s+["']?([^"']+)["']?/);
      if (match && match[1]) {
        let targetDir = match[1].trim();

        // If it's a relative path, resolve it relative to current working directory
        if (!path.isAbsolute(targetDir)) {
          targetDir = path.resolve(claude.workingDirectory, targetDir);
        }

        // Verify the directory exists before using it
        try {
          if (fs.existsSync(targetDir)) {
            actualWorkingDir = targetDir;
            logger.log(`[Context] Using directory from cd command: ${actualWorkingDir}`);
          }
        } catch (e) {
          // Keep using reported working directory
        }
      }
    }
  }

  lines.push('# 🔄 FlowState Session Restoration');
  lines.push('');

  // ============================================================================
  // CRITICAL CONTEXT (Lines 1-50) - This is what Claude Code will definitely read
  // ============================================================================

  lines.push('## 🎯 WHAT YOU WERE WORKING ON');
  lines.push('');

  // Get the work summary first
  const modifiedFiles = claude.gitStatus?.modifiedFiles || [];
  const recentFiles = claude.recentlyModifiedFiles || [];

  // Check for documentation files that explain the work
  const docFiles = modifiedFiles.filter(f =>
    f.endsWith('.md') &&
    !f.toLowerCase().includes('readme') &&
    !f.toLowerCase().includes('changelog')
  );

  // Read documentation files to understand what was being worked on
  let workContext: string[] = [];
  if (docFiles.length > 0) {
    docFiles.slice(0, 3).forEach(file => {
      try {
        const fullPath = path.join(actualWorkingDir, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        // Extract key information from the doc file
        let title = file.replace('.md', '').replace(/-/g, ' ');
        let problem = '';
        let solution = '';

        // Look for Problem/Root Cause/Solution sections
        for (let i = 0; i < Math.min(lines.length, 100); i++) {
          const line = lines[i].toLowerCase();
          if (line.includes('## problem') || line.includes('## root cause')) {
            // Get next few lines as problem description
            problem = lines.slice(i + 1, i + 5)
              .filter(l => l.trim() && !l.startsWith('#'))
              .join(' ')
              .substring(0, 150);
          }
          if (line.includes('## solution') || line.includes('## fix')) {
            solution = lines.slice(i + 1, i + 5)
              .filter(l => l.trim() && !l.startsWith('#'))
              .join(' ')
              .substring(0, 150);
          }
        }

        if (problem || solution) {
          workContext.push(`**${title}:**`);
          if (problem) workContext.push(`  Problem: ${problem.trim()}`);
          if (solution) workContext.push(`  Fix: ${solution.trim()}`);
        }
      } catch (e) {
        // Skip files that can't be read
      }
    });
  }

  // Display work context prominently
  if (workContext.length > 0) {
    lines.push('**Based on your documentation, you were working on:**');
    lines.push('');
    workContext.forEach(line => lines.push(line));
    lines.push('');
  } else if (modifiedFiles.length > 0) {
    lines.push(`**You have ${modifiedFiles.length} uncommitted changes** - work in progress!`);
    lines.push('');
    lines.push('**Files you were editing:**');
    modifiedFiles.slice(0, 5).forEach(file => {
      lines.push(`  • ${file}`);
    });
    if (modifiedFiles.length > 5) {
      lines.push(`  • ... and ${modifiedFiles.length - 5} more`);
    }
    lines.push('');
  } else if (recentFiles.length > 0) {
    lines.push('**Recently modified files:**');
    recentFiles.slice(0, 5).forEach(file => {
      lines.push(`  • ${file}`);
    });
    lines.push('');
  } else {
    // No file changes - infer task from command history and activity
    lines.push('**No recent file modifications detected.**');
    lines.push('');

    // Detect task from command history
    if (claude.commandHistoryBeforeStart && claude.commandHistoryBeforeStart.length > 0) {
      const commands = claude.commandHistoryBeforeStart.slice(-10);

      let taskDescription = '';

      if (commands.some(cmd => cmd.includes('test') || cmd.includes('jest') || cmd.includes('vitest'))) {
        taskDescription = 'Running tests';
      } else if (commands.some(cmd => cmd.includes('npm run dev') || cmd.includes('dev:electron'))) {
        taskDescription = 'Testing/debugging the application (dev server running)';
      } else if (commands.some(cmd => cmd.includes('npm run build') || cmd.includes('compile'))) {
        taskDescription = 'Building/compiling the project';
      } else if (commands.some(cmd => cmd.includes('git diff') || cmd.includes('git log') || cmd.includes('git status'))) {
        taskDescription = 'Reviewing git changes';
      } else if (commands.some(cmd => cmd.includes('cd ') && cmd.includes('flowstate'))) {
        taskDescription = 'Working on the FlowState project';
      }

      if (taskDescription) {
        lines.push(`**Based on recent commands, you were likely:**`);
        lines.push(`  ${taskDescription}`);
        lines.push('');
      }
    }
  }

  lines.push('**Working in:** `' + actualWorkingDir + '`');
  lines.push('');

  // ============================================================================
  // PREVIOUS CLAUDE CODE CONVERSATION - Show what they were asking/discussing
  // ============================================================================
  if (claude.contextHint && claude.contextHint.trim().length > 0) {
    lines.push('## 💬 PREVIOUS CONVERSATION');
    lines.push('');
    lines.push('**What you were discussing with Claude before capture:**');
    lines.push('');

    // The contextHint might contain the last conversation context
    lines.push(claude.contextHint);
    lines.push('');
  } else {
    // Try to extract conversation from terminal output or command history
    const commandHistory = claude.commandHistoryBeforeStart || [];

    // Look for patterns that suggest what the user was working on
    const workIndicators: string[] = [];

    // Check for error-related commands (suggests debugging)
    if (commandHistory.some(cmd => cmd.includes('grep') && (cmd.includes('error') || cmd.includes('Error')))) {
      workIndicators.push('- You were **searching for errors** in the codebase');
    }

    // Check for test-related commands
    if (commandHistory.some(cmd => cmd.includes('test') || cmd.includes('jest') || cmd.includes('vitest'))) {
      workIndicators.push('- You were **running tests**');
    }

    // Check for git investigation
    if (commandHistory.some(cmd => cmd.includes('git diff') || cmd.includes('git log'))) {
      workIndicators.push('- You were **reviewing recent changes** with git');
    }

    // Check for file navigation/searching
    if (commandHistory.some(cmd => cmd.includes('find') || cmd.includes('ls') || cmd.includes('dir'))) {
      workIndicators.push('- You were **exploring the project structure**');
    }

    // Check for compilation/build
    if (commandHistory.some(cmd => cmd.includes('compile') || cmd.includes('build') || cmd.includes('tsc'))) {
      workIndicators.push('- You were **compiling/building** the project');
    }

    if (workIndicators.length > 0) {
      lines.push('## 💬 RECENT ACTIVITY');
      lines.push('');
      lines.push('**Based on your terminal commands:**');
      lines.push('');
      workIndicators.forEach(indicator => lines.push(indicator));
      lines.push('');
    }
  }

  // ============================================================================
  // PRECISE WORK LOCATION - Show EXACTLY where they were working
  // ============================================================================
  if (modifiedFiles.length > 0) {
    lines.push('## 🎯 EXACT WORK LOCATION');
    lines.push('');

    try {
      // Get git diff to find which lines were changed
      const diffOutput = execSync(`git diff --unified=5 -- "${modifiedFiles[0]}"`, {
        cwd: actualWorkingDir,
        encoding: 'utf-8',
        timeout: 3000
      }).trim();

      if (diffOutput) {
        // Parse diff to find changed line numbers
        const hunkMatches = diffOutput.matchAll(/@@ -(\d+),?\d* \+(\d+),?\d* @@/g);
        const changedLines: number[] = [];

        for (const match of hunkMatches) {
          changedLines.push(parseInt(match[2])); // New line number
        }

        if (changedLines.length > 0) {
          const primaryFile = modifiedFiles[0];
          const lineNum = changedLines[0]; // First changed line

          // Read the file and extract 5 lines around the change
          const fullPath = path.join(actualWorkingDir, primaryFile);
          const fileContent = fs.readFileSync(fullPath, 'utf-8');
          const fileLines = fileContent.split('\n');

          const startLine = Math.max(0, lineNum - 3);
          const endLine = Math.min(fileLines.length, lineNum + 2);
          const codeSnippet = fileLines.slice(startLine, endLine);

          // Describe what they were doing
          lines.push(`**You were working on line ${lineNum} of \`${primaryFile}\`**`);
          lines.push('');

          // Analyze the change to describe it
          const addedLines = diffOutput.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
          const removedLines = diffOutput.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));

          if (addedLines.length > removedLines.length) {
            lines.push(`You were **adding functionality** (${addedLines.length} new lines).`);
          } else if (removedLines.length > addedLines.length) {
            lines.push(`You were **removing/refactoring code** (${removedLines.length} lines removed).`);
          } else {
            lines.push(`You were **modifying existing code** (${addedLines.length} lines changed).`);
          }
          lines.push('');

          // Show the code context
          lines.push('**Code at this location:**');
          lines.push('```typescript');
          codeSnippet.forEach((line, idx) => {
            const actualLineNum = startLine + idx + 1;
            const marker = actualLineNum === lineNum ? ' ← YOU WERE HERE' : '';
            lines.push(`${actualLineNum}: ${line}${marker}`);
          });
          lines.push('```');
          lines.push('');

          // Infer what they were trying to do based on code analysis
          const lastAddedLine = addedLines[addedLines.length - 1]?.substring(1).trim() || '';
          if (lastAddedLine.includes('TODO')) {
            lines.push(`📝 **Note:** You left a TODO comment, suggesting this work is incomplete.`);
          } else if (lastAddedLine.includes('async') || lastAddedLine.includes('await')) {
            lines.push(`⏳ **Context:** You were working with asynchronous code - check if error handling is complete.`);
          } else if (lastAddedLine.includes('try') || lastAddedLine.includes('catch')) {
            lines.push(`🛡️ **Context:** You were adding error handling - verify all edge cases are covered.`);
          }
          lines.push('');
        }
      }
    } catch (e) {
      // Git diff failed, fall back to basic description
      lines.push(`You were modifying **${modifiedFiles[0]}**`);
      lines.push('');
    }
  }

  lines.push('## ⚡ WHAT TO DO NOW');
  lines.push('');
  lines.push('**Ask the user which of the following they\'d like to do:**');
  lines.push('');

  // Build contextual options based on what was being worked on
  const options: string[] = [];

  // Option 1: Continue the work that was in progress
  if (workContext.length > 0) {
    // Extract work type from documentation
    const workDescription = workContext[0].toLowerCase();
    if (workDescription.includes('terminal') || workDescription.includes('capture')) {
      options.push('1. **Continue debugging the terminal capture issues** (review fixes and test)');
    } else if (workDescription.includes('context') || workDescription.includes('restoration')) {
      options.push('1. **Continue enhancing the Claude Code context restoration** (review and test)');
    } else {
      options.push('1. **Continue working on the in-progress features** (review uncommitted changes)');
    }
  } else if (modifiedFiles.length > 0) {
    options.push('1. **Continue editing the modified files** (you have uncommitted changes)');
  }

  // Option 2: Test the changes
  const hasDevServer = claude.commandHistoryBeforeStart?.some(cmd =>
    cmd.includes('npm run dev') || cmd.includes('dev:electron')
  );
  if (hasDevServer) {
    options.push('2. **Recompile, restart Electron, and test the changes end-to-end**');
  } else if (modifiedFiles.length > 0) {
    options.push('2. **Review changes with git diff and run tests**');
  }

  // Option 3: Commit the work
  if (modifiedFiles.length > 0) {
    options.push('3. **Review and commit the completed work** (create git commit)');
  }

  // Option 4: Work on something else
  options.push(`${options.length + 1}. **Work on something else** (ask user what they\'d like to do)`);

  if (options.length === 0) {
    options.push('1. Ask the user what they\'d like to work on');
  }

  options.forEach(opt => lines.push(opt));
  lines.push('');
  lines.push('_Wait for the user to choose before proceeding._');
  lines.push('');

  // ============================================================================
  // SUPPLEMENTARY CONTEXT (Lines 50+) - May not be read if Claude stops at ~100 lines
  // ============================================================================

  lines.push('---');
  lines.push('');
  lines.push('# 📚 Detailed Context (Supplementary)');
  lines.push('');

  // LAST CONVERSATION SUMMARY
  lines.push('## 📝 Last Session Summary');
  lines.push('');
  lines.push(inferSessionSummary(claude));
  lines.push('');

  // ACTIVE TASKS
  lines.push('## ✅ Active Tasks');
  lines.push('');
  lines.push(inferActiveTasks(claude));
  lines.push('');

  // SUGGESTED NEXT STEPS
  lines.push('## 🚀 Suggested Next Steps');
  lines.push('');
  lines.push(inferNextSteps(claude));
  lines.push('');

  // USER PREFERENCE
  lines.push('## ⚙️ Resumption Mode');
  lines.push('');
  lines.push('**Mode:** Interactive (ask before resuming work)');
  lines.push('');
  lines.push('_Note: The user should confirm before you execute any commands or make changes._');
  lines.push('');

  // GIT DIFF SUMMARY - Show what was actually changed
  if (claude.gitStatus?.modifiedFiles && claude.gitStatus.modifiedFiles.length > 0) {
    lines.push('## 📊 Git Diff Summary');
    lines.push('');
    lines.push('Here\'s what changed in your uncommitted files:');
    lines.push('');

    // Try to get git diff stat
    try {
      const diffStat = execSync('git diff --stat', {
        cwd: actualWorkingDir,
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 50 * 1024 // 50KB
      }).trim();

      if (diffStat) {
        lines.push('```');
        lines.push(diffStat);
        lines.push('```');
        lines.push('');
      }

      // Get abbreviated diff for each modified file (first 50 lines)
      lines.push('### Key Changes:');
      lines.push('');

      const maxFilesToShow = 3;
      claude.gitStatus.modifiedFiles.slice(0, maxFilesToShow).forEach(file => {
        try {
          const diff = execSync(`git diff -- "${file}"`, {
            cwd: actualWorkingDir,
            encoding: 'utf-8',
            timeout: 3000,
            maxBuffer: 20 * 1024 // 20KB per file
          }).trim();

          if (diff) {
            // Take first 40 lines of diff
            const diffLines = diff.split('\n').slice(0, 40);
            lines.push(`<details>`);
            lines.push(`<summary><b>${file}</b></summary>`);
            lines.push('');
            lines.push('```diff');
            diffLines.forEach(line => lines.push(line));
            if (diff.split('\n').length > 40) {
              lines.push('... (truncated)');
            }
            lines.push('```');
            lines.push('</details>');
            lines.push('');
          }
        } catch (e) {
          // Skip files that error
        }
      });

      if (claude.gitStatus.modifiedFiles.length > maxFilesToShow) {
        lines.push(`_... and ${claude.gitStatus.modifiedFiles.length - maxFilesToShow} more modified files_`);
        lines.push('');
      }
    } catch (e) {
      lines.push('_(Git diff not available)_');
      lines.push('');
    }
  }

  // RECENT COMMITS - Show context from git history
  try {
    const recentCommits = execSync('git log -5 --oneline --no-decorate', {
      cwd: actualWorkingDir,
      encoding: 'utf-8',
      timeout: 3000
    }).trim();

    if (recentCommits) {
      lines.push('## 📜 Recent Commits');
      lines.push('');
      lines.push('Last 5 commits in this branch:');
      lines.push('');
      lines.push('```');
      lines.push(recentCommits);
      lines.push('```');
      lines.push('');
    }
  } catch (e) {
    // Git not available or no commits
  }

  // DOCUMENTATION CONTENT - Include content of .md files if they were modified
  if (docFiles.length > 0) {
    lines.push('## 📚 Modified Documentation');
    lines.push('');
    lines.push('The following documentation files were modified (this may provide context about what you were working on):');
    lines.push('');

    docFiles.slice(0, 2).forEach(file => {
      try {
        const fullPath = path.join(actualWorkingDir, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const contentLines = content.split('\n').slice(0, 100); // First 100 lines

        lines.push(`### ${file}`);
        lines.push('');
        lines.push('```markdown');
        contentLines.forEach(line => lines.push(line));
        if (content.split('\n').length > 100) {
          lines.push('... (truncated)');
        }
        lines.push('```');
        lines.push('');
      } catch (e) {
        lines.push(`### ${file}`);
        lines.push('');
        lines.push('_(Could not read file content)_');
        lines.push('');
      }
    });
  }

  // Working directory
  lines.push('## Working Directory');
  lines.push('```');
  lines.push(actualWorkingDir);
  lines.push('```');
  if (actualWorkingDir !== claude.workingDirectory) {
    lines.push('');
    lines.push(`_Note: Detected from \`cd\` command. PowerShell reported: \`${claude.workingDirectory}\`_`);
  }
  lines.push('');

  // Git status
  if (claude.gitStatus) {
    lines.push('## Git Status');
    lines.push('');
    if (claude.gitStatus.branch) {
      lines.push(`**Current Branch:** \`${claude.gitStatus.branch}\``);
      lines.push('');
    }
    if (claude.gitStatus.modifiedFiles && claude.gitStatus.modifiedFiles.length > 0) {
      lines.push('**Modified Files:**');
      claude.gitStatus.modifiedFiles.forEach(file => {
        lines.push(`- ${file}`);
      });
      lines.push('');
    }
    if (claude.gitStatus.untrackedFiles && claude.gitStatus.untrackedFiles.length > 0) {
      lines.push('**Untracked Files:**');
      claude.gitStatus.untrackedFiles.forEach(file => {
        lines.push(`- ${file}`);
      });
      lines.push('');
    }
  }

  // Recently modified files
  if (claude.recentlyModifiedFiles && claude.recentlyModifiedFiles.length > 0) {
    lines.push('## Recently Modified Files');
    lines.push('');
    lines.push('These files were modified in the last 60 minutes before the session was captured:');
    lines.push('');
    claude.recentlyModifiedFiles.slice(0, 20).forEach(file => {
      lines.push(`- ${file}`);
    });
    if (claude.recentlyModifiedFiles.length > 20) {
      lines.push(`- ... and ${claude.recentlyModifiedFiles.length - 20} more`);
    }
    lines.push('');
  }

  // Command history
  if (claude.commandHistoryBeforeStart && claude.commandHistoryBeforeStart.length > 0) {
    lines.push('## Commands Before Claude Started');
    lines.push('');
    lines.push('These commands were executed before Claude Code was launched:');
    lines.push('');
    lines.push('```bash');
    claude.commandHistoryBeforeStart.forEach(cmd => {
      lines.push(cmd);
    });
    lines.push('```');
    lines.push('');
  }

  // Project files
  if (claude.projectFiles && claude.projectFiles.length > 0) {
    lines.push('## Project Structure');
    lines.push('');
    lines.push(`Project contains ${claude.projectFiles.length} source files (showing first 30):`);
    lines.push('');
    lines.push('```');
    claude.projectFiles.slice(0, 30).forEach(file => {
      lines.push(file);
    });
    if (claude.projectFiles.length > 30) {
      lines.push(`... and ${claude.projectFiles.length - 30} more files`);
    }
    lines.push('```');
    lines.push('');
  }

  // Context hint (if provided by user)
  if (claude.contextHint && claude.contextHint.trim()) {
    lines.push('## Task Context');
    lines.push('');
    lines.push(claude.contextHint);
    lines.push('');
  }

  // Session metadata
  lines.push('## Session Metadata');
  lines.push('');
  lines.push(`- **Captured At:** ${claude.sessionStartTime.toLocaleString()}`);
  lines.push(`- **Startup Command:** \`${claude.startupCommand || 'claude code'}\``);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('**Note:** You can ask Claude Code to read this file and continue where you left off!');

  return lines.join('\n');
}

/**
 * Create a startup script to restore terminal state
 */
function createStartupScript(session: TerminalSession): string | null {
  const commands: string[] = [];

  // DEBUG: Log what we received
  logger.log('[DEBUG createStartupScript] Creating startup script for session:');
  logger.log('[DEBUG createStartupScript]   processId:', session.processId);
  logger.log('[DEBUG createStartupScript]   shellType:', session.shellType);
  logger.log('[DEBUG createStartupScript]   currentDirectory:', session.currentDirectory);
  logger.log('[DEBUG createStartupScript]   has claudeCodeContext:', !!session.claudeCodeContext);
  if (session.claudeCodeContext) {
    logger.log('[DEBUG createStartupScript]   claudeCodeContext.isClaudeCodeRunning:', session.claudeCodeContext.isClaudeCodeRunning);
    logger.log('[DEBUG createStartupScript]   claudeCodeContext.workingDirectory:', session.claudeCodeContext.workingDirectory);
    logger.log('[DEBUG createStartupScript]   claudeCodeContext.projectFiles count:', session.claudeCodeContext.projectFiles?.length || 0);
  }

  // Change to working directory if available
  if (session.currentDirectory) {
    if (session.shellType === 'PowerShell') {
      // Use single quotes and escape single quotes to prevent injection
      const safePath = session.currentDirectory.replace(/'/g, "''");
      commands.push(`Set-Location -LiteralPath '${safePath}'`);
    } else if (session.shellType === 'CMD') {
      // CMD requires double quotes but we need to escape them
      const safePath = session.currentDirectory.replace(/"/g, '""');
      commands.push(`cd /d "${safePath}"`);
    } else {
      // Bash/other shells - escape single quotes
      const safePath = session.currentDirectory.replace(/'/g, "'\\''");
      commands.push(`cd '${safePath}'`);
    }
  }

  if (session.claudeCodeContext?.isClaudeCodeRunning) {
    const claude = session.claudeCodeContext;

    // Create a context restoration file for Claude
    const contextFilePath = path.join(os.tmpdir(), `flowstate_claude_context_${Date.now()}.md`);
    const contextContent = generateClaudeContextFile(claude);

    try {
      fs.writeFileSync(contextFilePath, contextContent, 'utf-8');

      // Add header comment about restoration
      commands.push('# ==============================================');
      commands.push('# FlowState: Restoring Claude Code Session');
      commands.push('# ==============================================');
      commands.push('');

      if (claude.commandHistoryBeforeStart?.length) {
        commands.push('# Replaying commands executed before Claude Code launch');
        claude.commandHistoryBeforeStart.forEach(cmd => {
          if (cmd && cmd.trim()) {
            // Detect blocking commands that should run in background
            const cmdLower = cmd.trim().toLowerCase();
            const isBlockingCommand =
              cmdLower.startsWith('npm run dev') ||
              cmdLower.startsWith('npm start') ||
              cmdLower.startsWith('electron') ||
              cmdLower.startsWith('node ') ||
              cmdLower.includes('npm run') && (cmdLower.includes('serve') || cmdLower.includes('watch'));

            if (isBlockingCommand && session.shellType === 'PowerShell') {
              // Wrap in Start-Process to run in background (PowerShell only)
              const escapedCmd = cmd.replace(/"/g, '`"');
              commands.push(`Start-Process powershell -ArgumentList "-NoExit", "-Command", "${escapedCmd}" -WindowStyle Normal`);
              commands.push(`Write-Host "Started background process: ${escapedCmd}" -ForegroundColor Gray`);
            } else {
              // Run normally for non-blocking commands
              commands.push(cmd);
            }
          }
        });
        commands.push('');
      }

      // Print context information before restarting Claude
      // Generate a DETAILED summary for terminal output
      const modifiedFiles = claude.gitStatus?.modifiedFiles || [];
      const recentFiles = claude.recentlyModifiedFiles || [];
      const workingDir = claude.workingDirectory || session.currentDirectory || process.cwd();

      // Extract detailed work context
      let workDescription = '';
      let fileContext = '';
      let lineContext = '';
      let workType = '';
      let recommendations: string[] = [];

      if (modifiedFiles.length > 0) {
        try {
          // Get git diff for the primary file to extract exact location
          const primaryFile = modifiedFiles[0];
          const diffOutput = execSync(`git diff --unified=3 -- "${primaryFile}"`, {
            cwd: workingDir,
            encoding: 'utf-8',
            timeout: 3000
          }).trim();

          if (diffOutput) {
            // Parse diff to find changed line numbers
            const hunkMatch = diffOutput.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
            if (hunkMatch) {
              const lineNum = parseInt(hunkMatch[2]);
              lineContext = `line ${lineNum}`;

              // Analyze what type of work was being done
              const addedLines = diffOutput.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
              const removedLines = diffOutput.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length;

              if (addedLines > removedLines * 2) {
                workType = 'adding new functionality';
              } else if (removedLines > addedLines * 2) {
                workType = 'removing/refactoring code';
              } else {
                workType = 'modifying existing code';
              }

              // Check for specific patterns
              const lastAddedLines = diffOutput.split('\n').filter(l => l.startsWith('+')).slice(-3).join(' ');
              if (lastAddedLines.includes('TODO')) {
                recommendations.push('Complete the TODO item');
              }
              if (lastAddedLines.includes('async') || lastAddedLines.includes('await')) {
                recommendations.push('Check async error handling');
              }
              if (lastAddedLines.includes('console.log') || lastAddedLines.includes('console.error')) {
                recommendations.push('Remove debug logs before commit');
              }
            }
          }

          // Build file context
          if (modifiedFiles.length === 1) {
            fileContext = `${primaryFile}`;
          } else if (modifiedFiles.length <= 3) {
            fileContext = `${primaryFile} and ${modifiedFiles.length - 1} other file(s)`;
          } else {
            fileContext = `${primaryFile} and ${modifiedFiles.length - 1} other files`;
          }

          // Build work description
          if (workType && lineContext) {
            workDescription = `You were ${workType} in ${fileContext} (${lineContext})`;
          } else {
            workDescription = `You were editing ${fileContext}`;
          }

        } catch (e) {
          // Fallback if git diff fails
          workDescription = `You were editing ${modifiedFiles.length} file(s)`;
          fileContext = modifiedFiles.slice(0, 2).join(', ');
        }

        // Add generic recommendations
        if (recommendations.length === 0) {
          recommendations.push('Review uncommitted changes');
          recommendations.push('Run tests if applicable');
        }
      } else if (recentFiles.length > 0) {
        workDescription = `You were working in ${path.basename(workingDir)}`;
        recommendations.push('Continue your previous work');
      } else {
        workDescription = 'Session recovery';
        recommendations.push('Review context to decide next steps');
      }

      commands.push('# Session context has been saved!');
      if (session.shellType === 'PowerShell') {
        commands.push('Write-Host "" ');
        commands.push('Write-Host "============================================================" -ForegroundColor Cyan');
        commands.push('Write-Host "FLOWSTATE SESSION RECOVERY" -ForegroundColor Yellow');
        commands.push('Write-Host "============================================================" -ForegroundColor Cyan');
        commands.push('Write-Host "" ');
        commands.push(`Write-Host "Project: ${path.basename(workingDir)}" -ForegroundColor White`);
        commands.push(`Write-Host "Work Location: ${workDescription}" -ForegroundColor Gray`);
        if (fileContext) {
          commands.push(`Write-Host "Files Modified: ${fileContext}" -ForegroundColor Gray`);
        }
        commands.push('Write-Host "" ');
        if (recommendations.length > 0) {
          commands.push('Write-Host "Suggested Next Steps:" -ForegroundColor Yellow');
          recommendations.slice(0, 3).forEach((rec, idx) => {
            commands.push(`Write-Host "  ${idx + 1}. ${rec}" -ForegroundColor Gray`);
          });
          commands.push('Write-Host "" ');
        }
        commands.push('Write-Host "COPY THIS PROMPT FOR CLAUDE:" -ForegroundColor Yellow');
        commands.push('Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray');
        commands.push(`Write-Host 'Read ${contextFilePath} and continue where we left off. ${workDescription}. Review the full context and ask me which option I would like to pursue.' -ForegroundColor Green`);
        commands.push('Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray');
        commands.push('Write-Host "" ');
        commands.push(`Write-Host 'Full context saved to: ${contextFilePath}' -ForegroundColor DarkGray`);
        commands.push('Write-Host "" ');
      } else {
        commands.push(`echo ""`);
        commands.push(`echo "============================================================"`);
        commands.push(`echo "FLOWSTATE SESSION RECOVERY"`);
        commands.push(`echo "============================================================"`);
        commands.push(`echo ""`);
        commands.push(`echo "Project: ${path.basename(workingDir)}"`);
        commands.push(`echo "Work Location: ${workDescription}"`);
        if (fileContext) {
          commands.push(`echo "Files Modified: ${fileContext}"`);
        }
        commands.push(`echo ""`);
        if (recommendations.length > 0) {
          commands.push(`echo "Suggested Next Steps:"`);
          recommendations.slice(0, 3).forEach((rec, idx) => {
            commands.push(`echo "  ${idx + 1}. ${rec}"`);
          });
          commands.push(`echo ""`);
        }
        commands.push(`echo "COPY THIS PROMPT FOR CLAUDE:"`);
        commands.push(`echo "------------------------------------------------------------"`);
        commands.push(`echo "Read ${contextFilePath} and continue where we left off. ${workDescription}. Review the full context and ask me which option I would like to pursue."`);
        commands.push(`echo "------------------------------------------------------------"`);
        commands.push(`echo ""`);
        commands.push(`echo "Full context saved to: ${contextFilePath}"`);
        commands.push(`echo ""`);
      }
      commands.push('');

      // Pause to let user read context and copy the prompt before launching Claude
      if (session.shellType === 'PowerShell') {
        commands.push('Write-Host "" ');
        commands.push('Write-Host "============================================================" -ForegroundColor Yellow');
        commands.push('Write-Host "IMPORTANT: Review the context above and decide what to do." -ForegroundColor Yellow');
        commands.push('Write-Host "Copy the green prompt above BEFORE pressing Enter." -ForegroundColor Yellow');
        commands.push('Write-Host "You will paste it into Claude Code once it starts." -ForegroundColor Yellow');
        commands.push('Write-Host "============================================================" -ForegroundColor Yellow');
        commands.push('Write-Host "" ');
        commands.push('Read-Host "Press Enter when you have copied the prompt and are ready to launch Claude Code"');
        commands.push('Write-Host "" ');
      } else {
        commands.push('echo ""');
        commands.push('echo "============================================================"');
        commands.push('echo "IMPORTANT: Review the context above and decide what to do."');
        commands.push('echo "Copy the prompt above BEFORE pressing Enter."');
        commands.push('echo "You will paste it into Claude Code once it starts."');
        commands.push('echo "============================================================"');
        commands.push('echo ""');
        commands.push('read -p "Press Enter when you have copied the prompt and are ready to launch Claude Code: "');
        commands.push('echo ""');
      }

      commands.push('# Launching Claude Code session...');
      const startup = claude.startupCommand?.trim() || 'claude code';

      if (session.shellType === 'PowerShell') {
        // Use PowerShell background job to auto-press Enter after Claude prompts
        commands.push('$job = Start-Job -ScriptBlock {');
        commands.push('  Start-Sleep -Milliseconds 1500');
        commands.push('  Add-Type -AssemblyName System.Windows.Forms');
        commands.push("  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')");
        commands.push('}');
        commands.push(startup);
      } else {
        commands.push(startup);
      }
      commands.push('');
    } catch (err) {
      // Fallback if context file creation fails
      console.warn('Failed to create Claude context file:', err);
      commands.push('# Restarting Claude Code session with auto-confirmation...');
      const startup = claude.startupCommand?.trim() || 'claude code';

      if (session.shellType === 'PowerShell') {
        // Use PowerShell background job to auto-press Enter after Claude prompts
        commands.push('$job = Start-Job -ScriptBlock {');
        commands.push('  Start-Sleep -Milliseconds 1500');
        commands.push('  Add-Type -AssemblyName System.Windows.Forms');
        commands.push("  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')");
        commands.push('}');
        commands.push(startup);
      } else {
        commands.push(startup);
      }
      commands.push('');
    }
  }
  
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
  // Otherwise, check if we have running commands to restore in background
  else if (session.runningCommands && session.runningCommands.length > 0) {

    // Handle other command types
    for (const cmd of session.runningCommands) {
      const commandLine = cmd.commandLine;

      if (!commandLine) {
        continue;
      }

      if (commandLine.toLowerCase().includes('claude')) {
        if (session.claudeCodeContext?.isClaudeCodeRunning) {
          continue;
        }
      }

      if (commandLine.includes('npm') && commandLine.includes('dev')) {
        // npm dev server - run in background so it doesn't block Claude Code
        commands.push('# Restarting development server in background...');
        if (session.shellType === 'PowerShell') {
          // Check for common dev server ports and kill if in use
          commands.push('# Checking for port conflicts...');
          commands.push('$commonPorts = @(5173, 3000, 8080, 4200, 5000)');
          commands.push('foreach ($port in $commonPorts) {');
          commands.push('  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue');
          commands.push('  if ($conn) {');
          commands.push('    $proc = Get-Process -Id $conn[0].OwningProcess -ErrorAction SilentlyContinue');
          commands.push('    if ($proc) {');
          commands.push('      Write-Host "Killing process on port ${port}: $($proc.Name)" -ForegroundColor Yellow');
          commands.push('      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue');
          commands.push('    }');
          commands.push('  }');
          commands.push('}');
          commands.push('Start-Sleep -Milliseconds 500');
          commands.push('Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -WindowStyle Normal');
        } else {
          commands.push('start cmd /k "npm run dev"');
        }
      } else if (commandLine.includes('npm') && commandLine.includes('start')) {
        commands.push('# Restarting application in background...');
        if (session.shellType === 'PowerShell') {
          // Similar port conflict handling
          commands.push('$commonPorts = @(3000, 5173, 8080)');
          commands.push('foreach ($port in $commonPorts) {');
          commands.push('  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue');
          commands.push('  if ($conn) {');
          commands.push('    Stop-Process -Id $conn[0].OwningProcess -Force -ErrorAction SilentlyContinue');
          commands.push('  }');
          commands.push('}');
          commands.push('Start-Sleep -Milliseconds 500');
          commands.push('Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm start" -WindowStyle Normal');
        } else {
          commands.push('start cmd /k "npm start"');
        }
      } else if (commandLine.includes('electron')) {
        // Electron app - run in background
        commands.push('# Restarting Electron app in background...');
        if (session.shellType === 'PowerShell') {
          commands.push('Start-Process powershell -ArgumentList "-NoExit", "-Command", "' + commandLine.replace(/"/g, '`"') + '" -WindowStyle Normal');
        } else {
          commands.push('start cmd /k "' + commandLine.replace(/"/g, '\\"') + '"');
        }
      } else if (commandLine.includes('python') || commandLine.includes('py.exe')) {
        // Python script
        commands.push(`# Restarting Python script...`);
        // Try to extract the script name
        const scriptMatch = commandLine.match(/(?:python|py\.exe)\s+(.+)/);
        if (scriptMatch) {
          commands.push(`python ${scriptMatch[1]}`);
        }
      } else if (commandLine.includes('node ')) {
        commands.push('# Restarting Node.js script...');
        const scriptMatch = commandLine.match(/node\s+(.+)/);
        if (scriptMatch) {
          commands.push(`node ${scriptMatch[1]}`);
        }
      } else if (commandLine.includes('yarn') && commandLine.includes('dev')) {
        commands.push('# Restarting development server...');
        commands.push('yarn dev');
      } else if (commandLine.includes('pnpm') && commandLine.includes('dev')) {
        commands.push('# Restarting development server...');
        commands.push('pnpm dev');
      } else if (commandLine.includes('docker-compose') || commandLine.includes('docker compose')) {
        commands.push('# Restarting Docker containers...');
        commands.push('docker-compose up');
      } else {
        commands.push(`# Restarting ${cmd.processName || 'process'}...`);
        // Use Invoke-Expression for PowerShell to properly handle command-line arguments with -- flags
        if (session.shellType === 'PowerShell') {
          // Escape quotes for PowerShell: single quotes for the outer string, backtick-doublequote for inner quotes
          const escapedCmd = commandLine.replace(/'/g, "''").replace(/"/g, '`' + '"');
          commands.push(`Invoke-Expression '${escapedCmd}'`);
        } else {
          commands.push(commandLine);
        }
      }
    }
  } else if (session.lastExecutedCommand) {
    const lastCmd = session.lastExecutedCommand;
    const isClaudeCommand = lastCmd.toLowerCase().includes('claude');

    if (isClaudeCommand && session.claudeCodeContext?.isClaudeCodeRunning) {
      // Already handled via dedicated Claude restart block
    } else {
      commands.push('# Last executed command:');
      commands.push(`# ${lastCmd}`);
      commands.push('');
    }
  }

  if (commands.length === 0) {
    return null;
  }

  return commands.join('\n');
}

/**
 * Restore terminal session with full state including running processes
 */
export async function restoreTerminalSession(session: TerminalSession): Promise<void> {
  try {
    // Create startup script if we have commands to restore
    const startupScript = createStartupScript(session);

    if (process.platform === 'win32') {
      await restoreWindowsTerminal(session, startupScript);
    } else if (process.platform === 'darwin') {
      await restoreMacOSTerminal(session, startupScript);
    } else {
      await restoreLinuxTerminal(session, startupScript);
    }
  } catch (error) {
    console.error('Failed to restore terminal session:', error);
    throw error;
  }
}

/**
 * Restore terminal session on Windows
 */
async function restoreWindowsTerminal(session: TerminalSession, startupScript: string | null): Promise<void> {
  const cwd = session.currentDirectory || os.homedir();

  // Logger already forwards to renderer via setRendererLogger
  const log = (...args: any[]) => logger.log(...args);
  const logDebug = (...args: any[]) => logger.debug(...args);

  // Resolve Windows Terminal executable path strictly (no terminal-type fallback)
  const resolveWtExecutable = async (): Promise<string> => {
    // Check common Windows Terminal locations first (most reliable)
    const windowsAppsPath = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps');
    const candidates = [
      path.join(windowsAppsPath, 'wt.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsApps', 'wt.exe'),
      path.join('C:', 'Users', process.env.USERNAME || process.env.USER || '', 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe'),
    ].filter(Boolean) as string[];
    
    logDebug(`[Terminal Restore] Checking for wt.exe in standard locations...`);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          logDebug(`[Terminal Restore] Found wt.exe at: ${candidate}`);
          return candidate;
        } else {
          logDebug(`[Terminal Restore] Not found: ${candidate}`);
        }
      } catch (e) {
        logDebug(`[Terminal Restore] Error checking ${candidate}:`, e);
      }
    }
    
    // Try to find it using 'where' command (Windows)
    try {
      logDebug(`[Terminal Restore] Trying 'where wt.exe' command...`);
      const { stdout } = await execPromise('where wt.exe', { timeout: 2000 });
      const wtPath = stdout.trim().split('\n')[0].trim();
      if (wtPath && fs.existsSync(wtPath)) {
        logDebug(`[Terminal Restore] Found wt.exe via 'where' command: ${wtPath}`);
        return wtPath;
      }
    } catch (e) {
      logDebug(`[Terminal Restore] 'where' command failed:`, e);
    }
    
    // Last resort: try to use 'wt.exe' directly (if it's in PATH)
    // Augment PATH with WindowsApps first
    const env = { ...process.env } as NodeJS.ProcessEnv;
    if (fs.existsSync(windowsAppsPath) && !String(env.PATH || '').toLowerCase().includes('microsoft\\windowsapps')) {
      env.PATH = `${env.PATH || ''};${windowsAppsPath}`;
      logDebug(`[Terminal Restore] Augmented PATH with WindowsApps: ${windowsAppsPath}`);
    }
    
    try {
      logDebug(`[Terminal Restore] Testing if wt.exe is accessible via PATH...`);
      const { stdout } = await execPromise('wt.exe --version', { timeout: 2000, env });
      if (stdout) {
        logDebug(`[Terminal Restore] wt.exe is accessible via PATH`);
        return 'wt.exe';
      }
    } catch (e) {
      logDebug(`[Terminal Restore] wt.exe not accessible via PATH:`, e);
    }
    
    // If we can't find it, still return 'wt.exe' and let the spawn/exec handle it
    // Windows Terminal should be in PATH if it's installed
    logDebug(`[Terminal Restore] Could not verify wt.exe, but will try 'wt.exe' anyway`);
    return 'wt.exe';
  };
  
  logger.log('=== Restoring Terminal ===');
  logger.log('Shell type:', session.shellType);
  logger.log('Target directory:', cwd);
  logger.log('Has startup script:', !!startupScript);
  logger.log('PowerShell version:', session.powerShellVersion || 'Unknown');
  logger.log('isWindowsTerminal value:', session.isWindowsTerminal);
  logger.log('isWindowsTerminal type:', typeof session.isWindowsTerminal);
  logger.log('isWindowsTerminal === true:', session.isWindowsTerminal === true);
  logger.log('isWindowsTerminal === undefined:', session.isWindowsTerminal === undefined);
  logger.log('powerShellVersion value:', session.powerShellVersion);
  logger.log('powerShellVersion === "Core":', session.powerShellVersion === 'Core');

  // If we have a startup script, create a temporary file and execute it
  if (startupScript) {
    const tempDir = os.tmpdir();
    let scriptPath: string;

    switch (session.shellType) {
      case 'PowerShell':
        // Create PowerShell startup script with directory change
        const psBootstrap = `
# Ensure Node & npm global bin are on PATH for this session
$pathsToAdd = @()
$candidatePaths = @(
  'C:\\Program Files\\nodejs',
  'C:\\Program Files (x86)\\nodejs',
  (Join-Path $env:APPDATA 'npm')
)
foreach ($p in $candidatePaths) {
  if ($p -and (Test-Path $p)) {
    $existing = ($env:Path -split ';') | ForEach-Object { $_.Trim().ToLower() }
    if (-not ($existing -contains $p.ToLower())) { $pathsToAdd += $p }
  }
}
if ($pathsToAdd.Count -gt 0) { $env:Path = $env:Path + ';' + ($pathsToAdd -join ';') }

# Provide a 'claude' helper if not already available
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  function global:claude {
    param([Parameter(ValueFromRemainingArguments=$true)] [string[]]$claudeArgs)
    if (Get-Command npx -ErrorAction SilentlyContinue) {
      npx --yes -p claude claude @claudeArgs
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
      npm exec --yes -p claude -- claude @claudeArgs
    } else {
      Write-Host 'npm/npx not found in PATH; install Node/npm or add to PATH' -ForegroundColor Red
    }
  }
}

# Helper to log command paths without null-conditional (works on Windows PowerShell 5)
function Get-CommandPath {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  return ''
}

# Debug info (first launch only)
Write-Host ('Node: ' + (Get-CommandPath 'node'))
Write-Host ('npm: ' + (Get-CommandPath 'npm'))
Write-Host ('npx: ' + (Get-CommandPath 'npx'))
Write-Host ('claude available: ' + [bool](Get-Command claude -ErrorAction SilentlyContinue))

Set-Location -Path '${cwd.replace(/'/g, "''")}'
`.trim();
        const psScript = `${psBootstrap}
${startupScript || ''}`;
        scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.ps1`);
        fs.writeFileSync(scriptPath, psScript, 'utf-8');

        // Normalize the path to use full long path format (not short path like TRASHA~1)
        // This ensures the path is accessible even if the temp directory uses short paths
        try {
          scriptPath = fs.realpathSync(scriptPath);
        } catch (error) {
          // If realpathSync fails, at least verify the file exists
          if (!fs.existsSync(scriptPath)) {
            throw new Error(`Failed to create script file at ${scriptPath}: File does not exist after write`);
          }
        }

        // Verify the file exists before proceeding
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Script file does not exist at ${scriptPath}`);
        }

        logger.log('Script file created at:', scriptPath);
        logger.log('Launching PowerShell...');

        // Restore exactly as captured - no fallbacks
        // MUST have both isWindowsTerminal and powerShellVersion from capture
        logDebug('[DEBUG] Checking restore requirements...');
        logDebug('[DEBUG] session.isWindowsTerminal:', session.isWindowsTerminal, '(type:', typeof session.isWindowsTerminal, ')');
        logDebug('[DEBUG] session.powerShellVersion:', session.powerShellVersion);
        
        if (session.isWindowsTerminal === undefined) {
          logDebug('[DEBUG] ERROR: isWindowsTerminal is undefined');
          throw new Error('Cannot restore terminal: Missing isWindowsTerminal metadata. Terminal must be captured with complete metadata.');
        }
        if (!session.powerShellVersion) {
          logDebug('[DEBUG] ERROR: powerShellVersion is missing');
          throw new Error('Cannot restore terminal: Missing powerShellVersion metadata. Terminal must be captured with complete metadata.');
        }
        
        const useWindowsTerminal = session.isWindowsTerminal === true; // Strict check
        const usePowerShellCore = session.powerShellVersion === 'Core';
        const powershellExe = usePowerShellCore ? 'pwsh.exe' : 'powershell.exe';
        
        logDebug('[DEBUG] Restore decision:');
        logDebug('[DEBUG]   useWindowsTerminal:', useWindowsTerminal, '(type:', typeof useWindowsTerminal, ')');
        logDebug('[DEBUG]   usePowerShellCore:', usePowerShellCore, '(type:', typeof usePowerShellCore, ')');
        logDebug('[DEBUG]   powershellExe:', powershellExe);
        logDebug('[DEBUG]   useWindowsTerminal === true:', useWindowsTerminal === true);
        logDebug('[DEBUG]   useWindowsTerminal === false:', useWindowsTerminal === false);
        logDebug('[DEBUG] About to check if (useWindowsTerminal)...');
        logDebug('[DEBUG]   useWindowsTerminal value:', useWindowsTerminal);
        logDebug('[DEBUG]   Boolean(useWindowsTerminal):', Boolean(useWindowsTerminal));
        logDebug('[DEBUG]   !!useWindowsTerminal:', !!useWindowsTerminal);

        if (useWindowsTerminal) {
          logDebug('[DEBUG] ✓ ENTERED if (useWindowsTerminal) block!');
          // Original was in Windows Terminal - restore to Windows Terminal
          logDebug('[TERMINAL RESTORE] ============================================');
          logDebug('[TERMINAL RESTORE] ENTERING Windows Terminal restore path');
          logDebug('[TERMINAL RESTORE] ============================================');
          
          // Windows Terminal profile names:
          // - "PowerShell" = PowerShell Core (pwsh.exe)
          // - "Windows PowerShell" = PowerShell Classic (powershell.exe)
          const profileName = usePowerShellCore ? 'PowerShell' : 'Windows PowerShell';
          logDebug(`[TERMINAL RESTORE] Step 1: Profile selection`);
          logDebug(`[TERMINAL RESTORE]   usePowerShellCore: ${usePowerShellCore}`);
          logDebug(`[TERMINAL RESTORE]   Selected profile: "${profileName}"`);
          logDebug(`[TERMINAL RESTORE]   PowerShell version: ${usePowerShellCore ? 'Core (pwsh.exe)' : 'Classic (powershell.exe)'}`);
          
          try {
            // Step 2: Get the full path to wt.exe
            logDebug(`[TERMINAL RESTORE] Step 2: Resolving Windows Terminal executable`);
            const windowsApps = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps');
            const wtFullPath = path.join(windowsApps, 'wt.exe');
            
            logDebug(`[TERMINAL RESTORE]   Checking for wt.exe at: ${wtFullPath}`);
            logDebug(`[TERMINAL RESTORE]   LOCALAPPDATA env var: ${process.env.LOCALAPPDATA || 'NOT SET'}`);
            logDebug(`[TERMINAL RESTORE]   WindowsApps directory exists: ${fs.existsSync(windowsApps)}`);
            logDebug(`[TERMINAL RESTORE]   wt.exe file exists: ${fs.existsSync(wtFullPath)}`);
            
            let wt: string;
            // Always use the full path if WindowsApps exists (most reliable)
            if (fs.existsSync(windowsApps)) {
              // Even if we can't verify the exact file, try the full path
              wt = wtFullPath;
              logDebug(`[TERMINAL RESTORE]   ✓ Using full path to wt.exe: ${wt}`);
            } else {
              // Try to resolve it
              logDebug(`[TERMINAL RESTORE]   ⚠ WindowsApps not found, trying resolveWtExecutable...`);
              wt = await resolveWtExecutable();
              logDebug(`[TERMINAL RESTORE]   ✓ Resolved wt.exe path: ${wt}`);
            }

            // Step 3: Build Windows Terminal arguments
            logDebug(`[TERMINAL RESTORE] Step 3: Building Windows Terminal command`);
            // Windows Terminal: When using --profile, the profile's command line takes precedence
            // We need to spawn a NEW Windows Terminal window (not a tab in existing window)
            // Using -w new forces a new window, preventing IPC connections to parent process
            // Format: wt.exe -w new -d "path" powershell.exe -NoExit -ExecutionPolicy Bypass -File "script.ps1"
            // Note: spawn() handles quoting automatically, so we don't need to quote arguments manually
            const wtArgs = [
              '-w', 'new',  // Force new window (prevents IPC with existing Terminal)
              '--title', 'FlowState Restore',
              '-d', cwd,
              powershellExe,
              '-NoExit',
              '-NoProfile',
              '-ExecutionPolicy', 'Bypass',
              '-File', scriptPath
            ];
            
            logDebug(`[TERMINAL RESTORE]   Command structure:`);
            logDebug(`[TERMINAL RESTORE]     Executable: ${wt}`);
            logDebug(`[TERMINAL RESTORE]     Arguments (${wtArgs.length}):`);
            wtArgs.forEach((arg, idx) => {
              logDebug(`[TERMINAL RESTORE]       [${idx}]: "${arg}"`);
            });
            logDebug(`[TERMINAL RESTORE]     Full command: ${wt} ${wtArgs.map(a => `"${a}"`).join(' ')}`);

            // Step 4: Build environment with augmented PATH (always do this)
            logDebug(`[TERMINAL RESTORE] Step 4: Preparing environment`);
            const env = { ...process.env } as NodeJS.ProcessEnv;
            const originalPath = env.PATH || '';
            if (fs.existsSync(windowsApps) && !String(originalPath).toLowerCase().includes('microsoft\\windowsapps')) {
              env.PATH = `${originalPath};${windowsApps}`;
              logDebug(`[TERMINAL RESTORE]   ✓ PATH augmented with WindowsApps`);
              logDebug(`[TERMINAL RESTORE]   Original PATH length: ${originalPath.split(';').length} entries`);
              logDebug(`[TERMINAL RESTORE]   New PATH length: ${env.PATH.split(';').length} entries`);
            } else {
              logDebug(`[TERMINAL RESTORE]   PATH already contains WindowsApps or WindowsApps not found`);
            }
            // Also ensure Node & npm global bin are available so npx/claude resolve
            const nodeDirs: string[] = [];
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'];
            const nodeJsDir = path.join(programFiles, 'nodejs');
            const nodeJsDirX86 = programFilesX86 ? path.join(programFilesX86, 'nodejs') : '';
            const npmGlobalBin = path.join(process.env.APPDATA || '', 'npm');
            [nodeJsDir, nodeJsDirX86, npmGlobalBin].forEach((dir) => {
              if (dir && fs.existsSync(dir) && !String(env.PATH || '').toLowerCase().includes(dir.toLowerCase())) {
                nodeDirs.push(dir);
              }
            });
            if (nodeDirs.length > 0) {
              env.PATH = `${env.PATH || ''};${nodeDirs.join(';')}`;
              logDebug(`[TERMINAL RESTORE]   ✓ PATH augmented with Node/npm: ${nodeDirs.join(', ')}`);
            } else {
              logDebug(`[TERMINAL RESTORE]   PATH already contains Node/npm or directories not found`);
            }

            // Step 5: Launch Windows Terminal
            logDebug(`[TERMINAL RESTORE] Step 5: Launching Windows Terminal`);
            logDebug(`[TERMINAL RESTORE]   Executable: ${wt}`);
            logDebug(`[TERMINAL RESTORE]   Working directory: ${cwd}`);
            logDebug(`[TERMINAL RESTORE]   Script path: ${scriptPath}`);
            logDebug(`[TERMINAL RESTORE]   Profile name: "${profileName}"`);
            logDebug(`[TERMINAL RESTORE]   PowerShell executable: ${powershellExe}`);
            logDebug(`[TERMINAL RESTORE]   About to call spawn()...`);

            // Spawn and immediately detach - no event listeners to prevent blocking
            try {
              logDebug(`[TERMINAL RESTORE]   Calling spawn() with:`);
              logDebug(`[TERMINAL RESTORE]     command: ${wt}`);
              logDebug(`[TERMINAL RESTORE]     args: ${JSON.stringify(wtArgs)}`);
              logDebug(`[TERMINAL RESTORE]     options: { detached: true, stdio: 'ignore', shell: false, cwd: '${cwd}' }`);

              const wtProcess = spawn(wt, wtArgs, {
                detached: true,
                stdio: 'ignore', // Fully ignore stdio for true detachment
                shell: false,
                cwd,
                env,
              });

              logDebug(`[TERMINAL RESTORE]   ✓ spawn() called`);
              logDebug(`[TERMINAL RESTORE]   Process PID: ${wtProcess.pid || 'undefined'}`);

              // Immediately unref to fully detach - no waiting, no event listeners
              if (wtProcess.pid) {
                wtProcess.unref();
                logDebug(`[TERMINAL RESTORE]   ✓ Process detached with PID ${wtProcess.pid}`);
                logDebug(`[TERMINAL RESTORE] ============================================`);
                logDebug(`[TERMINAL RESTORE] ✓ Windows Terminal launched and detached!`);
                logDebug(`[TERMINAL RESTORE] ============================================`);
              } else {
                throw new Error('Failed to spawn Windows Terminal - no process ID returned');
              }
            } catch (spawnError: any) {
              logDebug(`[TERMINAL RESTORE]   ✗ ERROR: spawn() failed`);
              logDebug(`[TERMINAL RESTORE]   Error: ${spawnError?.message || spawnError}`);
              throw spawnError;
            }
          } catch (error: any) {
            logDebug(`[TERMINAL RESTORE] ============================================`);
            logDebug(`[TERMINAL RESTORE] ✗ ERROR: Failed to launch Windows Terminal`);
            logDebug(`[TERMINAL RESTORE] ============================================`);
            logDebug(`[TERMINAL RESTORE] Error type: ${error?.constructor?.name || typeof error}`);
            logDebug(`[TERMINAL RESTORE] Error message: ${error?.message || String(error)}`);
            logDebug(`[TERMINAL RESTORE] Error code: ${error?.code || 'N/A'}`);
            logDebug(`[TERMINAL RESTORE] Error stack:`);
            if (error?.stack) {
              error.stack.split('\n').forEach((line: string) => {
                logDebug(`[TERMINAL RESTORE]   ${line}`);
              });
            } else {
              logDebug(`[TERMINAL RESTORE]   (no stack trace)`);
            }
            throw new Error(`Failed to restore terminal: Original was in Windows Terminal, but Windows Terminal launch failed: ${error?.message || error}`);
          }
        } else {
          // Original was in classic console - restore to classic console (no fallbacks)
          logger.log('Restoring to classic PowerShell console (as captured)...');
          const escapedScriptPath = scriptPath.replace(/"/g, '""');
          const windowTitle = `FlowState Restore - ${usePowerShellCore ? 'PowerShell Core' : 'PowerShell'}`;
          
          try {
            // Augment PATH for classic console too, to ensure Node/npm are available
            const env = { ...process.env } as NodeJS.ProcessEnv;
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'];
            const nodeJsDir = path.join(programFiles, 'nodejs');
            const nodeJsDirX86 = programFilesX86 ? path.join(programFilesX86, 'nodejs') : '';
            const npmGlobalBin = path.join(process.env.APPDATA || '', 'npm');
            [nodeJsDir, nodeJsDirX86, npmGlobalBin].forEach((dir) => {
              if (dir && fs.existsSync(dir) && !String(env.PATH || '').toLowerCase().includes(dir.toLowerCase())) {
                env.PATH = `${env.PATH || ''};${dir}`;
              }
            });
            exec(`start "${windowTitle}" ${powershellExe} -NoExit -ExecutionPolicy Bypass -File "${escapedScriptPath}"`, { cwd: cwd, env }, (error) => {
              if (error) {
                console.error('[Terminal Restore] Failed to launch classic PowerShell:', error);
                throw new Error(`Failed to restore terminal: Original was in classic console, but PowerShell launch failed: ${error}`);
              }
            });
          } catch (error) {
            console.error('[Terminal Restore] Failed to launch classic PowerShell:', error);
            throw new Error(`Failed to restore terminal: Original was in classic console, but PowerShell launch failed: ${error}`);
          }
        }
        break;

      case 'CMD':
        // Create CMD startup script with directory change
        const cmdScript = `@echo off
cd /d "${cwd}"
${startupScript}`;
        scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.bat`);
        fs.writeFileSync(scriptPath, cmdScript, 'utf-8');

        logger.log('Script file created at:', scriptPath);
        logger.log('Launching CMD...');

        // Use spawn to launch CMD
        const cmdProcess = spawn('cmd.exe', ['/K', scriptPath], {
          detached: true,
          stdio: 'ignore',
          cwd: cwd
        });

        cmdProcess.unref();
        logger.log('CMD process launched');
        break;

      case 'GitBash':
        // Create Bash startup script
        scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.sh`);
        fs.writeFileSync(scriptPath, startupScript, 'utf-8');

        const gitBashPath = 'C:\\Program Files\\Git\\git-bash.exe';
        if (fs.existsSync(gitBashPath)) {
          const gitBashProcess = spawn(gitBashPath, ['--init-file', scriptPath], {
            detached: true,
            stdio: 'ignore',
            cwd,
          });
          gitBashProcess.unref();
        }
        break;

      case 'WSL':
        // Create Bash startup script for WSL
        scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.sh`);
        fs.writeFileSync(scriptPath, startupScript, 'utf-8');

        // Convert Windows path to WSL path
        const wslScriptPath = scriptPath.replace(/\\/g, '/').replace(/^([A-Z]):/, (_match, drive) => `/mnt/${drive.toLowerCase()}`);

        const wslProcess = spawn('wsl', ['bash', '--init-file', wslScriptPath], {
          detached: true,
          stdio: 'ignore',
        });
        wslProcess.unref();
        break;

      case 'WindowsTerminal':
        // Windows Terminal - use PowerShell profile by default
        scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.ps1`);
        {
          const psBootstrap = `
# Ensure Node & npm global bin are on PATH for this session
$pathsToAdd = @()
$candidatePaths = @(
  'C:\\Program Files\\nodejs',
  'C:\\Program Files (x86)\\nodejs',
  (Join-Path $env:APPDATA 'npm')
)
foreach ($p in $candidatePaths) {
  if ($p -and (Test-Path $p)) {
    $existing = ($env:Path -split ';') | ForEach-Object { $_.Trim().ToLower() }
    if (-not ($existing -contains $p.ToLower())) { $pathsToAdd += $p }
  }
}
if ($pathsToAdd.Count -gt 0) { $env:Path = $env:Path + ';' + ($pathsToAdd -join ';') }

# Provide a 'claude' helper if not already available
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  function global:claude {
    param([Parameter(ValueFromRemainingArguments=$true)] [string[]]$claudeArgs)
    if (Get-Command npx -ErrorAction SilentlyContinue) {
      npx --yes -p claude claude @claudeArgs
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
      npm exec --yes -p claude -- claude @claudeArgs
    } else {
      Write-Host 'npm/npx not found in PATH; install Node/npm or add to PATH' -ForegroundColor Red
    }
  }
}
`.trim();
          fs.writeFileSync(scriptPath, `${psBootstrap}
${startupScript || ''}`, 'utf-8');
        }

        // Normalize the path to use full long path format (not short path like TRASHA~1)
        try {
          scriptPath = fs.realpathSync(scriptPath);
        } catch (error) {
          // If realpathSync fails, at least verify the file exists
          if (!fs.existsSync(scriptPath)) {
            throw new Error(`Failed to create script file at ${scriptPath}: File does not exist after write`);
          }
        }

        // Verify the file exists before proceeding
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Script file does not exist at ${scriptPath}`);
        }

        // Only open in Windows Terminal - no fallback
        try {
          const useCore = session.powerShellVersion === 'Core';
          const shellExe = useCore ? 'pwsh' : 'powershell';
          // Prepare env with Node/npm
          const env = { ...process.env } as NodeJS.ProcessEnv;
          const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
          const programFilesX86 = process.env['ProgramFiles(x86)'];
          const nodeJsDir = path.join(programFiles, 'nodejs');
          const nodeJsDirX86 = programFilesX86 ? path.join(programFilesX86, 'nodejs') : '';
          const npmGlobalBin = path.join(process.env.APPDATA || '', 'npm');
          [nodeJsDir, nodeJsDirX86, npmGlobalBin].forEach((dir) => {
            if (dir && fs.existsSync(dir) && !String(env.PATH || '').toLowerCase().includes(dir.toLowerCase())) {
              env.PATH = `${env.PATH || ''};${dir}`;
            }
          });
          const wtProcess = spawn('wt', ['-d', cwd, shellExe, '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
            detached: true,
            stdio: 'ignore',
            env,
          });
          wtProcess.unref();
          logger.log('[Terminal Restore] Windows Terminal launched');
        } catch (error) {
          console.error('[Terminal Restore] Failed to launch Windows Terminal:', error);
          throw new Error('Windows Terminal is required. Please install Windows Terminal.');
        }
        break;

      default:
        // Default to PowerShell in Windows Terminal only - no fallback
        scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.ps1`);
        {
          const psBootstrap = `
# Ensure Node & npm global bin are on PATH for this session
$pathsToAdd = @()
$candidatePaths = @(
  'C:\\Program Files\\nodejs',
  'C:\\Program Files (x86)\\nodejs',
  (Join-Path $env:APPDATA 'npm')
)
foreach ($p in $candidatePaths) {
  if ($p -and (Test-Path $p)) {
    $existing = ($env:Path -split ';') | ForEach-Object { $_.Trim().ToLower() }
    if (-not ($existing -contains $p.ToLower())) { $pathsToAdd += $p }
  }
}
if ($pathsToAdd.Count -gt 0) { $env:Path = $env:Path + ';' + ($pathsToAdd -join ';') }

# Provide a 'claude' helper if not already available
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  function global:claude {
    param([Parameter(ValueFromRemainingArguments=$true)] [string[]]$args)
    if (Get-Command npx -ErrorAction SilentlyContinue) {
      npx --yes -p claude claude @args
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
      npm exec --yes -p claude -- claude @args
    } else {
      Write-Host 'npm/npx not found in PATH; install Node/npm or add to PATH' -ForegroundColor Red
    }
  }
}
`.trim();
          fs.writeFileSync(scriptPath, `${psBootstrap}
${startupScript || ''}`, 'utf-8');
        }

        // Normalize the path to use full long path format (not short path like TRASHA~1)
        try {
          scriptPath = fs.realpathSync(scriptPath);
        } catch (error) {
          // If realpathSync fails, at least verify the file exists
          if (!fs.existsSync(scriptPath)) {
            throw new Error(`Failed to create script file at ${scriptPath}: File does not exist after write`);
          }
        }

        // Verify the file exists before proceeding
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Script file does not exist at ${scriptPath}`);
        }

        const cwdEscaped = cwd.replace(/\\/g, '/');
        const scriptPathQuoted = `"${scriptPath}"`;
        const powershellCmd = session.powerShellVersion === 'Core' ? 'pwsh.exe' : 'powershell.exe';
        // Important: avoid --profile so our command line is honored
        const wtCommand = `wt.exe new-tab --title "FlowState Restore" -d "${cwdEscaped}" ${powershellCmd} -NoExit -NoProfile -ExecutionPolicy Bypass -File ${scriptPathQuoted}`;
        
        // Prepare env with Node/npm for exec as well
        const env = { ...process.env } as NodeJS.ProcessEnv;
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'];
        const nodeJsDir = path.join(programFiles, 'nodejs');
        const nodeJsDirX86 = programFilesX86 ? path.join(programFilesX86, 'nodejs') : '';
        const npmGlobalBin = path.join(process.env.APPDATA || '', 'npm');
        [nodeJsDir, nodeJsDirX86, npmGlobalBin].forEach((dir) => {
          if (dir && fs.existsSync(dir) && !String(env.PATH || '').toLowerCase().includes(dir.toLowerCase())) {
            env.PATH = `${env.PATH || ''};${dir}`;
          }
        });

        exec(wtCommand, { cwd: cwd, env }, (error) => {
          if (error) {
            console.error('[Terminal Restore] Failed to launch PowerShell in Windows Terminal:', error);
            // Try spawn method
            try {
              const wtArgs = [
                'new-tab',
                '--profile', 'Windows PowerShell',
                '--title', 'FlowState Restore',
                '-d', cwd,
                'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
              ];
              const wtProcess = spawn('wt.exe', wtArgs, {
                detached: true,
                stdio: 'ignore',
                shell: false,
              });
              wtProcess.unref();
              logger.log('[Terminal Restore] Default PowerShell launched in Windows Terminal');
            } catch (spawnError) {
              console.error('[Terminal Restore] Failed to launch PowerShell in Windows Terminal:', spawnError);
              throw new Error('Windows Terminal is required to restore PowerShell. Please install Windows Terminal.');
            }
          }
        });
    }

    logger.log(`Restored ${session.shellType} terminal with startup script at ${cwd}`);
  } else {
    // No startup script, just open terminal at the working directory
    switch (session.shellType) {
      case 'PowerShell':
        // Restore exactly as captured - no fallbacks
        // MUST have both isWindowsTerminal and powerShellVersion from capture
        if (session.isWindowsTerminal === undefined) {
          throw new Error('Cannot restore terminal: Missing isWindowsTerminal metadata. Terminal must be captured with complete metadata.');
        }
        if (!session.powerShellVersion) {
          throw new Error('Cannot restore terminal: Missing powerShellVersion metadata. Terminal must be captured with complete metadata.');
        }
        
        const useWindowsTerminalNoScript = session.isWindowsTerminal === true; // Strict check
        const usePowerShellCoreNoScript = session.powerShellVersion === 'Core';
        const powershellExeNoScript = usePowerShellCoreNoScript ? 'pwsh.exe' : 'powershell.exe';

        if (useWindowsTerminalNoScript) {
          // Original was in Windows Terminal - restore to Windows Terminal
          try {
            let wt: string;
            try {
              wt = await resolveWtExecutable();
              logDebug(`[Terminal Restore] Resolved wt.exe path (no script): ${wt}`);
            } catch (e) {
              const windowsApps = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps');
              if (fs.existsSync(windowsApps)) {
                logDebug(`[Terminal Restore] Adding WindowsApps to PATH (no script) and using wt.exe from PATH: ${windowsApps}`);
                wt = 'wt.exe';
              } else {
                throw e;
              }
            }

            // Write bootstrap script so PATH and claude helper exist in-session
            const tempDir = os.tmpdir();
            let scriptPathNoScript = path.join(tempDir, `flowstate_restore_${Date.now()}.ps1`);
            const psBootstrapNoScript = `
# Ensure Node & npm global bin are on PATH for this session
$pathsToAdd = @()
$candidatePaths = @(
  'C:\\Program Files\\nodejs',
  'C:\\Program Files (x86)\\nodejs',
  (Join-Path $env:APPDATA 'npm')
)
foreach ($p in $candidatePaths) {
  if ($p -and (Test-Path $p)) {
    $existing = ($env:Path -split ';') | ForEach-Object { $_.Trim().ToLower() }
    if (-not ($existing -contains $p.ToLower())) { $pathsToAdd += $p }
  }
}
if ($pathsToAdd.Count -gt 0) { $env:Path = $env:Path + ';' + ($pathsToAdd -join ';') }

# Provide a 'claude' helper if not already available
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  function global:claude {
    param([Parameter(ValueFromRemainingArguments=$true)] [string[]]$args)
    if (Get-Command npx -ErrorAction SilentlyContinue) {
      npx --yes -p claude claude @args
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
      npm exec --yes -p claude -- claude @args
    } else {
      Write-Host 'npm/npx not found in PATH; install Node/npm or add to PATH' -ForegroundColor Red
    }
  }
}

# Helper to log command paths without null-conditional (works on Windows PowerShell 5)
function Get-CommandPath {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  return ''
}

Write-Host ('Node: ' + (Get-CommandPath 'node'))
Write-Host ('npm: ' + (Get-CommandPath 'npm'))
Write-Host ('npx: ' + (Get-CommandPath 'npx'))
Write-Host ('claude available: ' + [bool](Get-Command claude -ErrorAction SilentlyContinue))

Set-Location -Path '${cwd.replace(/'/g, "''")}'
`.trim();
            fs.writeFileSync(scriptPathNoScript, psBootstrapNoScript, 'utf-8');
            try { scriptPathNoScript = fs.realpathSync(scriptPathNoScript); } catch {}
            if (!fs.existsSync(scriptPathNoScript)) throw new Error(`Bootstrap script missing at ${scriptPathNoScript}`);

            const cwdEscaped = cwd.replace(/"/g, '\\"').replace(/\\/g, '/');
            // Important: Do NOT use --profile here; it overrides command-line
            const wtArgs = `new-tab --title "FlowState Restore" -d "${cwdEscaped}" ${powershellExeNoScript} -NoExit -NoProfile -ExecutionPolicy Bypass -File "${scriptPathNoScript}"`;
            const fullCmd = wt === 'wt.exe' ? `cmd.exe /c "wt.exe ${wtArgs}"` : `"${wt}" ${wtArgs}`;

            const env = { ...process.env } as NodeJS.ProcessEnv;
            const windowsApps = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps');
            if (fs.existsSync(windowsApps) && !String(env.PATH || '').toLowerCase().includes('microsoft\\windowsapps')) {
              env.PATH = `${env.PATH || ''};${windowsApps}`;
              logDebug(`[Terminal Restore] PATH augmented with (no script): ${windowsApps}`);
            }
            // Add Node/npm for no-script path
            const programFiles2 = process.env.ProgramFiles || 'C:\\Program Files';
            const programFiles2x86 = process.env['ProgramFiles(x86)'];
            const nodeDir2 = path.join(programFiles2, 'nodejs');
            const nodeDir2x86 = programFiles2x86 ? path.join(programFiles2x86, 'nodejs') : '';
            const npmBin2 = path.join(process.env.APPDATA || '', 'npm');
            [nodeDir2, nodeDir2x86, npmBin2].forEach((dir) => {
              if (dir && fs.existsSync(dir) && !String(env.PATH || '').toLowerCase().includes(dir.toLowerCase())) {
                env.PATH = `${env.PATH || ''};${dir}`;
              }
            });

            logDebug(`[Terminal Restore] Executing command (no script): ${fullCmd}`);
            exec(fullCmd, { cwd, windowsHide: false, env }, (error, stdout, stderr) => {
              if (error) {
                logDebug(`[Terminal Restore] Windows Terminal exec error (no script):`, error);
                logDebug(`[Terminal Restore] stderr (no script):`, stderr);
                logDebug(`[Terminal Restore] stdout (no script):`, stdout);
              } else {
                logDebug(`[Terminal Restore] Windows Terminal launched successfully (no script)`);
                if (stdout) logDebug(`[Terminal Restore] stdout (no script):`, stdout);
                if (stderr) logDebug(`[Terminal Restore] stderr (no script):`, stderr);
              }
            });
            
            logDebug(`[Terminal Restore] Command executed (no script, async)`);
          } catch (error: any) {
            logDebug('[Terminal Restore] Windows Terminal launch failed (no script):', error);
            logDebug('[Terminal Restore] Error details (no script):', error?.message, error?.stack);
            throw new Error(`Failed to restore terminal: Original was in Windows Terminal, but Windows Terminal launch failed: ${error?.message || error}`);
          }
        } else {
          // Original was in classic console - restore to classic console (no fallbacks)
          try {
            // Create bootstrap script and run it
            const tempDir = os.tmpdir();
            let scriptPathClassic = path.join(tempDir, `flowstate_restore_${Date.now()}.ps1`);
            const psBootstrapClassic = `
# Ensure Node & npm global bin are on PATH for this session
$pathsToAdd = @()
$candidatePaths = @(
  'C:\\Program Files\\nodejs',
  'C:\\Program Files (x86)\\nodejs',
  (Join-Path $env:APPDATA 'npm')
)
foreach ($p in $candidatePaths) {
  if ($p -and (Test-Path $p)) {
    $existing = ($env:Path -split ';') | ForEach-Object { $_.Trim().ToLower() }
    if (-not ($existing -contains $p.ToLower())) { $pathsToAdd += $p }
  }
}
if ($pathsToAdd.Count -gt 0) { $env:Path = $env:Path + ';' + ($pathsToAdd -join ';') }

# Provide a 'claude' helper if not already available
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  function global:claude {
    param([Parameter(ValueFromRemainingArguments=$true)] [string[]]$args)
    if (Get-Command npx -ErrorAction SilentlyContinue) {
      npx --yes -p claude claude @args
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
      npm exec --yes -p claude -- claude @args
    } else {
      Write-Host 'npm/npx not found in PATH; install Node/npm or add to PATH' -ForegroundColor Red
    }
  }
}

# Helper to log command paths without null-conditional (works on Windows PowerShell 5)
function Get-CommandPath {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  return ''
}

Write-Host ('Node: ' + (Get-CommandPath 'node'))
Write-Host ('npm: ' + (Get-CommandPath 'npm'))
Write-Host ('npx: ' + (Get-CommandPath 'npx'))
Write-Host ('claude available: ' + [bool](Get-Command claude -ErrorAction SilentlyContinue))

Set-Location -Path '${cwd.replace(/'/g, "''")}'
`.trim();
            fs.writeFileSync(scriptPathClassic, psBootstrapClassic, 'utf-8');
            try { scriptPathClassic = fs.realpathSync(scriptPathClassic); } catch {}
            if (!fs.existsSync(scriptPathClassic)) throw new Error(`Bootstrap script missing at ${scriptPathClassic}`);

            exec(`start ${powershellExeNoScript} -NoExit -NoProfile -ExecutionPolicy Bypass -File "${scriptPathClassic}"`, (error) => {
              if (error) {
                console.error('[Terminal Restore] Failed to launch classic PowerShell:', error);
                throw new Error(`Failed to restore terminal: Original was in classic console, but PowerShell launch failed: ${error}`);
              }
            });
          } catch (error) {
            console.error('[Terminal Restore] Classic PowerShell launch failed:', error);
            throw new Error(`Failed to restore terminal: Original was in classic console, but PowerShell launch failed: ${error}`);
          }
        }
        break;

      case 'CMD':
        exec(`start cmd /K cd /d "${cwd}"`);
        break;

      case 'GitBash':
        const gitBashPath2 = 'C:\\Program Files\\Git\\git-bash.exe';
        if (fs.existsSync(gitBashPath2)) {
          const gitBashNoScriptProcess = spawn(gitBashPath2, [], {
            detached: true,
            stdio: 'ignore',
            cwd,
          });
          gitBashNoScriptProcess.unref();
        }
        break;

      case 'WSL':
        const wslNoScriptProcess = spawn('wsl', [], {
          detached: true,
          stdio: 'ignore',
        });
        wslNoScriptProcess.unref();
        break;

      case 'WindowsTerminal':
        // Only open in Windows Terminal - no fallback
        try {
          const wtNoScriptProcess = spawn('wt', ['-d', cwd], {
            detached: true,
            stdio: 'ignore',
          });
          wtNoScriptProcess.unref();
          logger.log('[Terminal Restore] Windows Terminal launched');
        } catch (error) {
          console.error('[Terminal Restore] Failed to launch Windows Terminal:', error);
          throw new Error('Windows Terminal is required. Please install Windows Terminal.');
        }
        break;

      default:
        // Unknown shell type - cannot restore without knowing exact type
        console.error(`[Terminal Restore] Cannot restore terminal: Unknown shell type "${session.shellType}". Only terminals with known types can be restored.`);
        throw new Error(`Cannot restore terminal: Unknown shell type "${session.shellType}". Restore is only supported for captured terminals with known types.`);
    }

    logger.log(`Restored ${session.shellType} terminal session at ${cwd}`);
  }
}

/**
 * Restore terminal session on macOS
 */
async function restoreMacOSTerminal(session: TerminalSession, startupScript: string | null): Promise<void> {
  const cwd = session.currentDirectory || os.homedir();

  if (startupScript) {
    // Create bash startup script
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.sh`);
    fs.writeFileSync(scriptPath, startupScript, 'utf-8');

    // Make script executable
    fs.chmodSync(scriptPath, '755');

    // Open Terminal with the startup script
    await execPromise(`open -a Terminal "${scriptPath}"`);

    logger.log(`Restored macOS terminal with startup script at ${cwd}`);
  } else {
    // Open Terminal with working directory
    await execPromise(`open -a Terminal "${cwd}"`);
    logger.log(`Restored macOS terminal session at ${cwd}`);
  }
}

/**
 * Restore terminal session on Linux
 */
async function restoreLinuxTerminal(session: TerminalSession, startupScript: string | null): Promise<void> {
  const cwd = session.currentDirectory || os.homedir();

  if (startupScript) {
    // Create bash startup script
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `flowstate_restore_${Date.now()}.sh`);
    fs.writeFileSync(scriptPath, startupScript, 'utf-8');

    // Make script executable
    fs.chmodSync(scriptPath, '755');

    // Try common terminal emulators with the script
    try {
      await execPromise(`gnome-terminal --working-directory="${cwd}" -- bash --init-file "${scriptPath}"`);
    } catch {
      try {
        await execPromise(`xterm -e "cd ${cwd}; bash --init-file ${scriptPath}"`);
      } catch {
        await execPromise(`konsole --workdir "${cwd}" -e bash --init-file "${scriptPath}"`);
      }
    }

    logger.log(`Restored Linux terminal with startup script at ${cwd}`);
  } else {
    // Try common terminal emulators
    try {
      await execPromise(`gnome-terminal --working-directory="${cwd}"`);
    } catch {
      try {
        await execPromise(`xterm -e "cd ${cwd}; bash"`);
      } catch {
        await execPromise(`konsole --workdir "${cwd}"`);
      }
    }

    logger.log(`Restored Linux terminal session at ${cwd}`);
  }
}
