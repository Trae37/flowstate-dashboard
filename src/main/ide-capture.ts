/**
 * IDE Capture Module
 * Captures state from VS Code, Cursor, and other IDEs
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execPromise = promisify(exec);

export interface IDESession {
  ideName: 'VSCode' | 'Cursor' | 'Unknown';
  processId?: number;
  workspacePaths: string[];
  openFiles: OpenFile[];
  recentWorkspaces: string[];
  windowLayout?: WindowLayout;
  extensions?: string[];
  contextFile?: {
    path: string;
    content: string;
  };
}

export interface OpenFile {
  path: string;
  cursorPosition?: { line: number; column: number };
  isActive?: boolean;
}

export interface WindowLayout {
  splitEditors?: string[];
  activeEditor?: string;
}

export interface IDECaptureResult {
  sessions: IDESession[];
  totalSessions: number;
}

/**
 * Main function to capture all IDE sessions
 */
export async function captureIDESessions(): Promise<IDECaptureResult> {
  console.log('[IDE Capture] Starting IDE capture...');

  const sessions: IDESession[] = [];

  // Capture VS Code sessions
  const vscodeSessions = await captureVSCode();
  sessions.push(...vscodeSessions);

  // Capture Cursor sessions
  const cursorSessions = await captureCursor();
  sessions.push(...cursorSessions);

  console.log(`[IDE Capture] Captured ${sessions.length} IDE session(s)`);

  return {
    sessions,
    totalSessions: sessions.length,
  };
}

/**
 * Capture VS Code sessions
 */
async function captureVSCode(): Promise<IDESession[]> {
  const sessions: IDESession[] = [];

  try {
    // Check if VS Code is running
    const isRunning = await isIDERunning('Code.exe', 'Code');
    if (!isRunning) {
      console.log('[IDE Capture] VS Code not running');
      return sessions;
    }

    console.log('[IDE Capture] VS Code detected, capturing state...');

    // Get VS Code state directory
    const stateDir = path.join(
      process.env.APPDATA || os.homedir(),
      'Code',
      'User'
    );

    const session = await captureIDEState('VSCode', stateDir);
    if (session) {
      sessions.push(session);
    }
  } catch (error) {
    console.warn('[IDE Capture] Failed to capture VS Code:', error);
  }

  return sessions;
}

/**
 * Capture Cursor sessions
 */
async function captureCursor(): Promise<IDESession[]> {
  const sessions: IDESession[] = [];

  try {
    // Check if Cursor is running
    const isRunning = await isIDERunning('Cursor.exe', 'Cursor');
    if (!isRunning) {
      console.log('[IDE Capture] Cursor not running');
      return sessions;
    }

    console.log('[IDE Capture] Cursor detected, capturing state...');

    // Get Cursor state directory
    const stateDir = path.join(
      process.env.APPDATA || os.homedir(),
      'Cursor',
      'User'
    );

    const session = await captureIDEState('Cursor', stateDir);
    if (session) {
      sessions.push(session);
    }
  } catch (error) {
    console.warn('[IDE Capture] Failed to capture Cursor:', error);
  }

  return sessions;
}

/**
 * Check if an IDE is running
 */
async function isIDERunning(
  windowsProcessName: string,
  macProcessName: string
): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execPromise(
        `tasklist /FI "IMAGENAME eq ${windowsProcessName}"`
      );
      return stdout.includes(windowsProcessName);
    } else if (process.platform === 'darwin') {
      const { stdout } = await execPromise(
        `ps aux | grep "${macProcessName}" | grep -v grep || true`
      );
      return stdout.trim().length > 0;
    }
  } catch (error) {
    console.warn(`[IDE Capture] Failed to check if ${windowsProcessName} is running:`, error);
  }
  return false;
}

/**
 * Capture IDE state from storage files
 */
async function captureIDEState(
  ideName: 'VSCode' | 'Cursor',
  stateDir: string
): Promise<IDESession | null> {
  try {
    const session: IDESession = {
      ideName,
      workspacePaths: [],
      openFiles: [],
      recentWorkspaces: [],
    };

    // Read globalState.json for recent workspaces
    const globalStatePath = path.join(stateDir, 'globalStorage', 'storage.json');
    if (fs.existsSync(globalStatePath)) {
      const globalState = JSON.parse(fs.readFileSync(globalStatePath, 'utf-8'));

      // Try to get workspace history from various storage keys
      const workspaceHistory =
        globalState['workbench.panel.recentlyOpenedWorkspaces'] ||
        globalState['history.recentlyOpenedPathsList'] ||
        {};

      if (workspaceHistory.entries) {
        session.recentWorkspaces = workspaceHistory.entries
          .map((entry: any) => entry.folderUri || entry.workspace?.configPath)
          .filter(Boolean)
          .map((uri: string) => decodeURIPath(uri))
          .slice(0, 10);
      }
    }

    // Read workspace state to get currently open workspace
    const workspaceStoragePath = path.join(stateDir, 'workspaceStorage');
    if (fs.existsSync(workspaceStoragePath)) {
      const workspaces = fs.readdirSync(workspaceStoragePath);

      // Find workspaces that have been actively used very recently (within last 5 minutes)
      // This indicates the workspace is currently open
      const now = Date.now();
      const recentThreshold = 5 * 60 * 1000; // 5 minutes

      const activeWorkspaces = workspaces
        .map((workspaceId) => {
          const workspacePath = path.join(workspaceStoragePath, workspaceId);
          try {
            // Check state.vscdb modification time - this gets updated as you use the editor
            const stateDbPath = path.join(workspacePath, 'state.vscdb');
            if (fs.existsSync(stateDbPath)) {
              const stateStats = fs.statSync(stateDbPath);
              const timeSinceModified = now - stateStats.mtime.getTime();

              // If the state DB was modified within the last 5 minutes, this workspace is likely open
              if (timeSinceModified < recentThreshold) {
                return { workspaceId, mtime: stateStats.mtime, isActive: true };
              }
            }

            // Fallback: check folder modification time
            const folderStats = fs.statSync(workspacePath);
            const folderTimeSinceModified = now - folderStats.mtime.getTime();
            if (folderTimeSinceModified < recentThreshold) {
              return { workspaceId, mtime: folderStats.mtime, isActive: false };
            }

            return null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => {
          // Prioritize workspaces with recently modified state.vscdb
          if (a!.isActive && !b!.isActive) return -1;
          if (!a!.isActive && b!.isActive) return 1;
          // Then sort by modification time
          return b!.mtime.getTime() - a!.mtime.getTime();
        });

      // Process only the currently active workspace
      console.log(`[IDE Capture] Found ${activeWorkspaces.length} active workspace(s)`);
      if (activeWorkspaces.length > 0) {
        const activeWorkspace = activeWorkspaces[0]!;
        const workspaceId = activeWorkspace.workspaceId;
        const workspaceJsonPath = path.join(workspaceStoragePath, workspaceId, 'workspace.json');

        console.log(`[IDE Capture] Processing workspace: ${workspaceId}`);
        console.log(`[IDE Capture] Workspace JSON path: ${workspaceJsonPath}`);
        console.log(`[IDE Capture] JSON exists: ${fs.existsSync(workspaceJsonPath)}`);

        if (fs.existsSync(workspaceJsonPath)) {
          try {
            const workspaceData = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
            console.log(`[IDE Capture] Workspace data:`, workspaceData);

            // Get workspace folder path
            if (workspaceData.folder) {
              const folderPath = decodeURIPath(workspaceData.folder);
              console.log(`[IDE Capture] Decoded folder path: ${folderPath}`);
              if (folderPath && !session.workspacePaths.includes(folderPath)) {
                session.workspacePaths.push(folderPath);
                console.log(`[IDE Capture] Added workspace path: ${folderPath}`);
              }
            }

            // Try to get open editors from workspace state
            const statePath = path.join(workspaceStoragePath, workspaceId, 'state.vscdb');
            if (fs.existsSync(statePath)) {
              // This is a SQLite database, but we can read it as text to extract file paths
              const stateContent = fs.readFileSync(statePath, 'utf-8');

              // Extract file paths using regex (looking for file:/// URIs)
              const fileUriMatches = stateContent.match(/file:\/\/\/[^\s\\"<>|]+/g) || [];
              const uniquePaths = new Set<string>();

              for (const uri of fileUriMatches) {
                const filePath = decodeURIPath(uri);
                if (filePath && fs.existsSync(filePath) && !uniquePaths.has(filePath)) {
                  uniquePaths.add(filePath);
                  session.openFiles.push({ path: filePath });
                }
              }
            }
          } catch (err) {
            console.warn(`[IDE Capture] Failed to read workspace ${workspaceId}:`, err);
          }
        }
      }
    }

    // Capture or create context file for the workspace
    if (session.workspacePaths.length > 0) {
      const workspacePath = session.workspacePaths[0];
      const contextFilePath = path.join(workspacePath, '.flowstate_context.md');

      try {
        // Analyze workspace to generate intelligent context
        const { analyzeWorkspace } = await import('./workspace-analysis.js');
        const analysis = await analyzeWorkspace(workspacePath, ideName);

        if (fs.existsSync(contextFilePath)) {
          // Read existing context file
          const content = fs.readFileSync(contextFilePath, 'utf-8');
          session.contextFile = {
            path: contextFilePath,
            content: content,
          };
          console.log(`[IDE Capture] Found context file: ${contextFilePath}`);
        } else if (analysis) {
          // Create intelligent context file from analysis
          const timestamp = new Date().toISOString();

          let content = `# ${ideName} Workspace Context\n\n`;
          content += `**Workspace**: ${workspacePath}\n`;
          content += `**Created**: ${timestamp}\n\n`;
          content += `---\n\n`;

          // AI-Assisted vs Manual Changes
          content += `## 🤖 File Changes\n\n`;

          if (analysis.filesEditedByAI.length > 0) {
            content += `### AI-Assisted (${analysis.filesEditedByAI.length} files)\n`;
            analysis.filesEditedByAI.forEach(file => {
              const fileName = path.basename(file);
              content += `- \`${fileName}\`\n`;
            });
            content += '\n';
          }

          if (analysis.filesEditedManually.length > 0) {
            content += `### Manual Changes (${analysis.filesEditedManually.length} files)\n`;
            analysis.filesEditedManually.forEach(file => {
              const fileName = path.basename(file);
              content += `- \`${fileName}\`\n`;
            });
            content += '\n';
          }

          // Recent Changes
          if (analysis.recentChanges.length > 0) {
            content += `### Recent Activity\n`;
            analysis.recentChanges.slice(0, 5).forEach(change => {
              content += `- ${change.summary}\n`;
            });
            content += '\n';
          }

          content += `---\n\n`;

          // TODOs
          if (analysis.todoItems.length > 0) {
            content += `## 📋 Outstanding TODOs\n\n`;
            analysis.todoItems.slice(0, 5).forEach(todo => {
              const emoji = todo.priority === 'high' ? '🔴' : todo.priority === 'medium' ? '🟡' : '🟢';
              content += `${emoji} **${path.basename(todo.file)}:${todo.line}**\n`;
              content += `   ${todo.text}\n\n`;
            });
            content += `---\n\n`;
          }

          // Recommendations
          if (analysis.recommendations.length > 0) {
            content += `## 💡 Recommendations\n\n`;
            analysis.recommendations.forEach((rec, i) => {
              content += `${i + 1}. ${rec}\n`;
            });
            content += `\n---\n\n`;
          }

          // Continuation Prompt
          content += analysis.continuationPrompt;

          content += `\n---\n`;
          content += `*Auto-generated by FlowState. Edit to add more context.*\n`;

          fs.writeFileSync(contextFilePath, content, 'utf-8');
          session.contextFile = {
            path: contextFilePath,
            content: content,
          };
          console.log(`[IDE Capture] Created intelligent context file: ${contextFilePath}`);
        }
      } catch (err) {
        console.warn(`[IDE Capture] Could not handle context file:`, err);
      }
    }

    // If we found any workspace info, return the session
    if (session.workspacePaths.length > 0 || session.recentWorkspaces.length > 0) {
      console.log(`[IDE Capture] ${ideName} session captured:`);
      console.log(`  Workspaces: ${session.workspacePaths.length}`);
      console.log(`  Open files: ${session.openFiles.length}`);
      console.log(`  Recent workspaces: ${session.recentWorkspaces.length}`);
      console.log(`  Context file: ${session.contextFile ? 'Yes' : 'No'}`);
      return session;
    }

    return null;
  } catch (error) {
    console.warn(`[IDE Capture] Failed to capture ${ideName} state:`, error);
    return null;
  }
}

/**
 * Decode file:// URI to filesystem path
 */
function decodeURIPath(uri: string): string {
  try {
    // Remove file:// or file:/// prefix
    let path = uri.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');

    // Decode URI components
    path = decodeURIComponent(path);

    // On Windows, paths might start with a drive letter
    if (process.platform === 'win32') {
      // Convert /C:/path to C:\path
      path = path.replace(/^\/([a-zA-Z]):/, '$1:');
      // Convert forward slashes to backslashes
      path = path.replace(/\//g, '\\');
    }

    return path;
  } catch (error) {
    console.warn('[IDE Capture] Failed to decode URI path:', uri, error);
    return '';
  }
}

/**
 * Restore IDE session
 */
export async function restoreIDESession(session: IDESession): Promise<void> {
  console.log(`[IDE Restore] Restoring ${session.ideName} session...`);

  try {
    // Restore context file if it exists
    if (session.contextFile && session.workspacePaths.length > 0) {
      const workspacePath = session.workspacePaths[0];
      const contextFilePath = path.join(workspacePath, '.flowstate_context.md');

      try {
        // Update the context file with restoration timestamp
        const timestamp = new Date().toISOString();
        const restoredContent = session.contextFile.content + `\n\n---\n**Restored**: ${timestamp}\n`;

        fs.writeFileSync(contextFilePath, restoredContent, 'utf-8');
        console.log(`[IDE Restore] Restored context file: ${contextFilePath}`);
      } catch (err) {
        console.warn(`[IDE Restore] Could not restore context file:`, err);
      }
    }

    // Determine IDE executable
    let ideCommand: string;

    if (session.ideName === 'VSCode') {
      ideCommand = 'code';
    } else if (session.ideName === 'Cursor') {
      ideCommand = 'cursor';
    } else {
      console.warn(`[IDE Restore] Unknown IDE: ${session.ideName}`);
      return;
    }

    // Restore workspaces
    for (const workspacePath of session.workspacePaths) {
      if (fs.existsSync(workspacePath)) {
        console.log(`[IDE Restore] Opening workspace: ${workspacePath}`);

        if (process.platform === 'win32') {
          await execPromise(`"${ideCommand}" "${workspacePath}"`).catch((err) => {
            console.warn(`[IDE Restore] Failed to open workspace with ${ideCommand}:`, err);
            // Try alternative: Use full path to executable
            const altPath = session.ideName === 'Cursor'
              ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe')
              : path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');

            if (fs.existsSync(altPath)) {
              return execPromise(`"${altPath}" "${workspacePath}"`);
            }
          });
        } else {
          await execPromise(`${ideCommand} "${workspacePath}"`);
        }
      } else {
        console.warn(`[IDE Restore] Workspace path no longer exists: ${workspacePath}`);
      }
    }

    // If no workspaces but we have open files, open the first file's directory
    if (session.workspacePaths.length === 0 && session.openFiles.length > 0) {
      const firstFile = session.openFiles[0].path;
      if (fs.existsSync(firstFile)) {
        console.log(`[IDE Restore] Opening file: ${firstFile}`);

        if (process.platform === 'win32') {
          await execPromise(`"${ideCommand}" "${firstFile}"`).catch(() => {
            // Fallback with full path
            const altPath = session.ideName === 'Cursor'
              ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe')
              : path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');

            if (fs.existsSync(altPath)) {
              return execPromise(`"${altPath}" "${firstFile}"`);
            }
          });
        } else {
          await execPromise(`${ideCommand} "${firstFile}"`);
        }
      }
    }

    console.log(`[IDE Restore] ${session.ideName} restoration complete`);
  } catch (error) {
    console.error(`[IDE Restore] Failed to restore ${session.ideName}:`, error);
    throw error;
  }
}
