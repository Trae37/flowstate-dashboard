import { exec } from 'child_process';
import { promisify } from 'util';
import { shell } from 'electron';
import { prepare, type Asset } from './database.js';

const execPromise = promisify(exec);

/**
 * Wait for Claude Code to initialize by polling for the process
 */
async function waitForClaudeCodeInitialization(): Promise<void> {
  const maxWaitTime = 10000; // 10 seconds max
  const pollInterval = 500; // Check every 500ms
  const startTime = Date.now();

  console.log('[Restore] Waiting for Claude Code process to start...');

  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Check for Claude Code process on Windows
      if (process.platform === 'win32') {
        // Check command line to ensure it's actually Claude Code
        try {
          const { stdout: wmicOutput } = await execPromise(
            'wmic process where "name=\'node.exe\'" get commandline /format:csv',
            { timeout: 2000 }
          );

          if (wmicOutput.toLowerCase().includes('claude')) {
            console.log('[Restore] ✓ Claude Code process detected and running');
            // Give it a moment more to fully initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            return;
          }
        } catch {
          // wmic failed, continue polling
        }
      } else {
        // macOS/Linux
        try {
          const { stdout } = await execPromise('ps aux | grep -i claude | grep -v grep');
          if (stdout.trim()) {
            console.log('[Restore] ✓ Claude Code process detected and running');
            await new Promise(resolve => setTimeout(resolve, 1000));
            return;
          }
        } catch {
          // Process not found yet
        }
      }
    } catch (error) {
      // Continue polling
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Timeout reached - Claude Code might still be starting, but proceed anyway
  console.log('[Restore] ⚠ Timeout waiting for Claude Code, proceeding with restoration...');
}

interface CaptureRow {
  id: number;
  name: string;
  created_at: string;
  context_description?: string;
}

export async function restoreWorkspace(captureId: number): Promise<void> {
  // Get capture and assets
  const capture = prepare('SELECT * FROM captures WHERE id = ?').get(captureId) as CaptureRow | undefined;
  const assets = prepare('SELECT * FROM assets WHERE capture_id = ?').all(captureId) as Asset[];

  if (!capture) {
    throw new Error(`Capture with ID ${captureId} not found`);
  }

  console.log(`Restoring workspace: ${capture.name} with ${assets.length} assets`);

  // Separate assets by type with priority order
  const terminalAssets: Asset[] = [];
  const codeAssets: Asset[] = [];
  const browserAssets: Asset[] = [];
  const notesAssets: Asset[] = [];

  for (const asset of assets) {
    switch (asset.asset_type) {
      case 'terminal':
        terminalAssets.push(asset);
        break;
      case 'code':
        codeAssets.push(asset);
        break;
      case 'browser':
        browserAssets.push(asset);
        break;
      case 'notes':
        notesAssets.push(asset);
        break;
      default:
        console.log(`Unknown asset type: ${asset.asset_type}`);
    }
  }

  // Step 1: Restore terminals FIRST (includes Claude Code initialization)
  let hasClaudeCode = false;
  for (const asset of terminalAssets) {
    try {
      const metadata = asset.metadata ? JSON.parse(asset.metadata) : null;
      if (metadata?.claudeCodeContext?.isClaudeCodeRunning) {
        hasClaudeCode = true;
      }
      await restoreTerminalAsset(asset);
    } catch (error) {
      console.error(`Failed to restore terminal asset ${asset.id}:`, error);
      // Continue with other assets
    }
  }

  // Step 2: If Claude Code was detected, wait for it to initialize before opening visual assets
  if (hasClaudeCode) {
    console.log('[Restore] Claude Code detected, waiting for initialization...');
    await waitForClaudeCodeInitialization();
  }

  // Step 3: Restore code files
  for (const asset of codeAssets) {
    try {
      await restoreCodeAsset(asset);
    } catch (error) {
      console.error(`Failed to restore code asset ${asset.id}:`, error);
    }
  }

  // Step 4: Restore notes
  for (const asset of notesAssets) {
    try {
      await restoreNotesAsset(asset);
    } catch (error) {
      console.error(`Failed to restore notes asset ${asset.id}:`, error);
    }
  }

  // Step 5: Restore browser/visual assets LAST (after Claude Code is ready)
  if (browserAssets.length > 0) {
    console.log('[Restore] Restoring visual assets (browsers)...');
    await restoreBrowserAssets(browserAssets);
  }

  console.log('Workspace restoration complete');
}

async function restoreCodeAsset(asset: Asset): Promise<void> {
  try {
    // Check if this is a comprehensive IDE session (has metadata with IDE info)
    if (asset.metadata) {
      try {
        const metadata = JSON.parse(asset.metadata);

        // If this is a captured IDE session, use comprehensive restore
        if (metadata.ideName && (metadata.ideName === 'VSCode' || metadata.ideName === 'Cursor')) {
          console.log(`[Restore] Restoring ${metadata.ideName} session...`);

          const { restoreIDESession } = await import('./ide-capture.js');

          const ideSession = {
            ideName: metadata.ideName,
            workspacePaths: metadata.workspacePaths || [],
            openFiles: metadata.openFiles || [],
            recentWorkspaces: metadata.recentWorkspaces || [],
            processId: metadata.processId,
            contextFile: metadata.contextFile,
          };

          await restoreIDESession(ideSession);
          console.log(`[Restore] ${metadata.ideName} restoration complete`);
          return;
        }
      } catch (parseError) {
        console.warn('[Restore] Could not parse IDE metadata, falling back to simple restore');
      }
    }

    // Fallback: Simple file/folder opening (legacy behavior)
    if (!asset.path) {
      console.warn('No path specified for code asset');
      return;
    }

    console.log(`[Restore] Opening file/folder: ${asset.path}`);

    if (process.platform === 'win32') {
      // Windows: Try code/cursor command first, then fallback
      await execPromise(`code "${asset.path}"`).catch(() => {
        return execPromise(`cursor "${asset.path}"`);
      }).catch(() => {
        shell.openPath(asset.path!);
      });
    } else if (process.platform === 'darwin') {
      // macOS
      await execPromise(`open -a "Visual Studio Code" "${asset.path}"`).catch(() => {
        return execPromise(`open -a "Cursor" "${asset.path}"`);
      }).catch(() => {
        shell.openPath(asset.path!);
      });
    } else {
      // Linux
      await execPromise(`code "${asset.path}"`).catch(() => {
        shell.openPath(asset.path!);
      });
    }

    console.log(`[Restore] Opened code file/folder: ${asset.path}`);
  } catch (error) {
    console.error('Failed to restore code asset:', error);
    throw error;
  }
}

async function restoreTerminalAsset(asset: Asset): Promise<void> {
  try {
    // Try to restore with enhanced terminal capture
    try {
      const { restoreTerminalSession } = await import('./terminal-capture.js');

      // Helper to log to both console and renderer
      const logDebug = (...args: any[]) => {
        console.log(...args);
        try {
          const logToRenderer = (global as any).logToRenderer;
          if (logToRenderer) logToRenderer(...args);
        } catch {}
      };

      // Parse metadata - it should already be normalized by restoreAsset
      let metadata: any = null;
      if (asset.metadata) {
        // Metadata should already be normalized to valid JSON string
        if (typeof asset.metadata === 'string') {
          try {
            metadata = JSON.parse(asset.metadata);
            logDebug('[DEBUG Restore] ✓ Metadata parsed successfully');
          } catch (parseError: any) {
            // This shouldn't happen after normalization, but handle gracefully
            logDebug('[DEBUG Restore] ✗ ERROR: Metadata should have been normalized but parse failed!');
            logDebug('[DEBUG Restore] Metadata value:', asset.metadata.substring(0, 200));
            throw new Error(`Failed to parse terminal metadata: ${parseError?.message || 'Unknown error'}. Metadata should have been normalized.`);
          }
        } else if (typeof asset.metadata === 'object') {
          // Already parsed (shouldn't happen after normalization, but handle it)
          metadata = asset.metadata;
          logDebug('[DEBUG Restore] Metadata is already an object (unexpected after normalization)');
        } else {
          throw new Error(`Unexpected metadata type: ${typeof asset.metadata}`);
        }
      } else {
        logDebug('[DEBUG Restore] No metadata found in asset');
      }

      // Check if this is a placeholder/basic asset that can't be restored
      if (metadata && !metadata.shellType) {
        logDebug('[DEBUG Restore] This is a placeholder/basic terminal asset without shellType');
        logDebug('[DEBUG Restore] Metadata keys:', Object.keys(metadata || {}));
        logDebug('[DEBUG Restore] Full metadata:', JSON.stringify(metadata, null, 2));
        
        // Check if metadata was corrupted
        if (metadata.corrupted) {
          throw new Error('Cannot restore terminal: Metadata was corrupted and cannot be restored. Please create a new capture to restore terminals.');
        }
        
        // Check if this is a basic detection asset
        if (metadata.note && (metadata.note.includes('basic detection') || metadata.note.includes('Enhanced capture failed'))) {
          throw new Error('Cannot restore terminal: This is a basic terminal detection that was captured without full session metadata. Only terminals captured with enhanced capture (including shell type, command history, etc.) can be restored.');
        }
        
        throw new Error('Cannot restore: This is a basic/placeholder terminal asset that was captured without full session metadata. Only terminals with complete metadata (including shellType) can be restored.');
      }

      if (metadata && metadata.shellType) {
        // Log to both console and renderer
        const logDebug = (...args: any[]) => {
          console.log(...args);
          try {
            const logToRenderer = (global as any).logToRenderer;
            if (logToRenderer) logToRenderer(...args);
          } catch {}
        };
        
        // Derive missing PowerShell version from captured metadata (running commands/processes)
        const derivePowerShellVersion = (m: any): 'Core' | 'Classic' | undefined => {
          try {
            // Prefer explicit value if present
            if (m?.powerShellVersion === 'Core' || m?.powerShellVersion === 'Classic') {
              return m.powerShellVersion;
            }
            // Look into runningCommands
            const cmds: Array<{ processName?: string; commandLine?: string }> = Array.isArray(m?.runningCommands) ? m.runningCommands : [];
            const hasPwshCmd = cmds.some(c =>
              String(c.processName || '').toLowerCase() === 'pwsh.exe' ||
              String(c.commandLine || '').toLowerCase().includes('pwsh')
            );
            if (hasPwshCmd) return 'Core';
            const hasClassicCmd = cmds.some(c =>
              String(c.processName || '').toLowerCase() === 'powershell.exe' ||
              String(c.commandLine || '').toLowerCase().includes('powershell.exe')
            );
            if (hasClassicCmd) return 'Classic';
            // Look into runningProcesses
            const procs: string[] = Array.isArray(m?.runningProcesses) ? m.runningProcesses : [];
            const hasPwshProc = procs.some(p => String(p).toLowerCase() === 'pwsh.exe');
            if (hasPwshProc) return 'Core';
            const hasClassicProc = procs.some(p => String(p).toLowerCase() === 'powershell.exe');
            if (hasClassicProc) return 'Classic';
            // Check lastExecutedCommand/commandHistory hints
            if (typeof m?.lastExecutedCommand === 'string' && m.lastExecutedCommand.toLowerCase().includes('pwsh')) {
              return 'Core';
            }
            const hist: string[] = Array.isArray(m?.commandHistory) ? m.commandHistory : [];
            if (hist.some(h => String(h).toLowerCase().includes('pwsh'))) {
              return 'Core';
            }
          } catch {}
          return undefined;
        };

        logDebug('[DEBUG Restore] Parsed metadata from database:');
        logDebug('[DEBUG Restore]   shellType:', metadata.shellType);
        logDebug('[DEBUG Restore]   powerShellVersion:', metadata.powerShellVersion, '(type:', typeof metadata.powerShellVersion, ')');
        logDebug('[DEBUG Restore]   isWindowsTerminal:', metadata.isWindowsTerminal, '(type:', typeof metadata.isWindowsTerminal, ')');
        logDebug('[DEBUG Restore]   isWindowsTerminal === true:', metadata.isWindowsTerminal === true);
        logDebug('[DEBUG Restore]   isWindowsTerminal === undefined:', metadata.isWindowsTerminal === undefined);
        
        // If PowerShell version is missing but we can infer, set it before restore
        if ((metadata.shellType === 'PowerShell' || metadata.shellType === 'WindowsTerminal') && !metadata.powerShellVersion) {
          const inferred = derivePowerShellVersion(metadata);
          if (inferred) {
            logDebug('[DEBUG Restore]   Inferred powerShellVersion from metadata:', inferred);
            metadata.powerShellVersion = inferred;
          } else {
            logDebug('[DEBUG Restore]   Could not infer powerShellVersion; will default based on restore logic');
          }
        }

        // Restore Claude Code context if available (convert sessionStartTime back to Date)
        let claudeCodeContext: any = undefined;
        if (metadata.claudeCodeContext) {
          claudeCodeContext = { ...metadata.claudeCodeContext };
          if (claudeCodeContext.sessionStartTime) {
            claudeCodeContext.sessionStartTime = new Date(claudeCodeContext.sessionStartTime);
          }
        }

        // Restore using session metadata with full state
        logDebug('[DEBUG Restore] Passing to restoreTerminalSession:');
        logDebug('[DEBUG Restore]   isWindowsTerminal:', metadata.isWindowsTerminal);
        logDebug('[DEBUG Restore]   powerShellVersion:', metadata.powerShellVersion);
        
        logDebug('[DEBUG Restore] About to call restoreTerminalSession...');
        try {
          await restoreTerminalSession({
            processId: metadata.processId || 0,
            processName: metadata.processName || 'terminal',
            shellType: metadata.shellType,
            currentDirectory: metadata.currentDirectory || asset.path,
            commandHistory: metadata.commandHistory,
            environmentVariables: metadata.environmentVariables,
            windowTitle: metadata.windowTitle,
            runningProcesses: metadata.runningProcesses,
            runningCommands: metadata.runningCommands,
            lastExecutedCommand: metadata.lastExecutedCommand,
            claudeCodeContext: claudeCodeContext,
            powerShellVersion: metadata.powerShellVersion,
            isWindowsTerminal: metadata.isWindowsTerminal,
          });
          logDebug('[DEBUG Restore] restoreTerminalSession completed successfully');
        } catch (restoreError: any) {
          logDebug('[DEBUG Restore] restoreTerminalSession threw error:', restoreError);
          logDebug('[DEBUG Restore] Error message:', restoreError?.message);
          logDebug('[DEBUG Restore] Error stack:', restoreError?.stack);
          throw restoreError; // Re-throw to propagate
        }

        console.log(`Restored ${metadata.shellType} terminal session${metadata.currentDirectory ? ` at ${metadata.currentDirectory}` : ''}${metadata.runningCommands?.length ? ` with ${metadata.runningCommands.length} running process(es)` : ''}`);
        return;
      }
    } catch (enhancedError: any) {
      console.error('[Terminal Restore] Failed to restore terminal with captured metadata:', enhancedError);
      console.error('[Terminal Restore] Error type:', enhancedError?.constructor?.name || typeof enhancedError);
      console.error('[Terminal Restore] Error message:', enhancedError?.message);
      console.error('[Terminal Restore] Error stack:', enhancedError?.stack);
      if (asset.metadata) {
        console.error('[Terminal Restore] Problematic metadata:', asset.metadata.substring(0, 500));
      }
      throw new Error(`Cannot restore terminal: Missing or invalid metadata. Terminal can only be restored if it was captured with complete metadata. Error: ${enhancedError?.message || enhancedError}`);
    }
    
    // If we reach here, metadata was missing or invalid
    console.error('[Terminal Restore] Cannot restore terminal: Missing required metadata (shellType).');
    throw new Error('Cannot restore terminal: Missing required metadata. Terminal can only be restored if it was captured with complete metadata including shellType.');
  } catch (error) {
    console.error('Failed to restore terminal asset:', error);
    // Re-throw the error so it propagates to the caller
    throw error;
  }
}

/**
 * Restore browser assets grouped by browser for efficient tab opening
 */
async function restoreBrowserAssets(assets: Asset[]): Promise<void> {
  // Group assets by browser
  const browserGroups = new Map<string, { assets: Asset[]; debuggingPort?: number }>();

  for (const asset of assets) {
    try {
      const metadata = asset.metadata ? JSON.parse(asset.metadata) : {};

      // Skip debugging disabled notices
      if (metadata.debuggingEnabled === false) {
        console.log(`[Browser Restore] Skipping browser notice: ${asset.title}`);
        continue;
      }

      const url = metadata.url || asset.path;
      if (!url || (!url.startsWith('http') && !url.startsWith('chrome://') && !url.startsWith('edge://'))) {
        continue;
      }

      // Skip internal browser URLs
      if (url.startsWith('chrome://') || url.startsWith('edge://')) {
        console.log(`[Browser Restore] Skipped internal browser URL: ${asset.title}`);
        continue;
      }

      const browserName = metadata.browserName || 'Default';
      const browserPath = metadata.browserPath || '';
      const debuggingPort = metadata.debuggingPort;
      const browserKey = `${browserName}|${browserPath}`;

      if (!browserGroups.has(browserKey)) {
        browserGroups.set(browserKey, { assets: [], debuggingPort });
      }
      browserGroups.get(browserKey)!.assets.push(asset);
      // Update debugging port if available
      if (debuggingPort && !browserGroups.get(browserKey)!.debuggingPort) {
        browserGroups.get(browserKey)!.debuggingPort = debuggingPort;
      }
    } catch (error) {
      console.error(`[Browser Restore] Failed to process browser asset ${asset.id}:`, error);
    }
  }

  // Restore each browser group
  for (const [browserKey, group] of browserGroups.entries()) {
    const [browserName, browserPath] = browserKey.split('|');
    const urls = group.assets
      .map(asset => {
        try {
          const metadata = asset.metadata ? JSON.parse(asset.metadata) : {};
          return metadata.url || asset.path;
        } catch {
          return null;
        }
      })
      .filter((url): url is string => url !== null && url.startsWith('http'));

    if (urls.length === 0) {
      continue;
    }

    console.log(`[Browser Restore] Restoring ${urls.length} tab(s) in ${browserName}...`);

    try {
      // Try to use CDP if we have a debugging port and browser is already running
      if (group.debuggingPort && (browserName === 'Chrome' || browserName === 'Edge' || browserName === 'Brave')) {
        try {
          const CDP = (await import('chrome-remote-interface')).default;
          const targets = await CDP.List({ port: group.debuggingPort });
          
          if (targets.length > 0) {
            // Browser is already running with debugging - use CDP to open tabs
            console.log(`[Browser Restore] Browser ${browserName} is running with debugging on port ${group.debuggingPort}, using CDP to open tabs...`);
            
            // Connect without a target to access the Target domain
            // This allows us to create new targets (tabs)
            const client = await CDP({ port: group.debuggingPort });
            
            for (const url of urls) {
              try {
                // Create a new page/tab using Target.createTarget
                // Target domain is available when connecting without a target
                const result = await client.Target.createTarget({ url });
                console.log(`[Browser Restore] ✓ Created new tab via CDP: ${url} (targetId: ${result.targetId})`);
                
                // Small delay between tabs
                await new Promise(resolve => setTimeout(resolve, 200));
              } catch (cdpErr: any) {
                // If createTarget doesn't work, try using the browser's command line
                console.warn(`[Browser Restore] CDP createTarget failed for ${url}, using spawn:`, cdpErr?.message || cdpErr);
                await openUrlInBrowser(browserPath, url);
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            }
            
            await client.close();
            console.log(`[Browser Restore] ✓ Opened ${urls.length} tab(s) in ${browserName} via CDP`);
            continue;
          }
        } catch (cdpErr: any) {
          console.log(`[Browser Restore] CDP not available (browser may not be running), using spawn method...`, cdpErr?.message || cdpErr);
        }
      }

      // Fallback: spawn browser or use default browser
      if (browserPath && (browserName === 'Chrome' || browserName === 'Edge' || browserName === 'Brave')) {
        // Try to open all URLs at once
        const { spawn } = await import('child_process');
        
        // For Chrome/Edge/Brave, we can pass multiple URLs
        // But to ensure all tabs open, we'll open them one by one with a small delay
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          if (i === 0) {
            // First URL: spawn new browser instance
            spawn(browserPath, [url], { detached: true, stdio: 'ignore' });
            console.log(`[Browser Restore] Opened first tab in ${browserName}: ${url}`);
          } else {
            // Subsequent URLs: add to existing instance
            // Use the browser's command-line to add tabs
            spawn(browserPath, [url], { detached: true, stdio: 'ignore' });
            console.log(`[Browser Restore] Opened tab ${i + 1}/${urls.length} in ${browserName}: ${url}`);
          }
          // Small delay to avoid overwhelming
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        console.log(`[Browser Restore] ✓ Opened ${urls.length} tab(s) in ${browserName}`);
      } else {
        // Fallback: open URLs one by one in default browser
        for (const url of urls) {
          await shell.openExternal(url);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log(`[Browser Restore] ✓ Opened ${urls.length} tab(s) in default browser`);
      }
    } catch (err) {
      console.warn(`[Browser Restore] Failed to open tabs in ${browserName}, falling back to default browser:`, err);
      // Fallback to default browser
      for (const url of urls) {
        try {
          await shell.openExternal(url);
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (fallbackErr) {
          console.error(`[Browser Restore] Failed to open URL ${url}:`, fallbackErr);
        }
      }
    }
  }
}

/**
 * Helper function to open a URL in a specific browser
 */
async function openUrlInBrowser(browserPath: string, url: string): Promise<void> {
  const { spawn } = await import('child_process');
  spawn(browserPath, [url], { detached: true, stdio: 'ignore' });
}

async function restoreBrowserAsset(asset: Asset): Promise<void> {
  // This function is kept for individual asset restoration
  // For workspace restoration, restoreBrowserAssets is used instead
  console.log(`[Browser Restore] Restoring individual browser asset: ${asset.title} (ID: ${asset.id})`);
  try {
    const metadata = asset.metadata ? JSON.parse(asset.metadata) : {};
    console.log(`[Browser Restore] Asset metadata:`, JSON.stringify(metadata, null, 2));
    
    // Check if this is a debugging disabled notice
    if (metadata.debuggingEnabled === false) {
      console.log(`[Browser Restore] This is a debugging disabled notice, cannot restore`);
      throw new Error('Cannot restore: Browser debugging is not enabled. Please enable remote debugging and try again.');
    }
    
    const url = metadata.url || asset.path;
    console.log(`[Browser Restore] URL to restore: ${url}`);
    
    if (!url) {
      throw new Error('No URL found in asset metadata or path');
    }
    
    if (!url.startsWith('http') && !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('brave://')) {
      throw new Error(`Invalid URL format: ${url}. Only HTTP/HTTPS URLs can be restored.`);
    }
    
    // Skip internal browser URLs
    if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('brave://')) {
      throw new Error(`Cannot restore internal browser URL: ${url}`);
    }
    
    // Use the grouped restore function which handles CDP and fallbacks
    await restoreBrowserAssets([asset]);
    console.log(`[Browser Restore] ✓ Successfully restored browser asset: ${asset.title}`);
  } catch (error) {
    console.error(`[Browser Restore] ✗ Failed to restore browser asset ${asset.id}:`, error);
    throw error;
  }
}

async function restoreNotesAsset(asset: Asset): Promise<void> {
  try {
    const metadata = asset.metadata ? JSON.parse(asset.metadata) : {};
    const appName = metadata.appName || 'Unknown';

    console.log(`[Note Restore] Restoring ${appName} note asset`);

    // Handle different note apps
    switch (appName) {
      case 'Notion':
        {
          const pageTitle = metadata.title || 'Unknown Page';
          console.log(`[Note Restore] Restoring Notion page: "${pageTitle}"`);
          
          if (metadata.url) {
            // If we have a URL, open it directly
            await shell.openExternal(metadata.url);
            console.log(`[Note Restore] ✓ Opened Notion URL: ${metadata.url}`);
          } else {
            // No URL, just open the Notion app
            console.log(`[Note Restore] Opening Notion app (captured page: "${pageTitle}")`);
            console.log(`[Note Restore] Note: You'll need to manually navigate to the page`);
            
            if (process.platform === 'win32') {
              const { exec } = await import('child_process');
              const path = await import('path');
              
              // Try common Notion installation paths
              const localAppData = process.env.LOCALAPPDATA || '';
              const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
              
              const notionPaths = [
                path.join(localAppData, 'Programs', 'Notion', 'Notion.exe'),
                path.join(programFiles, 'Notion', 'Notion.exe'),
                'Notion.exe' // Fallback to PATH
              ];
              
              let notionPath = notionPaths[2]; // Default to PATH
              const fs = await import('fs');
              
              // Find the first existing path
              for (const p of notionPaths) {
                if (fs.existsSync(p)) {
                  notionPath = p;
                  console.log(`[Note Restore] Found Notion at: ${notionPath}`);
                  break;
                }
              }
              
              exec(`"${notionPath}"`, (error) => {
                if (error) {
                  console.warn('[Note Restore] ✗ Could not open Notion:', error.message);
                  console.warn('[Note Restore] Tried path:', notionPath);
                } else {
                  console.log(`[Note Restore] ✓ Opened Notion app - Look for page: "${pageTitle}"`);
                }
              });
            } else if (process.platform === 'darwin') {
              const { exec } = await import('child_process');
              exec('open -a Notion', (error) => {
                if (error) {
                  console.warn('[Note Restore] ✗ Could not open Notion:', error.message);
                } else {
                  console.log(`[Note Restore] ✓ Opened Notion app on macOS - Look for page: "${pageTitle}"`);
                }
              });
            }
          }
        }
        break;

      case 'Notepad':
        if (metadata.filePath && metadata.filePath !== 'Untitled') {
          // Open specific file in Notepad
          await shell.openPath(metadata.filePath);
          console.log(`[Note Restore] Opened Notepad file: ${metadata.filePath}`);
        } else {
          // Just open a new Notepad window
          const { exec } = await import('child_process');
          exec('notepad', (error) => {
            if (error) {
              console.warn('[Note Restore] Could not open Notepad:', error);
            } else {
              console.log('[Note Restore] Opened new Notepad window');
            }
          });
        }
        break;

      case 'Apple Notes':
        if (process.platform === 'darwin') {
          const { exec } = await import('child_process');
          exec('open -a Notes', (error) => {
            if (error) {
              console.warn('[Note Restore] Could not open Apple Notes:', error);
            } else {
              console.log('[Note Restore] Opened Apple Notes');
            }
          });
        }
        break;

      default:
        // Generic fallback for other note apps
        if (metadata.url) {
          await shell.openExternal(metadata.url);
          console.log(`[Note Restore] Opened notes URL: ${metadata.url}`);
        } else if (asset.path) {
          await shell.openPath(asset.path);
          console.log(`[Note Restore] Opened notes file: ${asset.path}`);
        } else {
          console.log('[Note Restore] Notes asset has no path or URL to restore');
        }
        break;
    }
  } catch (error) {
    console.error('[Note Restore] Failed to restore notes asset:', error);
  }
}

export async function restoreAsset(assetId: number): Promise<void> {
  const { prepare } = await import('./database.js');
  // Get the asset from database
  const asset = prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Asset | undefined;

  if (!asset) {
    throw new Error(`Asset with ID ${assetId} not found`);
  }

  // Helper to log to both console and renderer
  const logDebug = (...args: any[]) => {
    console.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  logDebug(`[DEBUG Restore] Restoring individual asset: ${asset.title} (${asset.asset_type})`);
  logDebug(`[DEBUG Restore] Asset metadata from database:`);
  logDebug(`[DEBUG Restore]   Metadata type: ${typeof asset.metadata}`);
  logDebug(`[DEBUG Restore]   Metadata is null?: ${asset.metadata === null}`);
  logDebug(`[DEBUG Restore]   Metadata is undefined?: ${asset.metadata === undefined}`);
  if (asset.metadata) {
    if (typeof asset.metadata === 'string') {
      logDebug(`[DEBUG Restore]   Metadata string length: ${asset.metadata.length}`);
      logDebug(`[DEBUG Restore]   First 500 chars: ${asset.metadata.substring(0, 500)}`);
      logDebug(`[DEBUG Restore]   Last 200 chars: ${asset.metadata.substring(Math.max(0, asset.metadata.length - 200))}`);
    } else {
      logDebug(`[DEBUG Restore]   Metadata value: ${JSON.stringify(asset.metadata).substring(0, 500)}`);
    }
  }

  // Validate and fix corrupted metadata before attempting to restore
  // SQL.js may return metadata as an object or string, so normalize it to always be valid JSON
  if (asset.metadata) {
    try {
      let parsed: any = null;
      
      if (typeof asset.metadata === 'object') {
        // Already an object - just use it and stringify back
        parsed = asset.metadata;
        asset.metadata = JSON.stringify(parsed);
        logDebug(`[DEBUG Restore] ✓ Converted object metadata to JSON string`);
      } else if (typeof asset.metadata === 'string') {
        // It's a string - try to parse it directly as JSON
        let metadataStr = asset.metadata.trim();

        try {
          parsed = JSON.parse(metadataStr);
          // If parsed result is itself a string (double-encoded), parse again
          if (typeof parsed === 'string') {
            logDebug(`[DEBUG Restore] Detected double-encoded metadata, parsing again`);
            parsed = JSON.parse(parsed);
          }
          asset.metadata = JSON.stringify(parsed);
          logDebug(`[DEBUG Restore] ✓ Metadata normalized successfully`);
        } catch (parseError: any) {
          logDebug(`[DEBUG Restore] ✗ Failed to parse metadata: ${parseError.message}`);
          logDebug(`[DEBUG Restore] Metadata preview: ${metadataStr.substring(0, 100)}...`);
          // Replace with valid fallback
          parsed = null;
        }
      }
      
      // If parsing failed or metadata is null, create fallback
      if (!parsed) {
        if (asset.asset_type === 'terminal') {
          asset.metadata = JSON.stringify({
            asset_type: 'terminal',
            note: 'Metadata was corrupted and has been reset. This terminal cannot be restored.',
            corrupted: true,
          });
        } else {
          asset.metadata = JSON.stringify({
            asset_type: asset.asset_type,
            note: 'Metadata was corrupted and has been reset',
            corrupted: true,
          });
        }
        logDebug(`[DEBUG Restore] ✓ Replaced corrupted metadata with valid fallback`);
      }
    } catch (error: any) {
      // Ultimate fallback - ensure we always have valid JSON
      logDebug(`[DEBUG Restore] ✗ Critical error normalizing metadata: ${error.message}`);
      asset.metadata = JSON.stringify({
        asset_type: asset.asset_type || 'other',
        note: 'Metadata normalization failed',
        corrupted: true,
      });
    }
  }

  // Restore based on asset type
  switch (asset.asset_type) {
    case 'code':
      await restoreCodeAsset(asset);
      break;
    case 'terminal':
      await restoreTerminalAsset(asset);

      // If this terminal had Claude Code running, wait for it to initialize
      try {
        const metadata = asset.metadata ? JSON.parse(asset.metadata) : null;
        if (metadata?.claudeCodeContext?.isClaudeCodeRunning) {
          logDebug('[Restore] Claude Code detected in terminal, waiting for initialization...');
          await waitForClaudeCodeInitialization();
          logDebug('[Restore] Claude Code initialization complete');
        }
      } catch (error) {
        logDebug('[Restore] Error checking for Claude Code:', error);
      }
      break;
    case 'browser':
      await restoreBrowserAsset(asset);
      break;
    case 'notes':
      await restoreNotesAsset(asset);
      break;
    default:
      console.log(`Unknown asset type: ${asset.asset_type}`);
  }

  console.log('Asset restoration complete');
}
