// CRITICAL: Fix EPIPE errors FIRST, before any imports that might trigger warnings
// This must be at the very top of the file
if (typeof process !== 'undefined') {
  if (process.stderr && typeof process.stderr.write === 'function') {
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = function(chunk: any, encoding?: any, callback?: any): boolean {
      try {
        if (process.stderr && process.stderr.writable && !process.stderr.destroyed) {
          return originalStderrWrite(chunk, encoding, (err?: Error | null) => {
            if (err && ((err as any).code === 'EPIPE' || (err as any).errno === -32)) {
              return; // Ignore EPIPE
            }
            if (callback) callback(err);
          });
        }
        return false;
      } catch (error: any) {
        if (error?.code === 'EPIPE' || error?.errno === -32) {
          return false;
        }
        throw error;
      }
    };
  }

  if (process.stdout && typeof process.stdout.write === 'function') {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function(chunk: any, encoding?: any, callback?: any): boolean {
      try {
        if (process.stdout && process.stdout.writable && !process.stdout.destroyed) {
          return originalStdoutWrite(chunk, encoding, (err?: Error | null) => {
            if (err && ((err as any).code === 'EPIPE' || (err as any).errno === -32)) {
              return; // Ignore EPIPE
            }
            if (callback) callback(err);
          });
        }
        return false;
      } catch (error: any) {
        if (error?.code === 'EPIPE' || error?.errno === -32) {
          return false;
        }
        throw error;
      }
    };
  }
}

import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './database.js';
import { captureWorkspace } from './capture.js';
import { restoreWorkspace, restoreAsset } from './restore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let powerStatus: 'ac' | 'battery' | 'unknown' = 'unknown';

function getCurrentPowerStatus(): 'ac' | 'battery' | 'unknown' {
  try {
    return powerMonitor.isOnBatteryPower() ? 'battery' : 'ac';
  } catch {
    return 'unknown';
  }
}

function broadcastPowerStatus(status: 'ac' | 'battery' | 'unknown') {
  powerStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('power-status-changed', status);
  }
}

function initializePowerMonitor() {
  powerStatus = getCurrentPowerStatus();
  broadcastPowerStatus(powerStatus);
  powerMonitor.on('on-battery', () => broadcastPowerStatus('battery'));
  powerMonitor.on('on-ac', () => broadcastPowerStatus('ac'));
}

// Safe logging functions that catch EPIPE errors (broken pipe when stdout/stderr are closed)
// EPIPE errors occur when writing to closed stdout/stderr streams in Electron
// We wrap the underlying stream writes to catch EPIPE errors
function safeLog(...args: any[]): void {
  try {
    // Use a custom format that goes through our safe path
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ') + '\n';
    
    // Write directly to stdout if it exists and is writable
    if (process.stdout && typeof process.stdout.write === 'function') {
      try {
        if (process.stdout.writable && !process.stdout.destroyed) {
          process.stdout.write(message, (err) => {
            // Ignore EPIPE errors in the callback
            if (err && (err as any).code !== 'EPIPE' && (err as any).errno !== -32) {
              // Only log if it's not a pipe error
            }
          });
        }
      } catch (error: any) {
        // Ignore EPIPE errors
        if (error?.code !== 'EPIPE' && error?.errno !== -32) {
          // Suppress other errors too to prevent crashes
        }
      }
    }
  } catch (error: any) {
    // Suppress all errors to prevent crashes
    // EPIPE is harmless and expected when streams are closed
  }
}

function safeError(...args: any[]): void {
  try {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ') + '\n';
    
    // Write directly to stderr if it exists and is writable
    if (process.stderr && typeof process.stderr.write === 'function') {
      try {
        if (process.stderr.writable && !process.stderr.destroyed) {
          process.stderr.write(message, (err) => {
            // Ignore EPIPE errors in the callback
            if (err && (err as any).code !== 'EPIPE' && (err as any).errno !== -32) {
              // Suppress
            }
          });
        }
      } catch (error: any) {
        // Ignore EPIPE errors
        if (error?.code !== 'EPIPE' && error?.errno !== -32) {
          // Suppress
        }
      }
    }
  } catch (error: any) {
    // Suppress all errors to prevent crashes
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#1A1A1D',
    webPreferences: {
      preload: path.join(__dirname, 'preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false, // Don't show until ready
  });

  // Load the app
  // In development, load from Vite dev server
  const isDev = !app.isPackaged;

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  // Helper to send logs to renderer for debugging
  function logToRenderer(...args: any[]) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('main-process-log', args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '));
    }
  }
  
  // Make logToRenderer available globally for other modules
  (global as any).logToRenderer = logToRenderer;

  // Broadcast current power status to renderer whenever window is ready
  if (powerStatus !== 'unknown') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('power-status-changed', powerStatus);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    safeError('Failed to load page:', errorCode, errorDescription);
    if (mainWindow) {
      mainWindow.show(); // Show window even if load failed
      // Retry loading after a short delay if Vite server might be starting
      if (isDev && errorCode === -105 || errorCode === -106) {
        setTimeout(() => {
          if (mainWindow) {
            safeLog('Retrying to load Vite dev server...');
            mainWindow.loadURL('http://localhost:5173').catch((err) => {
              safeError('Retry failed:', err);
            });
          }
        }, 2000);
      }
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch((err) => {
      safeError('Failed to load Vite dev server:', err);
      if (mainWindow) {
        mainWindow.show();
      }
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch((err) => {
      safeError('Failed to load HTML file:', err);
      if (mainWindow) {
        mainWindow.show();
      }
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    // Initialize database
    safeLog('[Main] Initializing database...');
    await initDatabase();
    safeLog('[Main] Database initialized successfully');

    createWindow();
    initializePowerMonitor();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack trace';
    safeError('Failed to initialize app:', errorMessage);
    safeError('Error stack:', errorStack);
    // Try to create window anyway so user can see the error
    try {
      createWindow();
    } catch (windowError) {
      safeError('Failed to create window:', windowError);
    }
  }
});

// Handle warnings properly - write to a safe location instead of closed stderr
process.on('warning', (warning) => {
  // Write warnings safely without causing EPIPE errors
  safeError('[Warning]', warning.name, warning.message);
  if (warning.stack) {
    safeError('[Warning Stack]', warning.stack);
  }
});

// Handle uncaught errors globally
process.on('uncaughtException', (error) => {
  // Silently handle EPIPE errors
  if (error.message?.includes('EPIPE') || (error as any).code === 'EPIPE' || (error as any).errno === -32) {
    return; // Ignore EPIPE errors
  }
  safeError('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  safeError('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle(
  'capture-workspace',
  async (_, payload?: { name?: string; userId?: number }) => {
  try {
      const { name, userId } = payload || {};
      if (typeof userId !== 'number') {
        return { success: false, error: 'userId is required' };
      }

      safeLog('[Main] Starting workspace capture...');
      const capture = await captureWorkspace(name, userId);
    safeLog('[Main] Capture successful:', capture);

    // Verify capture actually has assets
    const { prepare } = await import('./database.js');
      const assetCount = prepare('SELECT COUNT(*) as count FROM assets WHERE capture_id = ?').get(
        capture.id
      );
      safeLog(
        `[Main] Verification after capture: Found ${assetCount?.count || 0} assets for capture ${capture.id}`
      );

      return { success: true, data: capture };
  } catch (error) {
    safeError('[Main] Failed to capture workspace:', error);
    safeError('[Main] Error details:', (error as Error).message);
    safeError('[Main] Error stack:', (error as Error).stack);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  'restore-workspace',
  async (_, payload?: { captureId: number; userId?: number }) => {
    try {
      const { captureId, userId } = payload || { captureId: undefined };
      if (typeof captureId !== 'number') {
        return { success: false, error: 'captureId is required' };
      }
      if (typeof userId !== 'number') {
        return { success: false, error: 'userId is required' };
      }

      const { prepare } = await import('./database.js');
      const capture = prepare('SELECT user_id FROM captures WHERE id = ?').get(captureId);
      if (!capture) {
        safeError(`[Main IPC] restore-workspace: capture ${captureId} not found`);
        return { success: false, error: 'Capture not found' };
      }

      const ownerId = capture.user_id ?? null;
      if (ownerId && userId !== ownerId) {
        safeError(
          `[Main IPC] restore-workspace denied for user ${userId} on capture ${captureId} owned by ${ownerId}`
        );
        return { success: false, error: 'Not authorized to restore this capture' };
      }

      await restoreWorkspace(captureId);
      return { success: true };
    } catch (error) {
      safeError('Failed to restore workspace:', error);
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle(
  'restore-asset',
  async (_, payload?: { assetId: number; userId?: number }) => {
    try {
      const { assetId, userId } = payload || { assetId: undefined };
      if (typeof assetId !== 'number') {
        return { success: false, error: 'assetId is required' };
      }
      if (typeof userId !== 'number') {
        return { success: false, error: 'userId is required' };
      }

      const { prepare } = await import('./database.js');
      const assetRecord = prepare(
        `
        SELECT assets.id, assets.capture_id, captures.user_id
        FROM assets
        LEFT JOIN captures ON captures.id = assets.capture_id
        WHERE assets.id = ?
        `
      ).get(assetId);

      if (!assetRecord) {
        safeError(`[Main IPC] restore-asset: asset ${assetId} not found`);
        return { success: false, error: 'Asset not found' };
      }

      const ownerId = assetRecord.user_id ?? null;
      if (ownerId && userId !== ownerId) {
        safeError(
          `[Main IPC] restore-asset denied for user ${userId} on asset ${assetId} owned by ${ownerId}`
        );
        return { success: false, error: 'Not authorized to restore this asset' };
      }

      safeLog('[Main IPC] restore-asset called for assetId:', assetId);
      await restoreAsset(assetId);
      safeLog('[Main IPC] restore-asset completed successfully');
      return { success: true };
    } catch (error) {
      safeError('[Main IPC] Failed to restore asset:', error);
      safeError('[Main IPC] Error message:', (error as Error).message);
      safeError('[Main IPC] Error stack:', (error as Error).stack);
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle('get-power-status', () => powerStatus);

ipcMain.handle('get-captures', async (_, userId?: number) => {
  try {
    if (typeof userId !== 'number') {
      return { success: false, error: 'userId is required' };
    }
    safeLog('Getting captures from database...');
    const { prepare } = await import('./database.js');
    const captures = prepare(
      'SELECT * FROM captures WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC'
    ).all(userId);

    safeLog(`Found ${captures.length} captures`);
    return { success: true, data: captures };
  } catch (error) {
    safeError('Failed to get captures:', error);
    safeError('Error stack:', (error as Error).stack);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  'get-capture-details',
  async (_, payload?: { captureId: number; userId?: number }) => {
  try {
      const { captureId, userId } = payload || { captureId: undefined };
      if (typeof captureId !== 'number') {
        return { success: false, error: 'captureId is required' };
      }
      if (typeof userId !== 'number') {
        return { success: false, error: 'userId is required' };
      }
      const { prepare } = await import('./database.js');
      const capture = prepare(
        'SELECT * FROM captures WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
      ).get(captureId, userId);

    if (!capture) {
        safeError(`Capture ${captureId} not found or not accessible for user ${userId}`);
        return { success: false, error: 'Capture not found' };
    }
    
    // Try multiple query approaches to ensure we get data
    let assets: any[] = [];
    
    // First try with parameterized query
      try {
        assets = prepare('SELECT * FROM assets WHERE capture_id = ?').all(captureId);
      safeLog(`Retrieved ${assets.length} assets for capture ${captureId} (parameterized query)`);
    } catch (error) {
      safeError('Parameterized query failed, trying direct query:', error);
    }
    
    // If that returned 0, try direct query without parameters
    if (assets.length === 0) {
      try {
        const directQuery = `SELECT * FROM assets WHERE capture_id = ${captureId}`;
        safeLog(`Trying direct query: ${directQuery}`);
        const { getDatabase } = await import('./database.js');
        const db = getDatabase();
        const result = db.exec(directQuery);
        if (result.length > 0 && result[0].values) {
          const columns = result[0].columns;
          assets = result[0].values.map((row: any[]) => {
            const obj: any = {};
            columns.forEach((col: string, idx: number) => {
              obj[col] = row[idx];
            });
            return obj;
          });
          safeLog(`Retrieved ${assets.length} assets for capture ${captureId} (direct query)`);
        }
      } catch (directError) {
        safeError('Direct query also failed:', directError);
      }
    }
    
    // Debug: Log first few asset IDs if any exist
    if (assets.length > 0) {
      safeLog(`First 5 asset IDs:`, assets.slice(0, 5).map((a: any) => ({ id: a.id, type: a.asset_type, title: a.title })));
    } else {
      // Try a count query to verify assets exist at all
      try {
        const countQuery = `SELECT COUNT(*) as count FROM assets WHERE capture_id = ${captureId}`;
        const { getDatabase } = await import('./database.js');
        const db = getDatabase();
        const result = db.exec(countQuery);
        if (result.length > 0 && result[0].values && result[0].values[0]) {
          const count = result[0].values[0][0];
          safeLog(`Direct count check for capture ${captureId}: ${count} assets exist in database`);
        }
      } catch (countError) {
        safeError('Count query failed:', countError);
      }
    }
    
    // Validate metadata is valid JSON (fix any corrupted entries)
    const validAssets = assets.map((asset: any) => {
      if (asset.metadata) {
        try {
          // Try to parse to validate it's valid JSON
          JSON.parse(asset.metadata);
        } catch (error) {
          safeError(`Invalid metadata for asset ${asset.id}, fixing...`);
          // If metadata is invalid, replace with minimal valid metadata
          asset.metadata = JSON.stringify({
            asset_type: asset.asset_type,
            note: 'Metadata was corrupted and has been reset',
          });
        }
      }
      // Ensure all required fields are present
      if (!asset.title) {
        safeError(`Asset ${asset.id} missing title, setting default`);
        asset.title = `Untitled ${asset.asset_type || 'asset'}`;
      }
      if (!asset.asset_type) {
        safeError(`Asset ${asset.id} missing asset_type`);
        asset.asset_type = 'other';
      }
      return asset;
    });
    
    // Log sample asset for debugging
    if (validAssets.length > 0) {
      const sample = validAssets[0];
      safeLog(`Sample asset:`, {
        id: sample.id,
        asset_type: sample.asset_type,
        title: sample.title,
        hasContent: !!sample.content,
        hasMetadata: !!sample.metadata,
        contentLength: sample.content?.length || 0,
      });
    }
    
      return { success: true, data: { capture, assets: validAssets } };
  } catch (error) {
    safeError('Failed to get capture details:', error);
    safeError('Error stack:', (error as Error).stack);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  'delete-capture',
  async (_, payload?: { captureId: number; userId?: number }) => {
  try {
      const { captureId, userId } = payload || { captureId: undefined };
      if (typeof captureId !== 'number') {
        return { success: false, error: 'captureId is required' };
      }
      if (typeof userId !== 'number') {
        return { success: false, error: 'userId is required' };
      }
      const { prepare, saveDatabase } = await import('./database.js');

      const capture = prepare(
        'SELECT id FROM captures WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
      ).get(captureId, userId);
      if (!capture) {
        return { success: false, error: 'Capture not found or not authorized' };
      }

      prepare('DELETE FROM assets WHERE capture_id = ?').run(captureId);
      prepare('DELETE FROM captures WHERE id = ?').run(captureId);
      saveDatabase();
      return { success: true };
  } catch (error) {
    safeError('Failed to delete capture:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('get-settings', async (_, userId?: number) => {
  try {
    if (typeof userId !== 'number') {
      return { success: false, error: 'userId is required' };
    }
    const { prepare } = await import('./database.js');
    const userSettings = prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
    const globalSettings = prepare('SELECT key, value FROM settings WHERE user_id = 0').all();

    // Convert array of {key, value} to object - global defaults first, then user overrides
    const settingsObj: Record<string, any> = {};
    const applySetting = (setting: any) => {
      try {
        settingsObj[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsObj[setting.key] = setting.value;
      }
    };
    globalSettings.forEach(applySetting);
    userSettings.forEach(applySetting);

    return { success: true, data: settingsObj };
  } catch (error) {
    safeError('Failed to get settings:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  'save-settings',
  async (_, payload?: { settings: Record<string, any>; userId?: number }) => {
  try {
      const { settings, userId } = payload || {};
      if (!settings) {
        return { success: false, error: 'No settings provided' };
      }
      if (typeof userId !== 'number') {
        return { success: false, error: 'userId is required' };
      }

      const { prepare, saveDatabase } = await import('./database.js');

      for (const [key, value] of Object.entries(settings)) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        prepare('INSERT OR REPLACE INTO settings (key, value, user_id) VALUES (?, ?, ?)').run(
          key,
          valueStr,
          userId
        );
      }

      saveDatabase();
      return { success: true };
  } catch (error) {
    safeError('Failed to save settings:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('launch-browser-with-debugging', async (_, browserName: string) => {
  try {
    safeLog(`[Main IPC] Launching ${browserName} with remote debugging...`);
    const { launchBrowserWithDebugging } = await import('./browser-integration.js');
    const result = await launchBrowserWithDebugging(browserName);
    return result;
  } catch (error) {
    safeError(`[Main IPC] Failed to launch ${browserName}:`, error);
    return { success: false, error: (error as Error).message };
  }
});

// Auth IPC Handlers
ipcMain.handle('auth-signup', async (_, email: string, password: string, username?: string) => {
  try {
    safeLog('[Main IPC] Signup request for:', email);
    const { createUser } = await import('./auth.js');
    const result = await createUser(email, password, username);
    return result;
  } catch (error) {
    safeError('[Main IPC] Signup error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('auth-login', async (_, email: string, password: string) => {
  try {
    safeLog('[Main IPC] Login request for:', email);
    const { loginUser } = await import('./auth.js');
    const result = await loginUser(email, password);
    return result;
  } catch (error) {
    safeError('[Main IPC] Login error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('auth-verify-session', async (_, sessionToken: string) => {
  try {
    const { verifySession } = await import('./auth.js');
    const result = await verifySession(sessionToken);
    return result;
  } catch (error) {
    safeError('[Main IPC] Session verification error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('auth-logout', async (_, sessionToken: string) => {
  try {
    safeLog('[Main IPC] Logout request');
    const { logoutUser } = await import('./auth.js');
    const result = await logoutUser(sessionToken);
    return result;
  } catch (error) {
    safeError('[Main IPC] Logout error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('auth-complete-onboarding', async (_, userId: number) => {
  try {
    safeLog(`[Main IPC] Complete onboarding for user ${userId}`);
    const { completeOnboarding } = await import('./auth.js');
    const result = await completeOnboarding(userId);
    return result;
  } catch (error) {
    safeError('[Main IPC] Complete onboarding error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('auth-delete-user', async (_, email: string) => {
  try {
    safeLog(`[Main IPC] Delete user request for: ${email}`);
    const { deleteUser } = await import('./auth.js');
    const result = await deleteUser(email);
    return result;
  } catch (error) {
    safeError('[Main IPC] Delete user error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('auth-complete-feature-tour', async (_, userId: number) => {
  try {
    safeLog(`[Main IPC] Complete feature tour for user ${userId}`);
    const { completeFeatureTour } = await import('./auth.js');
    const result = await completeFeatureTour(userId);
    return result;
  } catch (error) {
    safeError('[Main IPC] Complete feature tour error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('create-demo-capture', async (_, userId?: number) => {
  try {
    if (typeof userId !== 'number') {
      return { success: false, error: 'userId is required' };
    }
    safeLog(`[Main IPC] Creating demo capture for user ${userId}`);
    const { createDemoCapture } = await import('./capture.js');
    const capture = await createDemoCapture(userId);
    return { success: true, data: capture };
  } catch (error) {
    safeError('[Main IPC] Create demo capture error:', error);
    return { success: false, error: (error as Error).message };
  }
});
