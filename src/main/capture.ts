import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { prepare, type Capture, type Asset } from './database.js';

const execPromise = promisify(exec);

// Production-silent logging - only log in development
const log = (...args: any[]) => { if (!app.isPackaged) log(...args); };
const logError = (...args: any[]) => console.error(...args);

type CaptureSummary = {
  vsCode: number;
  terminal: number;
  browser: number;
  notes: number;
};

const captureSummaryLabels: Record<keyof CaptureSummary, string> = {
  vsCode: 'VS Code',
  terminal: 'Terminal',
  browser: 'Browser',
  notes: 'Notes',
};

const captureSteps: Array<{
  key: keyof CaptureSummary;
  runner: (captureId: number) => Promise<Asset[]>;
}> = [
  { key: 'vsCode', runner: captureVSCodeSessions },
  { key: 'terminal', runner: captureTerminalSessions },
  { key: 'browser', runner: captureBrowserTabs },
  { key: 'notes', runner: captureNoteSessions },
];

const logCapture = (...args: any[]) => {
  log(...args);
  try {
    const logToRenderer = (global as any).logToRenderer;
    if (logToRenderer) logToRenderer(...args);
  } catch {
    // no-op if renderer logging is unavailable
  }
};

async function createCaptureRecord(
  name: string,
  contextDescription: string,
  userId?: number,
  sessionId?: number
): Promise<number> {
  if (userId && sessionId) {
    const insertCapture = prepare('INSERT INTO captures (name, context_description, user_id, session_id) VALUES (?, ?, ?, ?)');
    const result = insertCapture.run(name, contextDescription, userId, sessionId);
    const captureId = result.lastInsertRowid as number;
    if (!captureId) {
      throw new Error('Failed to create capture record');
    }
    logCapture(`[CAPTURE] Created capture record with ID: ${captureId} (session: ${sessionId})`);
    
    return captureId;
  } else if (userId) {
    const insertCapture = prepare('INSERT INTO captures (name, context_description, user_id) VALUES (?, ?, ?)');
    const result = insertCapture.run(name, contextDescription, userId);
    const captureId = result.lastInsertRowid as number;
    if (!captureId) {
      throw new Error('Failed to create capture record');
    }
    logCapture(`[CAPTURE] Created capture record with ID: ${captureId}`);
    
    return captureId;
  } else {
    const insertCapture = prepare('INSERT INTO captures (name, context_description) VALUES (?, ?)');
    const result = insertCapture.run(name, contextDescription);
    const captureId = result.lastInsertRowid as number;
    if (!captureId) {
      throw new Error('Failed to create capture record');
    }
    logCapture(`[CAPTURE] Created capture record with ID: ${captureId}`);
    return captureId;
  }
}

function logAssetPreview(assets: Asset[]) {
  logCapture('[CAPTURE] ASSETS PREVIEW (before save):');
  if (!assets.length) {
    logCapture('[CAPTURE]   (no assets)');
    return;
  }

  assets.forEach((asset, idx) => {
    const contentLen = (asset.content || '').length;
    const metadataLen = (asset.metadata || '').length;
    logCapture(
      `[CAPTURE]   ${idx + 1}. type=${asset.asset_type} title="${asset.title}" path="${
        asset.path || ''
      }" contentLen=${contentLen} metadataLen=${metadataLen}`
    );
  });
}

function normalizeAsset(asset: Asset, captureId: number): Asset | null {
  if (!asset.asset_type) {
    return null;
  }

  return {
    capture_id: captureId,
    asset_type: asset.asset_type,
    title: asset.title || `Untitled ${asset.asset_type}`,
    path: asset.path ?? undefined,
    content: asset.content ?? undefined,
    metadata: asset.metadata ?? undefined,
  };
}

function saveAssetsForCapture(captureId: number, assets: Asset[]) {
  const insertAsset = prepare(`
    INSERT INTO assets (capture_id, asset_type, title, path, content, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let savedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const asset of assets) {
    const normalized = normalizeAsset(asset, captureId);
    if (!normalized) {
      console.warn('[Capture] Asset missing asset_type, skipping asset:', asset);
      skippedCount++;
      continue;
    }

    try {
      insertAsset.run(
        normalized.capture_id,
        normalized.asset_type,
        normalized.title,
        normalized.path ?? null,
        normalized.content ?? null,
        normalized.metadata ?? null
      );
      savedCount++;
    } catch (error) {
      errorCount++;
      console.error('[Capture] Failed to save asset:', {
        asset_type: normalized.asset_type,
        title: normalized.title,
        capture_id: normalized.capture_id,
        error: (error as Error).message,
      });
    }
  }

  logCapture(`[Capture] Save summary for capture ${captureId}:`);
  logCapture(`  - Successfully saved: ${savedCount}`);
  logCapture(`  - Skipped (missing asset_type): ${skippedCount}`);
  logCapture(`  - Errors: ${errorCount}`);
  logCapture(`  - Total processed: ${assets.length}`);

  if (savedCount === 0 && assets.length > 0) {
    console.error(
      `[Capture] CRITICAL: No assets were saved despite ${assets.length} assets being captured!`
    );
  }

  return { savedCount, skippedCount, errorCount };
}

async function persistCaptureData(captureId: number) {
  try {
    const { saveDatabase } = await import('./database.js');
    saveDatabase(); // saveDatabase is synchronous, not async
    logCapture(`[Capture] Database saved successfully for capture ${captureId}`);
  } catch (error) {
    console.error(
      `[Capture] CRITICAL: Failed to save database for capture ${captureId}:`,
      error
    );
    throw new Error(`Failed to save database: ${(error as Error).message}`);
  }
}

function verifyAssetsSaved(captureId: number, expectedSaved: number) {
  try {
    const verifyAssets = prepare(
      'SELECT COUNT(*) as count FROM assets WHERE capture_id = ?'
    ).get(captureId);
    const count = verifyAssets?.count || 0;
    logCapture(
      `[Capture] Verification: Found ${count} assets in database for capture ${captureId}`
    );

    if (count === 0 && expectedSaved > 0) {
      console.error(
        `[Capture] CRITICAL ERROR: Assets were saved (${expectedSaved}) but verification returned 0 for capture ${captureId}`
      );
    }
    if (count !== expectedSaved && expectedSaved > 0) {
      console.warn(
        `[Capture] WARNING: Asset count mismatch! Expected ${expectedSaved}, found ${count} in database`
      );
    }

    const rows = prepare(
      'SELECT id, asset_type, title, path FROM assets WHERE capture_id = ? ORDER BY id ASC'
    ).all(captureId) as Array<{
      id: number;
      asset_type: string;
      title: string;
      path?: string;
    }>;
    logCapture(`[Capture] ASSETS IN DB (after save): ${rows.length} rows`);
    rows.forEach((row, idx) => {
      logCapture(
        `[Capture]   ${idx + 1}. id=${row.id} type=${row.asset_type} title="${
          row.title
        }" path="${row.path || ''}"`
      );
    });
  } catch (error) {
    console.error('[Capture] Could not verify assets were saved:', error);
  }
}

/**
 * Progress callback for capture steps
 */
export type CaptureProgressCallback = (progress: {
  step: number;
  totalSteps: number;
  currentStep: string;
  status: 'starting' | 'completed';
  assetsCount?: number;
}) => void;

/**
 * Yield control to the event loop to prevent UI blocking
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Lower process priority to minimize system impact during capture
 */
async function lowerProcessPriority(): Promise<void> {
  if (process.platform === 'win32') {
    try {
      // Set current process to Below Normal priority
      await execPromise(`powershell -Command "$proc = Get-Process -Id ${process.pid}; $proc.PriorityClass = 'BelowNormal'"`);
      logCapture('[CAPTURE] Lowered process priority to minimize system impact');
    } catch (error) {
      // Non-critical, continue if it fails
      console.warn('[CAPTURE] Could not lower process priority:', error);
    }
  }
}

/**
 * Restore process priority to normal
 */
async function restoreProcessPriority(): Promise<void> {
  if (process.platform === 'win32') {
    try {
      // Restore to Normal priority
      await execPromise(`powershell -Command "$proc = Get-Process -Id ${process.pid}; $proc.PriorityClass = 'Normal'"`);
      logCapture('[CAPTURE] Restored process priority to normal');
    } catch (error) {
      // Non-critical
      console.warn('[CAPTURE] Could not restore process priority:', error);
    }
  }
}

async function runCaptureSteps(
  captureId: number,
  progressCallback?: CaptureProgressCallback
) {
  const assets: Asset[] = [];
  const summary: CaptureSummary = {
    vsCode: 0,
    terminal: 0,
    browser: 0,
    notes: 0,
  };

  const totalSteps = captureSteps.length;

  for (const [index, step] of captureSteps.entries()) {
    const label = captureSummaryLabels[step.key];
    const stepNumber = index + 1;

    // Notify progress: starting this step
    progressCallback?.({
      step: stepNumber,
      totalSteps,
      currentStep: label,
      status: 'starting',
    });

    logCapture(`[CAPTURE] Step ${stepNumber}: Starting ${label} capture...`);

    // Run the capture step with error handling
    let stepAssets: Asset[] = [];
    try {
      stepAssets = await step.runner(captureId);
      summary[step.key] = stepAssets.length;

      logCapture(
        `[CAPTURE] ✓ Captured ${stepAssets.length} ${label.toLowerCase()} assets`
      );
    } catch (stepError: any) {
      logCapture(`[CAPTURE] ✗ ERROR in ${label} capture step:`);
      logCapture(`[CAPTURE]   Error: ${stepError?.message || String(stepError)}`);
      if (stepError?.stack) {
        logCapture(`[CAPTURE]   Stack: ${stepError.stack}`);
      }
      console.error(`[CAPTURE] Failed to capture ${label}:`, stepError);
      // Continue with other steps even if one fails
      stepAssets = [];
      summary[step.key] = 0;
    }

    // Notify progress: completed this step
    progressCallback?.({
      step: stepNumber,
      totalSteps,
      currentStep: label,
      status: 'completed',
      assetsCount: stepAssets.length,
    });

    assets.push(...stepAssets);

    // Yield to event loop between steps to keep UI responsive
    await yieldToEventLoop();
  }

  return { assets, summary };
}

function logCaptureSummary(summary: CaptureSummary, totalAssets: number) {
  logCapture('[CAPTURE] ============================================');
  logCapture(`[CAPTURE] SUMMARY: Total assets captured: ${totalAssets}`);
  Object.entries(summary).forEach(([key, count]) => {
    logCapture(`[CAPTURE]   - ${captureSummaryLabels[key as keyof CaptureSummary]}: ${count}`);
  });
  logCapture('[CAPTURE] ============================================');
}

function getCaptureRecord(captureId: number, fallbackName: string): Capture {
  const captureRecord = prepare('SELECT * FROM captures WHERE id = ?').get(captureId);
  return {
    id: captureId,
    name: captureRecord?.name || fallbackName,
    context_description:
      captureRecord?.context_description || 'Auto-captured workspace state',
    created_at: captureRecord?.created_at || new Date().toISOString(),
    user_id: captureRecord?.user_id ?? null,
  };
}

/**
 * Create a demo capture with example assets for onboarding/tour purposes
 */
export async function createDemoCapture(userId?: number): Promise<Capture> {
  const { prepare, saveDatabase } = await import('./database.js');
  
  const captureName = 'Example Workspace Capture';
  const contextDescription = 'This is a demo capture to show you how FlowState Dashboard works';
  
  // Create capture record
  const insertCapture = userId 
    ? prepare('INSERT INTO captures (name, context_description, user_id) VALUES (?, ?, ?)')
    : prepare('INSERT INTO captures (name, context_description) VALUES (?, ?)');
  
  const result = userId
    ? insertCapture.run(captureName, contextDescription, userId)
    : insertCapture.run(captureName, contextDescription);
  const captureId = result.lastInsertRowid as number;

  if (!captureId || captureId === 0) {
    throw new Error('Failed to create demo capture record');
  }

  // Create example assets
  const insertAsset = prepare(`
    INSERT INTO assets (capture_id, asset_type, title, path, content, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const exampleAssets = [
    {
      asset_type: 'browser',
      title: 'GitHub - FlowState Dashboard',
      path: 'https://github.com/example/flowstate-dashboard',
      content: 'Example browser tab showing GitHub repository',
      metadata: JSON.stringify({ url: 'https://github.com/example/flowstate-dashboard' }),
    },
    {
      asset_type: 'browser',
      title: 'Documentation - Getting Started',
      path: 'https://docs.example.com/getting-started',
      content: 'Example browser tab with documentation',
      metadata: JSON.stringify({ url: 'https://docs.example.com/getting-started' }),
    },
    {
      asset_type: 'terminal',
      title: 'PowerShell Session',
      path: 'C:\\Users\\Example\\project',
      content: 'cd project\nnpm install\nnpm run dev\n\nWorking directory: C:\\Users\\Example\\project',
      metadata: JSON.stringify({
        shellType: 'powershell',
        currentDirectory: 'C:\\Users\\Example\\project',
        commandHistory: ['cd project', 'npm install', 'npm run dev'],
      }),
    },
    {
      asset_type: 'code',
      title: 'App.tsx',
      path: 'C:\\Users\\Example\\project\\src\\App.tsx',
      content: `import React from 'react';\n\nfunction App() {\n  return (\n    <div className="app">\n      <h1>Welcome to FlowState Dashboard</h1>\n    </div>\n  );\n}\n\nexport default App;`,
      metadata: JSON.stringify({ language: 'typescript', lineCount: 10 }),
    },
    {
      asset_type: 'code',
      title: 'index.css',
      path: 'C:\\Users\\Example\\project\\src\\index.css',
      content: `body {\n  margin: 0;\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n}\n\n.app {\n  padding: 20px;\n}`,
      metadata: JSON.stringify({ language: 'css', lineCount: 7 }),
    },
    {
      asset_type: 'notes',
      title: 'Project Ideas',
      path: 'Notes',
      content: 'Ideas for improving the dashboard:\n- Add dark mode toggle\n- Improve search functionality\n- Add keyboard shortcuts',
      metadata: JSON.stringify({ source: 'notes-app' }),
    },
  ];

  for (const asset of exampleAssets) {
    insertAsset.run(
      captureId,
      asset.asset_type,
      asset.title,
      asset.path,
      asset.content,
      asset.metadata
    );
  }

  await saveDatabase();

  return {
    id: captureId,
    name: captureName,
    created_at: new Date().toISOString(),
    context_description: contextDescription,
  };
}

export async function captureWorkspace(
  name?: string,
  userId?: number,
  sessionId?: number,
  progressCallback?: CaptureProgressCallback
): Promise<Capture> {
  const captureName = name || 'Workspace Capture';
  const contextDescription = 'Auto-captured workspace state';

  logCapture('[CAPTURE] ============================================');
  logCapture('[CAPTURE] Starting workspace capture...');
  logCapture('[CAPTURE] ============================================');

  // Lower process priority to minimize system impact during capture
  await lowerProcessPriority();

  try {
    const captureId = await createCaptureRecord(captureName, contextDescription, userId, sessionId);
    const { assets, summary } = await runCaptureSteps(captureId, progressCallback);

    logCaptureSummary(summary, assets.length);

    try {
      logAssetPreview(assets);
    } catch (previewError) {
      console.warn('[CAPTURE] Failed to log assets preview:', previewError);
    }

    if (!assets.length) {
      console.warn(`[Capture] WARNING: No assets captured for capture ${captureId}!`);
    }

    const { savedCount } = saveAssetsForCapture(captureId, assets);
    await persistCaptureData(captureId);
    verifyAssetsSaved(captureId, savedCount);

    logCapture(
      `Captured ${assets.length} assets for workspace: ${captureName}`
    );
    logCapture(
      `Asset breakdown: ${summary.vsCode} VS Code, ${summary.terminal} terminal, ${summary.browser} browser, ${summary.notes} notes`
    );

    // Cleanup old non-archived captures after successful capture (if limit exceeded)
    // Archived captures are never deleted - they are user's explicit choices
    if (userId) {
      try {
        const { cleanupOldCaptures } = await import('./database.js');
        const { getAllSettings } = await import('./database.js');
        
        // Get user's retention limit preference, default to 100
        const userSettings = getAllSettings(userId);
        const retentionLimit = userSettings.retentionLimit 
          ? parseInt(userSettings.retentionLimit, 10) 
          : 100;
        
        cleanupOldCaptures(userId, retentionLimit);
      } catch (cleanupError) {
        // Don't fail the capture if cleanup fails
        console.warn('[CAPTURE] Cleanup failed (non-critical):', cleanupError);
      }
    }

    return getCaptureRecord(captureId, captureName);
  } catch (error: any) {
    logCapture('[CAPTURE] ============================================');
    logCapture('[CAPTURE] ✗ CRITICAL ERROR: Capture failed');
    logCapture('[CAPTURE] ============================================');
    logCapture(`[CAPTURE] Error type: ${error?.constructor?.name || typeof error}`);
    logCapture(`[CAPTURE] Error message: ${error?.message || String(error)}`);
    if (error?.stack) {
      logCapture(`[CAPTURE] Error stack: ${error.stack}`);
    }
    console.error('[CAPTURE] Error capturing workspace:', error);
    throw error;
  } finally {
    // Always restore process priority, even if capture fails
    await restoreProcessPriority();
  }
}

async function captureNoteSessions(captureId: number): Promise<Asset[]> {
  const assets: Asset[] = [];

  // TEMPORARY: Notes capture disabled due to hanging issue
  // TODO: Fix note-integration.js hanging and re-enable
  log('[Note Capture] Notes capture temporarily disabled');
  return assets;

  // try {
  //   // Import note integration module
  //   const { captureNoteSessions: getNotes } = await import('./note-integration.js');

  //   const sessions = await getNotes();
  //   log(`[Note Capture] Captured ${sessions.length} note session(s)`);

  //   for (const session of sessions) {
  //     // Create a cleaner title for the asset card
  //     let assetTitle = session.title || 'Untitled';
  //     if (session.appName) {
  //       assetTitle = `${session.appName}: ${assetTitle}`;
  //     }

  //     assets.push({
  //       capture_id: captureId,
  //       asset_type: 'notes',
  //       title: assetTitle,
  //       path: session.filePath || session.url,
  //       content: session.content || `${session.appName} session`,
  //       metadata: JSON.stringify({
  //           appName: session.appName,
  //           title: session.title,
  //           url: session.url,
  //           filePath: session.filePath,
  //           processId: session.processId,
  //         }),
  //     });

  //     log(`[Note Capture] Saved note asset: ${assetTitle}`);
  //   }
  // } catch (error) {
  //   console.warn('[Note Capture] Could not capture note sessions:', error);
  // }

  // return assets;
}

async function captureVSCodeSessions(captureId: number): Promise<Asset[]> {
  const assets: Asset[] = [];

  try {
    // Import the comprehensive IDE capture module
    const { captureIDESessions } = await import('./ide-capture.js');

    logCapture('[Capture] ============================================');
    logCapture('[Capture] Starting IDE capture...');
    logCapture('[Capture] ============================================');
    
    const ideCapture = await captureIDESessions();

    logCapture(`[Capture] Found ${ideCapture.totalSessions} IDE session(s)`);
    if (ideCapture.totalSessions === 0) {
      logCapture('[Capture] ⚠️  No IDE sessions detected. Check console for details.');
    }

    // Create an asset for each IDE session
    for (const session of ideCapture.sessions) {
      // Build content preview
      let contentPreview = `IDE: ${session.ideName}\n\n`;

      if (session.workspacePaths.length > 0) {
        contentPreview += `📁 Open Workspaces (${session.workspacePaths.length}):\n`;
        session.workspacePaths.forEach(ws => {
          contentPreview += `  • ${ws}\n`;
        });
        contentPreview += '\n';
      }

      if (session.openFiles.length > 0) {
        contentPreview += `📄 Open Files (${session.openFiles.length}):\n`;
        session.openFiles.slice(0, 10).forEach(file => {
          const fileName = file.path.split(/[\\/]/).pop();
          contentPreview += `  • ${fileName}\n`;
        });
        if (session.openFiles.length > 10) {
          contentPreview += `  ... and ${session.openFiles.length - 10} more\n`;
        }
        contentPreview += '\n';
      }

      if (session.recentWorkspaces.length > 0) {
        contentPreview += `🕒 Recent Workspaces (${session.recentWorkspaces.length}):\n`;
        session.recentWorkspaces.slice(0, 5).forEach(ws => {
          contentPreview += `  • ${ws}\n`;
        });
        if (session.recentWorkspaces.length > 5) {
          contentPreview += `  ... and ${session.recentWorkspaces.length - 5} more\n`;
        }
      }

      // Use primary workspace path or first recent workspace as the "path"
      const primaryPath = session.workspacePaths[0] || session.recentWorkspaces[0] || 'Unknown';

      assets.push({
        capture_id: captureId,
        asset_type: 'code',
        title: `${session.ideName} - ${primaryPath.split(/[\\/]/).pop()}`,
        path: primaryPath,
        content: contentPreview,
        metadata: JSON.stringify({
          ideName: session.ideName,
          workspacePaths: session.workspacePaths,
          openFiles: session.openFiles,
          recentWorkspaces: session.recentWorkspaces,
          processId: session.processId,
          contextFile: session.contextFile,
        }),
      });

      logCapture(`[Capture] ✓ Captured ${session.ideName} session: ${primaryPath}`);
    }
  } catch (error: any) {
    logCapture('[Capture] ============================================');
    logCapture('[Capture] ✗ ERROR: Failed to capture IDE sessions');
    logCapture('[Capture] ============================================');
    logCapture('[Capture] Error type:', error?.constructor?.name || typeof error);
    logCapture('[Capture] Error message:', error?.message || String(error));
    if (error?.stack) {
      logCapture('[Capture] Error stack:', error.stack);
    }
    console.error('Could not capture IDE sessions:', error);
  }

  return assets;
}

async function captureTerminalSessions(captureId: number): Promise<Asset[]> {
  const assets: Asset[] = [];
  
  // Helper to log to both console and renderer
  const logDebug = (...args: any[]) => {
    log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  logDebug('[Capture] Starting enhanced terminal capture...');
  logDebug('[Capture] logToRenderer available:', typeof (global as any).logToRenderer);

  try {
    // Import the enhanced terminal capture module
    logDebug('[Capture] Step 1: Importing terminal-capture module...');
    const terminalCaptureModule = await import('./terminal-capture.js');
    logDebug('[Capture] ✓ Module imported successfully');
    logDebug('[Capture] Module exports:', Object.keys(terminalCaptureModule));
    
    if (!terminalCaptureModule.captureTerminalSessions) {
      throw new Error('captureTerminalSessions function not found in module');
    }
    
    const captureTerminals = terminalCaptureModule.captureTerminalSessions;
    logDebug('[Capture] Step 2: Calling captureTerminals()...');
    
    // Capture all terminal sessions with their state
    const terminalCapture = await captureTerminals();
    logDebug('[Capture] ✓ captureTerminals() completed');
    logDebug('[Capture] Total sessions captured:', terminalCapture.totalSessions);

    logDebug(`[Capture] Captured ${terminalCapture.totalSessions} terminal session(s)`);

    // Create an asset for each terminal session
    for (const session of terminalCapture.sessions) {
      const historyPreview = session.commandHistory?.slice(-10).join('\n') || 'No command history available';
      const cwdInfo = session.currentDirectory ? `Working directory: ${session.currentDirectory}` : '';

      // Build content preview
      let contentPreview = cwdInfo;
      const isClaudeSession = !!session.claudeCodeContext?.isClaudeCodeRunning;

      // Add running commands info if available
      if (session.runningCommands && session.runningCommands.length > 0) {
        contentPreview += '\n\n🔄 Running processes:\n';
        for (const cmd of session.runningCommands) {
          contentPreview += `  • ${cmd.processName}: ${cmd.commandLine}\n`;
        }
      }

      // Add last executed command if available
      if (session.lastExecutedCommand) {
        contentPreview += `\n\n📝 Last command: ${session.lastExecutedCommand}`;
      }

      contentPreview += `\n\nRecent commands:\n${historyPreview}`;

      // Prepare metadata object - only include defined values
      const metadataObj: any = {
        processId: session.processId,
        processName: session.processName,
        shellType: session.shellType,
        capturedAt: terminalCapture.capturedAt,
      };

      // Only add optional fields if they exist, and safely serialize complex objects
      if (session.currentDirectory) metadataObj.currentDirectory = session.currentDirectory;
      if (session.commandHistory) metadataObj.commandHistory = session.commandHistory;
      if (session.environmentVariables) metadataObj.environmentVariables = session.environmentVariables;
      if (session.windowTitle) metadataObj.windowTitle = session.windowTitle;
      if (session.runningProcesses) metadataObj.runningProcesses = session.runningProcesses;
      
      // Safely serialize runningCommands - extract only serializable properties
      if (session.runningCommands && session.runningCommands.length > 0) {
        metadataObj.runningCommands = session.runningCommands.map(cmd => ({
          processId: cmd.processId,
          processName: cmd.processName,
          commandLine: cmd.commandLine,
          workingDirectory: cmd.workingDirectory,
          executionTime: cmd.executionTime,
        }));
      }
      
      if (session.lastExecutedCommand) metadataObj.lastExecutedCommand = session.lastExecutedCommand;
      if (session.powerShellVersion) metadataObj.powerShellVersion = session.powerShellVersion;
      if (session.isWindowsTerminal !== undefined) {
        metadataObj.isWindowsTerminal = session.isWindowsTerminal;
        logDebug(`[DEBUG Capture] Saving terminal metadata - isWindowsTerminal: ${session.isWindowsTerminal} (type: ${typeof session.isWindowsTerminal})`);
      } else {
        logDebug(`[DEBUG Capture] WARNING: isWindowsTerminal is undefined for ${session.shellType} session`);
      }

      // Include Claude Code context if available
      if (session.claudeCodeContext) {
        try {
          // Convert Date objects to ISO strings for JSON serialization
          metadataObj.claudeCodeContext = {
            ...session.claudeCodeContext,
            sessionStartTime: session.claudeCodeContext.sessionStartTime.toISOString(),
          };
          if (isClaudeSession) {
            const claude = session.claudeCodeContext;
            contentPreview += '\n\n🤖 Claude Code is running in this terminal.';
            if (claude.workingDirectory) {
              contentPreview += `\nWorkspace: ${claude.workingDirectory}`;
            }
            if (claude.startupCommand) {
              contentPreview += `\nStartup command: ${claude.startupCommand}`;
            }
            if (claude.contextHint) {
              contentPreview += `\nContext: ${claude.contextHint}`;
            }
            if (claude.commandHistoryBeforeStart?.length) {
              contentPreview += '\nCommands before launch:\n';
              claude.commandHistoryBeforeStart.forEach(cmd => {
                contentPreview += `  • ${cmd}\n`;
              });
            }
          }
        } catch (error) {
          console.warn('Error serializing Claude Code context:', error);
          // Continue without context rather than breaking the whole capture
        }
      }

      // Safely stringify metadata
      let metadataString: string;
      try {
        metadataString = JSON.stringify(metadataObj);
        // Validate that the string can be parsed back (sanity check)
        try {
          JSON.parse(metadataString);
          logDebug(`[Capture] ✓ Metadata validated: ${metadataString.length} chars`);
        } catch (parseError) {
          console.error('[Capture] ✗ CRITICAL: Generated metadata string is not valid JSON!', parseError);
          console.error('[Capture] Metadata string (first 500 chars):', metadataString.substring(0, 500));
          // Fallback to minimal safe metadata
          throw new Error('Generated metadata failed validation');
        }
      } catch (error) {
        console.error('Error stringifying metadata, using minimal metadata:', error);
        // Fallback to minimal safe metadata
        metadataString = JSON.stringify({
          processId: session.processId,
          processName: session.processName,
          shellType: session.shellType,
          capturedAt: terminalCapture.capturedAt,
        });
        // Validate fallback too
        try {
          JSON.parse(metadataString);
        } catch (fallbackError) {
          console.error('[Capture] ✗ CRITICAL: Even fallback metadata is invalid!', fallbackError);
          metadataString = '{}'; // Last resort
        }
      }

      const assetTitle = isClaudeSession
        ? `Claude Code (${session.shellType})`
        : `${session.shellType} - ${session.windowTitle || `PID ${session.processId}`}`;

      assets.push({
        capture_id: captureId,
        asset_type: 'terminal',
        title: assetTitle,
        path: session.currentDirectory,
        content: contentPreview,
        metadata: metadataString,
      });
    }
    
    logDebug(`[Capture] Created ${assets.length} terminal assets from sessions`);

    // If no sessions found, create a placeholder
    if (terminalCapture.totalSessions === 0) {
      assets.push({
        capture_id: captureId,
        asset_type: 'terminal',
        title: 'No Active Terminals',
        content: 'No terminal sessions detected at capture time.',
        metadata: JSON.stringify({
          platform: process.platform,
          capturedAt: terminalCapture.capturedAt
        }),
      });
      logDebug('[Capture] Created placeholder asset for no sessions');
    } else {
      logDebug('[Capture] ✓ Enhanced capture succeeded!');
    }
  } catch (error: any) {
    // Helper to log to both console and renderer
    const logError = (...args: any[]) => {
      console.error(...args);
      try {
        const logToRenderer = (global as any).logToRenderer;
        if (logToRenderer) logToRenderer(...args);
      } catch {}
    };

    logError('[Capture] ============================================');
    logError('[Capture] ✗ ERROR: Enhanced terminal capture failed!');
    logError('[Capture] ============================================');
    logError('[Capture] Error type:', error?.constructor?.name || typeof error);
    logError('[Capture] Error message:', error?.message || String(error));
    logError('[Capture] Error stack:', error?.stack);
    logError('[Capture] This is why you see "Terminal Sessions (Basic)" assets');
    logError('[Capture] ============================================');
    console.warn('Could not capture terminal sessions:', error);

    // Fallback to basic terminal detection
    if (process.platform === 'win32') {
      const terminalProcesses = ['powershell.exe', 'cmd.exe', 'WindowsTerminal.exe'];
      const detectedTerminals: string[] = [];

      for (const processName of terminalProcesses) {
        try {
          const { sanitizeProcessName } = await import('./utils/security.js');
          const sanitizedProcess = sanitizeProcessName(processName);
          const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${sanitizedProcess}"`);
          if (stdout && stdout.includes(sanitizedProcess)) {
            detectedTerminals.push(processName);
          }
        } catch (err) {
          // Continue checking other terminals
        }
      }

      if (detectedTerminals.length > 0) {
        assets.push({
          capture_id: captureId,
          asset_type: 'terminal',
          title: 'Terminal Sessions (Basic)',
          content: `Active terminals: ${detectedTerminals.join(', ')}`,
          metadata: JSON.stringify({
            terminals: detectedTerminals,
            count: detectedTerminals.length,
            platform: 'win32',
            note: 'Enhanced capture failed, showing basic detection only'
          }),
        });
      }
    }
  }

  return assets;
}

async function captureBrowserTabs(captureId: number): Promise<Asset[]> {
  const assets: Asset[] = [];

  // Helper to log to both console and renderer (matches terminal capture pattern)
  const logCapture = (...args: any[]) => {
    log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  logCapture('[Browser Capture] ============================================');
  logCapture('[Browser Capture] Starting browser capture...');
  logCapture('[Browser Capture] ============================================');

  try {
    // Import browser integration module
    logCapture('[Browser Capture] Importing browser-integration module...');
    const { captureBrowserSessions, detectBrowsersWithoutDebugging, getDebugInstructions } = await import('./browser-integration.js');
    logCapture('[Browser Capture] ✓ Module imported successfully');

    // Capture browsers with remote debugging enabled
    logCapture('[Browser Capture] Calling captureBrowserSessions()...');
    const sessions = await captureBrowserSessions();
    logCapture('[Browser Capture] ✓ captureBrowserSessions() completed');

    logCapture(`[Browser Capture] Found ${sessions.length} browser session(s) with debugging enabled`);
    for (const session of sessions) {
      logCapture(`[Browser Capture] Capturing ${session.tabs.length} tabs from ${session.browserName} (port ${session.debuggingPort})`);
      for (const tab of session.tabs) {
        assets.push({
          capture_id: captureId,
          asset_type: 'browser',
          title: tab.title || 'Untitled Tab',
          path: tab.url,
          content: `${session.browserName} - ${tab.title}`,
          metadata: JSON.stringify({
            browserName: session.browserName,
            browserPath: session.browserPath,
            debuggingPort: session.debuggingPort,
            url: tab.url,
            tabId: tab.id,
            faviconUrl: tab.faviconUrl,
          }),
        });
      }
    }

    // Detect browsers running without debugging
    logCapture('[Browser Capture] Checking for browsers without debugging...');
    const browsersWithoutDebug = await detectBrowsersWithoutDebugging();
    logCapture(`[Browser Capture] Found ${browsersWithoutDebug.length} browser(s) without debugging: ${browsersWithoutDebug.join(', ')}`);

    if (browsersWithoutDebug.length > 0) {
      for (const browserName of browsersWithoutDebug) {
        assets.push({
          capture_id: captureId,
          asset_type: 'browser',
          title: `${browserName} (Debugging Disabled)`,
          content: getDebugInstructions(browserName),
          metadata: JSON.stringify({
            browserName,
            debuggingEnabled: false,
            note: 'Browser is running but remote debugging is not enabled. Tabs cannot be captured.',
          }),
        });
      }
    }

    logCapture('[Browser Capture] ============================================');
    if (sessions.length > 0) {
      logCapture(`[Browser Capture] ✓ SUCCESS: Captured ${assets.length} browser tabs from ${sessions.length} browser session(s)`);
    } else {
      logCapture(`[Browser Capture] ⚠️  WARNING: No browser sessions with debugging enabled found.`);
      if (browsersWithoutDebug.length > 0) {
        logCapture(`[Browser Capture]   Found ${browsersWithoutDebug.length} browser(s) without debugging: ${browsersWithoutDebug.join(', ')}`);
        logCapture(`[Browser Capture]   To capture tabs, enable remote debugging for these browsers.`);
      } else {
        logCapture(`[Browser Capture]   No browsers detected running.`);
      }
    }
    logCapture(`[Browser Capture] Total browser assets created: ${assets.length}`);
    logCapture('[Browser Capture] ============================================');
  } catch (error) {
    logCapture('[Browser Capture] ============================================');
    logCapture('[Browser Capture] ✗ ERROR: Could not capture browser tabs');
    if (error instanceof Error) {
      logCapture(`[Browser Capture] Error message: ${error.message}`);
      if (error.stack) {
        logCapture(`[Browser Capture] Error stack: ${error.stack}`);
      }
    } else {
      logCapture(`[Browser Capture] Error: ${String(error)}`);
    }
    logCapture('[Browser Capture] ============================================');

    // Fallback to basic detection
    if (process.platform === 'win32') {
      const browserProcesses = ['chrome.exe', 'firefox.exe', 'msedge.exe', 'brave.exe'];
      const detectedBrowsers: string[] = [];

      for (const processName of browserProcesses) {
        try {
          const { sanitizeProcessName } = await import('./utils/security.js');
          const sanitizedProcess = sanitizeProcessName(processName);
          const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${sanitizedProcess}"`);
          if (stdout && stdout.includes(sanitizedProcess)) {
            detectedBrowsers.push(processName.replace('.exe', ''));
          }
        } catch (err) {
          // Continue checking other browsers
        }
      }

      if (detectedBrowsers.length > 0) {
        assets.push({
          capture_id: captureId,
          asset_type: 'browser',
          title: 'Browser Sessions (Basic)',
          content: `Active browsers: ${detectedBrowsers.join(', ')}. Enable remote debugging for full tab capture.`,
          metadata: JSON.stringify({
            note: 'Remote debugging not enabled. Start browser with --remote-debugging-port=9222 for full tab capture.',
            browsers: detectedBrowsers,
            count: detectedBrowsers.length,
            platform: 'win32',
          }),
        });
      }
    }
  }

  return assets;
}
