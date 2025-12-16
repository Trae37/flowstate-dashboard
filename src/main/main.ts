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

import { app, BrowserWindow, ipcMain, powerMonitor, dialog } from 'electron';
import autoUpdater from 'electron-updater';
import * as Sentry from '@sentry/electron/main';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './database.js';
import { captureWorkspace } from './capture.js';
import { restoreWorkspace, restoreAsset } from './restore.js';

// Extract autoUpdater from the default export
const { autoUpdater: updater } = autoUpdater;

// Initialize Sentry for crash reporting
// Only in production mode to avoid noise during development
if (app.isPackaged) {
  Sentry.init({
    dsn: 'https://d0e9ee43d42f56509f21f1feea1eaa16@o4510468375773184.ingest.us.sentry.io/4510468384751617',
    environment: 'production',
    // Privacy-first: Filter out sensitive data before sending
    beforeSend(event) {
      // Remove file paths from error messages
      if (event.exception) {
        event.exception.values?.forEach(value => {
          if (value.value) {
            // Replace Windows paths: C:\Users\... -> [PATH]
            value.value = value.value.replace(/[A-Z]:\\[^\s]+/g, '[PATH]');
            // Replace Unix paths: /home/user/... -> [PATH]
            value.value = value.value.replace(/\/[^\s]+/g, '[PATH]');
          }
          // Remove file paths from stack traces
          if (value.stacktrace?.frames) {
            value.stacktrace.frames.forEach(frame => {
              if (frame.filename) {
                frame.filename = frame.filename.replace(/[A-Z]:\\[^\s]+/g, '[PATH]');
                frame.filename = frame.filename.replace(/\/[^\s]+/g, '[PATH]');
              }
            });
          }
        });
      }
      // Remove sensitive breadcrumbs (user actions with file paths)
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.filter(breadcrumb => {
          // Keep only error and navigation breadcrumbs
          return breadcrumb.category === 'error' || breadcrumb.category === 'navigation';
        });
      }
      return event;
    },
  });
  console.log('[Sentry] Initialized for production error tracking');
}

// In production (asar), we need to use app.getAppPath() for correct paths
// In development, we can use import.meta.url
const __filename = app.isPackaged
  ? path.join(app.getAppPath(), 'dist', 'main', 'main.js')
  : fileURLToPath(import.meta.url);
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

/**
 * Security: Safely load localhost URLs in development mode only
 * Validates that the URL is actually localhost to prevent loading external resources
 * Note: HTTP is acceptable for localhost in development as traffic never leaves the machine
 */
function safeLoadLocalhost(window: BrowserWindow, url: string): Promise<void> {
  try {
    const parsedUrl = new URL(url);
    // Validate this is actually localhost/127.0.0.1
    if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
      throw new Error(`Security: Attempted to load non-localhost URL: ${url}`);
    }
    // Validate protocol is http (https would require certs for localhost)
    if (parsedUrl.protocol !== 'http:') {
      throw new Error(`Security: Invalid protocol for localhost: ${parsedUrl.protocol}`);
    }
    return window.loadURL(url);
  } catch (error) {
    safeError('[Security] Failed to validate or load localhost URL:', error);
    throw error;
  }
}

/**
 * Set up background task to automatically capture when a new day session is created
 * This ensures new sessions created at midnight get automatically populated
 */
async function setupNewDayAutoCapture() {
  // Track which sessions we've already attempted to auto-capture to avoid duplicates
  const autoCapturedSessions = new Set<number>();
  
  // Check every 5 minutes if we need to capture for a new day session
  setInterval(async () => {
    try {
      const { prepare, getAllSettings } = await import('./database.js');
      const { getCurrentWorkSession } = await import('./session-management.js');
      const { captureWorkspace } = await import('./capture.js');
      
      // Get all active users
      const users = prepare('SELECT id FROM users').all() as { id: number }[];
      
      for (const user of users) {
        const userId = user.id;
        
        // Get user settings to check if auto-save is enabled
        const userSettings = getAllSettings(userId);
        const autoSaveEnabled = userSettings.autoSaveEnabled === 'true';
        
        // Only auto-capture if user has auto-save enabled
        if (!autoSaveEnabled) {
          continue;
        }
        
        // Get current session (will create new one if it's a new day)
        const currentSession = getCurrentWorkSession(userId);
        
        // Skip if we've already auto-captured this session
        if (autoCapturedSessions.has(currentSession.id)) {
          continue;
        }
        
        // Check if this session was created today and has no captures
        const userTimezone = userSettings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date();
        const todayInUserTz = new Intl.DateTimeFormat('en-CA', {
          timeZone: userTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(now);
        
        // Parse session created_at date
        const sessionCreatedAt = currentSession.created_at;
        let sessionDate: Date;
        if (sessionCreatedAt.includes('Z') || sessionCreatedAt.match(/[+-]\d{2}:?\d{2}$/)) {
          sessionDate = new Date(sessionCreatedAt);
        } else {
          const utcString = sessionCreatedAt.replace(' ', 'T') + 'Z';
          sessionDate = new Date(utcString);
        }
        
        const sessionDateInUserTz = new Intl.DateTimeFormat('en-CA', {
          timeZone: userTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(sessionDate);
        
        // Check if session is from today and has no captures
        if (sessionDateInUserTz === todayInUserTz) {
          const captureCount = prepare(`
            SELECT COUNT(*) as count 
            FROM captures 
            WHERE session_id = ? AND archived = 0
          `).get(currentSession.id) as { count: number } | null;
          
          if (captureCount && captureCount.count === 0) {
            // New day session with no captures - trigger automatic capture
            safeLog(`[Main] New day session ${currentSession.id} detected with no captures, triggering automatic capture...`);
            autoCapturedSessions.add(currentSession.id);
            
            try {
              await captureWorkspace(undefined, userId, currentSession.id);
              safeLog(`[Main] Automatic capture completed for new day session ${currentSession.id}`);
            } catch (error) {
              safeError(`[Main] Failed to automatically capture for new day session:`, error);
              // Remove from set so we can retry later
              autoCapturedSessions.delete(currentSession.id);
            }
          }
        }
      }
    } catch (error) {
      // Don't let background task errors crash the app
      safeError('[Main] Error in new day auto-capture check:', error);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}


// Safe logging functions that catch EPIPE errors (broken pipe when stdout/stderr are closed)
// EPIPE errors occur when writing to closed stdout/stderr streams in Electron
// We wrap the underlying stream writes to catch EPIPE errors
function safeLog(...args: any[]): void {
  // Silence debug logs in production builds
  if (app.isPackaged) {
    return;
  }

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

/**
 * Wait for Vite dev server to be ready
 */
async function waitForViteServer(maxAttempts: number = 10, delayMs: number = 1000): Promise<number> {
  const http = await import('http');
  const ports = [5173, 5174, 5175, 5176, 5177]; // Try common Vite ports
  
  // Show a message in the loading page after 3 seconds if Vite isn't found
  let messageShown = false;
  const messageTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        const p = document.querySelector('p');
        if (p) {
          p.textContent = 'Waiting for Vite dev server to start...';
          p.style.color = '#ffa500';
        }
      `).catch(() => {});
      messageShown = true;
    }
  }, 3000);
  
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      for (const port of ports) {
        try {
          await new Promise<void>((resolve, reject) => {
            const req = http.get(`http://localhost:${port}`, (res) => {
              res.on('data', () => {});
              res.on('end', () => {
                resolve();
              });
            });
            req.on('error', (err) => {
              reject(err);
            });
            req.setTimeout(2000, () => {
              req.destroy();
              reject(new Error('Request timeout'));
            });
          });
          clearTimeout(messageTimeout);
          safeLog(`[Main] Vite server is ready on port ${port} (attempt ${attempt}/${maxAttempts})`);
          return port; // Success! Return the port number
        } catch (error) {
          // Try next port
          continue;
        }
      }
      
      if (attempt < maxAttempts) {
        if (attempt % 5 === 0 || attempt <= 3) {
          safeLog(`[Main] Waiting for Vite server... (attempt ${attempt}/${maxAttempts})`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        clearTimeout(messageTimeout);
        throw new Error(`Vite server not available on any port after ${maxAttempts} attempts`);
      }
    }
    clearTimeout(messageTimeout);
    throw new Error('Vite server not found');
  } catch (error) {
    clearTimeout(messageTimeout);
    throw error;
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

/**
 * Configure and check for app updates using electron-updater
 * Only checks for updates in production builds
 */
function setupAutoUpdater() {
  // Only enable auto-updater in production
  if (!app.isPackaged) {
    safeLog('[AutoUpdater] Skipping in development mode');
    return;
  }

  // Configure auto-updater
  updater.autoDownload = false; // Don't auto-download, let user choose
  updater.autoInstallOnAppQuit = true; // Auto-install when app quits

  // Log updater events
  updater.on('checking-for-update', () => {
    safeLog('[AutoUpdater] Checking for updates...');
  });

  updater.on('update-available', (info) => {
    safeLog('[AutoUpdater] Update available:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    }
  });

  updater.on('update-not-available', () => {
    safeLog('[AutoUpdater] No updates available');
  });

  updater.on('error', (error) => {
    safeError('[AutoUpdater] Error:', error);
  });

  updater.on('download-progress', (progressObj) => {
    safeLog(`[AutoUpdater] Download progress: ${progressObj.percent.toFixed(2)}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    }
  });

  updater.on('update-downloaded', (info) => {
    safeLog('[AutoUpdater] Update downloaded:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version,
      });
    }
  });

  // Check for updates on app start (after a short delay)
  setTimeout(() => {
    updater.checkForUpdates().catch((error) => {
      safeError('[AutoUpdater] Failed to check for updates:', error);
    });
  }, 3000); // Wait 3 seconds after app start
}

function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#1A1A1D',
    frame: false, // Remove default title bar
    titleBarStyle: 'hidden', // Hide title bar while keeping window controls on macOS
    webPreferences: {
      preload: path.join(__dirname, 'preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // Security: Enable sandbox for renderer process
      webSecurity: !isDev, // Only disable in development for localhost
      allowRunningInsecureContent: false,
    },
    show: false, // Don't show immediately - wait for ready-to-show event to avoid crashes
  });

  // Security: Set strict CSP headers based on environment
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? // Development: Allow unsafe-inline, unsafe-eval, and unsafe-hashes for Vite HMR
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " + // Required for Vite HMR
        "style-src 'self' 'unsafe-inline' 'unsafe-hashes' https://fonts.googleapis.com; " + // unsafe-hashes for event handler styles
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com ws://localhost:* http://localhost:* https://o4510468375773184.ingest.us.sentry.io; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';"
      : // Production: Strict CSP (but allow inline styles for Vite-generated assets)
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " + // Allow inline styles for Vite
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self' https://o4510468375773184.ingest.us.sentry.io; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';";

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });

  // Don't force window visible immediately - let ready-to-show event handle it
  safeLog('[Main] Window created, waiting for ready-to-show event');

  // Security: Limit navigation to prevent opening untrusted URLs
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowedHosts = ['localhost', '127.0.0.1'];

    // Allow navigation to localhost in dev mode only
    if (isDev && allowedHosts.includes(parsedUrl.hostname)) {
      return; // Allow navigation
    }

    // Block all other navigation attempts
    event.preventDefault();
    safeLog(`[Security] Blocked navigation to: ${navigationUrl}`);
  });

  // Security: Control new window creation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);
    const allowedHosts = ['localhost', '127.0.0.1'];

    // In dev mode, allow localhost windows
    if (isDev && allowedHosts.includes(parsedUrl.hostname)) {
      return { action: 'allow' };
    }

    // Block all new window attempts - use shell.openExternal for external URLs instead
    safeLog(`[Security] Blocked new window for: ${url}`);
    return { action: 'deny' };
  });

  // Security: Set permission request handler to control dangerous permissions
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write'];

    if (allowedPermissions.includes(permission)) {
      callback(true); // Allow safe permissions
    } else {
      safeLog(`[Security] Denied permission request: ${permission}`);
      callback(false); // Deny all other permissions (camera, microphone, geolocation, etc.)
    }
  });

  // Security: Handle frame navigation (including middle-click/auxclick events)
  // This prevents middle-click from navigating frames to untrusted origins
  mainWindow.webContents.on('did-frame-navigate', (event, url, httpResponseCode, httpStatusText, isMainFrame) => {
    // Only check non-main-frame navigations (iframes, etc.)
    if (!isMainFrame) {
      try {
        const parsedUrl = new URL(url);
        const allowedHosts = ['localhost', '127.0.0.1'];

        // In dev mode, allow localhost frame navigation
        if (isDev && allowedHosts.includes(parsedUrl.hostname)) {
          return; // Allow
        }

        // Log suspicious frame navigation (we can't prevent it after it happened, but we can detect it)
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          safeLog(`[Security] Frame navigated to external URL: ${url}`);
        }
      } catch (error) {
        safeLog(`[Security] Invalid URL in frame navigation: ${url}`);
      }
    }
  });

  // Load the app
  // In development, load from Vite dev server

  // Ensure window is always visible
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      safeLog('[Main] Window shown after ready-to-show event');
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
  
  // Helper to send restore progress updates
  function sendRestoreProgress(message: string) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('restore-progress', message);
    }
  }
  
  // Make sendRestoreProgress available globally
  (global as any).sendRestoreProgress = sendRestoreProgress;
  
  // Connect the logger to forward logs to renderer when window is ready
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const { logger } = await import('./utils/logger.js');
      logger.setRendererLogger((message: string) => {
        logToRenderer(message);
      });
    } catch (error) {
      // Logger might not be available yet, that's okay
    }
  });

  // Broadcast current power status to renderer whenever window is ready
  if (powerStatus !== 'unknown') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('power-status-changed', powerStatus);
    });
  }

  // Track if we've already handled a load failure to prevent infinite recursion
  let loadFailureHandled = false;

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    safeError('[Main] Failed to load page:', errorCode, errorDescription);

    // Prevent infinite recursion - only handle once
    if (loadFailureHandled) {
      return;
    }
    loadFailureHandled = true;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show(); // Show window even if load failed

      // Show error message in window
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>FlowState - Load Error</title>
          <style>
            body {
              margin: 0;
              padding: 40px;
              font-family: system-ui, -apple-system, sans-serif;
              background: #1A1A1D;
              color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            .error-container {
              max-width: 600px;
              text-align: center;
            }
            h1 { color: #ff6b6b; margin-bottom: 20px; }
            p { line-height: 1.6; margin: 10px 0; }
            code { background: #2d2d3a; padding: 2px 6px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <div class="error-container">
            <h1>Failed to Load Application</h1>
            <p><strong>Error Code:</strong> <code>${errorCode}</code></p>
            <p><strong>Description:</strong> ${errorDescription}</p>
            ${isDev ? '<p>Please ensure the Vite dev server is running on <code>http://localhost:5173</code></p><p>Run <code>npm run dev:vite</code> in a terminal.</p>' : '<p>Please try restarting the application.</p>'}
          </div>
        </body>
        </html>
      `;
      mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).catch(() => {});
      
      // Retry loading after a short delay if Vite server might be starting
      if (isDev && (errorCode === -105 || errorCode === -106)) {
        setTimeout(() => {
          if (mainWindow) {
            safeLog('[Main] Retrying to load Vite dev server...');
            safeLoadLocalhost(mainWindow, 'http://localhost:5173').catch((err) => {
              safeError('[Main] Retry failed:', err);
            });
          }
        }, 2000);
      }
    }
  });

  if (isDev) {
    // Add console logging for debugging
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      safeLog(`[Renderer ${level}]:`, message);
    });
    
    mainWindow.webContents.on('did-finish-load', () => {
      safeLog('[Main] Page finished loading successfully');
      // Ensure window is visible and focused after load
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        mainWindow.focus();
      }
    });
    
    // Add a listener for DOM ready to check if React app loaded
    mainWindow.webContents.once('dom-ready', () => {
      safeLog('[Main] DOM ready');
      // Check if React app loaded by looking for root element content
      mainWindow?.webContents.executeJavaScript(`
        (function() {
          const root = document.getElementById('root');
          if (root && root.children.length === 0) {
            console.warn('[Main] Root element is empty - React app may not have loaded');
          }
        })();
      `).catch(() => {});
    });
    
    // Show loading page first, then try to load Vite server
    const loadingHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>FlowState - Loading</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
          }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #1A1A1D !important;
            color: #ffffff !important;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .loading-container {
            text-align: center;
          }
          .spinner {
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top: 3px solid #ffffff;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          p {
            font-size: 16px;
            color: #ffffff !important;
          }
        </style>
      </head>
      <body>
        <div class="loading-container">
          <div class="spinner"></div>
          <p>Loading FlowState...</p>
        </div>
      </body>
      </html>
    `;
    // Load loading page immediately and ensure window is visible
    safeLog('[Main] Attempting to load loading page...');
    mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`).then(() => {
      safeLog('[Main] Loading page displayed successfully');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        safeLog('[Main] Window shown and focused after loading page');
      }
    }).catch((err) => {
      safeError('[Main] Failed to load loading page:', err);
      // Don't inject error HTML - just show window and let Vite load
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    
    // Wait for Vite dev server to be ready before loading
    if (isDev) {
      waitForViteServer()
        .then((port) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeLog(`[Main] Vite server is ready on port ${port}, loading application...`);
            safeLoadLocalhost(mainWindow, `http://localhost:${port}`).then(() => {
              safeLog('[Main] Successfully loaded Vite dev server');
            }).catch((err) => {
              safeError('[Main] Failed to load Vite dev server:', err);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                const showErrorPage = (message: string) => {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    const errorHtml = `
                      <!DOCTYPE html>
                      <html>
                      <head>
                        <meta charset="UTF-8">
                        <title>FlowState - Dev Server Error</title>
                        <style>
                          * { margin: 0; padding: 0; box-sizing: border-box; }
                          html, body {
                            width: 100%;
                            height: 100%;
                            overflow: auto;
                          }
                          body {
                            font-family: system-ui, -apple-system, sans-serif;
                            background: #1A1A1D;
                            color: #ffffff;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                          }
                          .error-container {
                            text-align: center;
                            max-width: 600px;
                            padding: 40px;
                            background: rgba(255, 255, 255, 0.05);
                            border-radius: 12px;
                            border: 1px solid rgba(255, 255, 255, 0.1);
                          }
                          h1 {
                            color: #ff6b6b;
                            margin-bottom: 20px;
                            font-size: 24px;
                          }
                          p {
                            line-height: 1.6;
                            margin: 10px 0;
                            color: #ffffff;
                          }
                          code {
                            background: rgba(255, 255, 255, 0.1);
                            padding: 2px 6px;
                            border-radius: 4px;
                            font-family: 'Courier New', monospace;
                            color: #ffffff;
                          }
                        </style>
                      </head>
                      <body>
                        <div class="error-container">
                          <h1>Development Server Not Running</h1>
                          <p>${message}</p>
                          <p>Run <code>npm run dev:vite</code> in a terminal, then restart the app.</p>
                          <p style="margin-top: 20px; font-size: 14px; color: rgba(255, 255, 255, 0.7);">Or run <code>npm run dev</code> to start both Electron and Vite together.</p>
                        </div>
                      </body>
                      </html>
                    `;
                    mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).then(() => {
                      safeLog('[Main] Error page displayed');
                      if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                      }
                    }).catch((loadErr) => {
                      safeError('[Main] Failed to load error page:', loadErr);
                      if (mainWindow) {
                        mainWindow.show();
                      }
                    });
                  }
                };
                showErrorPage('Vite dev server is not running on http://localhost:5173');
              }
            });
        }
      })
        .catch((err) => {
        safeError('[Main] Vite server not available after waiting:', err);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          const showErrorPage = (message: string) => {
            safeLog('[Main] Showing error page:', message);
            if (mainWindow && !mainWindow.isDestroyed()) {
              const errorHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <title>FlowState - Dev Server Error</title>
                  <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    html, body {
                      width: 100%;
                      height: 100%;
                      overflow: auto;
                    }
                    body {
                      font-family: system-ui, -apple-system, sans-serif;
                      background: #1A1A1D;
                      color: #ffffff;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      padding: 20px;
                    }
                    .error-container {
                      text-align: center;
                      max-width: 600px;
                      padding: 40px;
                      background: rgba(255, 255, 255, 0.05);
                      border-radius: 12px;
                      border: 1px solid rgba(255, 255, 255, 0.1);
                    }
                    h1 {
                      color: #ff6b6b;
                      margin-bottom: 20px;
                      font-size: 24px;
                    }
                    p {
                      line-height: 1.6;
                      margin: 10px 0;
                      color: #ffffff;
                    }
                    code {
                      background: rgba(255, 255, 255, 0.1);
                      padding: 2px 6px;
                      border-radius: 4px;
                      font-family: 'Courier New', monospace;
                      color: #ffffff;
                    }
                  </style>
                </head>
                <body>
                  <div class="error-container">
                    <h1>Development Server Not Running</h1>
                    <p>${message}</p>
                    <p>Run <code>npm run dev:vite</code> in a terminal, then restart the app.</p>
                    <p style="margin-top: 20px; font-size: 14px; color: rgba(255, 255, 255, 0.7);">Or run <code>npm run dev</code> to start both Electron and Vite together.</p>
                  </div>
                </body>
                </html>
              `;
              mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).then(() => {
                safeLog('[Main] Error page displayed');
                if (mainWindow) {
                  mainWindow.show();
                  mainWindow.focus();
                }
              }).catch((loadErr) => {
                safeError('[Main] Failed to load error page:', loadErr);
                if (mainWindow) {
                  mainWindow.show();
                }
              });
            }
          };
          showErrorPage(`Vite dev server is not running. Please run 'npm run dev' to start both Vite and Electron together. Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }

    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch((err) => {
      safeError('[Main] Failed to load HTML file:', err);
      if (mainWindow) {
        mainWindow.show();
        const errorHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>FlowState - Load Error</title>
            <style>
              body {
                margin: 0;
                padding: 40px;
                font-family: system-ui, -apple-system, sans-serif;
                background: #1A1A1D;
                color: #ffffff;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
              }
              .error-container {
                max-width: 600px;
                text-align: center;
              }
              h1 { color: #ff6b6b; margin-bottom: 20px; }
              p { line-height: 1.6; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="error-container">
              <h1>Failed to Load Application</h1>
              <p>Error: ${err instanceof Error ? err.message : String(err)}</p>
              <p>Please try restarting the application.</p>
            </div>
          </body>
          </html>
        `;
        mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).catch(() => {});
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

    // Check for auto-recovery on app startup
    safeLog('[Main] Checking for auto-recovery...');
    const { checkAutoRecoveryForAllUsers } = await import('./session-management.js');
    checkAutoRecoveryForAllUsers();
    safeLog('[Main] Auto-recovery check completed');

    // Check if migration is needed and run it automatically
    safeLog('[Main] Checking if capture-to-session migration is needed...');
    try {
      const { needsMigration, migrateCapturesToSessions } = await import('./migrations/migrate-captures-to-sessions.js');
      if (needsMigration()) {
        safeLog('[Main] Running capture-to-session migration...');
        const result = migrateCapturesToSessions();
        if (result.success) {
          safeLog(`[Main] Migration complete: ${result.sessionsCreated} sessions created, ${result.capturesMigrated} captures migrated`);
        } else {
          safeError('[Main] Migration failed:', result.error);
        }
      } else {
        safeLog('[Main] No migration needed');
      }
    } catch (migrationError) {
      safeError('[Main] Error checking/running migration:', migrationError);
      // Don't block app startup if migration fails
    }

    createWindow();
    initializePowerMonitor();
    setupAutoUpdater();

    // Set up background task to check for new day sessions and auto-capture
    setupNewDayAutoCapture();

    // TODO: Browser launch interceptor disabled - needs opt-in setting with user consent dialog
    // See TODO.md "Handle cases where browser debugging is disabled" for tracking

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
  async (event, payload?: { name?: string; userId?: number; sessionId?: number }) => {
  try {
      const { validateId, sanitizeString } = await import('./utils/security.js');
      const { ErrorCode } = await import('./utils/errors.js');

      const { name, userId, sessionId } = payload || {};

      // Validate userId
      if (typeof userId !== 'number' || !validateId(userId)) {
        return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
      }

      // Validate and sanitize name if provided
      let sanitizedName: string | undefined = undefined;
      if (name !== undefined) {
        if (typeof name !== 'string') {
          return { success: false, error: 'Invalid name (must be string)', code: ErrorCode.INVALID_INPUT };
        }
        sanitizedName = sanitizeString(name.trim(), 200);
        if (sanitizedName.length === 0) {
          sanitizedName = undefined; // Treat empty as undefined
        }
      }

      // Validate sessionId if provided
      if (sessionId !== undefined && (typeof sessionId !== 'number' || !validateId(sessionId))) {
        return { success: false, error: 'Invalid sessionId', code: ErrorCode.INVALID_INPUT };
      }

      // Get the current session for today (will create a new one if it's a new day)
      // This ensures captures always go to today's session when the clock hits midnight
      const { getCurrentWorkSession } = await import('./session-management.js');
      const currentSession = getCurrentWorkSession(userId);
      const wasNewDaySession = (currentSession as any).wasNewDaySession === true;
      
      // Use the current session (for today) unless a specific sessionId was explicitly provided
      // If sessionId was provided, validate it's still valid for today, otherwise use current session
      let finalSessionId = sessionId;
      if (sessionId === undefined || sessionId === null) {
        // No sessionId provided, use the current session for today
        finalSessionId = currentSession.id;
        safeLog(`[Main] No sessionId provided, using current session for today: ${finalSessionId}`);
      } else {
        // SessionId was provided, but verify it's still valid (from today)
        // If the provided session is from a previous day, use today's session instead
        if (sessionId !== currentSession.id) {
          safeLog(`[Main] Provided sessionId ${sessionId} is from a previous day, using today's session: ${currentSession.id}`);
          finalSessionId = currentSession.id;
        } else {
          finalSessionId = sessionId;
        }
      }

      safeLog(`[Main] Starting workspace capture... (sessionId: ${finalSessionId}${wasNewDaySession ? ', new day session' : ''})`);

      // Create progress callback that sends updates to the renderer
      const progressCallback = (progress: any) => {
        try {
          event.sender.send('capture-progress', progress);
        } catch (error) {
          console.error('[Main] Failed to send progress update:', error);
        }
      };

      const capture = await captureWorkspace(sanitizedName, userId, finalSessionId, progressCallback);
      
      // If this was a new day session and the capture was successful, schedule an automatic capture
      // This ensures the new session gets populated when created at midnight
      if (wasNewDaySession && capture) {
        safeLog(`[Main] New day session created, capture completed. Session ${finalSessionId} now has a capture.`);
      }
      safeLog('[Main] Capture successful:', capture);

      // Verify capture actually has assets
      const { prepare } = await import('./database.js');
      const assetCount = prepare('SELECT COUNT(*) as count FROM assets WHERE capture_id = ?').get(
        capture.id
      ) as { count: number } | null;
      
      const assetCountValue = assetCount?.count || 0;
      safeLog(
        `[Main] Verification after capture: Found ${assetCountValue} assets for capture ${capture.id}`
      );

      if (assetCountValue === 0) {
        safeError('[Main] WARNING: Capture completed but no assets were found in database');
      }

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
      const { validateId } = await import('./utils/security.js');
      const { ErrorCode } = await import('./utils/errors.js');
      
      const { captureId, userId } = payload || { captureId: undefined };
      
      // Validate inputs
      if (typeof captureId !== 'number' || !validateId(captureId)) {
        return { success: false, error: 'Invalid captureId', code: ErrorCode.INVALID_INPUT };
      }
      if (typeof userId !== 'number' || !validateId(userId)) {
        return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
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
      const errorMessage = (error as Error).message;
      safeError('Failed to restore workspace:', error);
      // Check if it was cancelled
      if (errorMessage === 'Restoration cancelled') {
        return { success: false, error: 'Restoration was cancelled', cancelled: true };
      }
      return { success: false, error: errorMessage };
    }
  }
);

ipcMain.handle('cancel-restoration', async () => {
  try {
    const { cancelRestoration } = await import('./restore.js');
    cancelRestoration();
    safeLog('[Main IPC] Restoration cancellation requested');
    return { success: true };
  } catch (error) {
    safeError('[Main IPC] Failed to cancel restoration:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  'restore-asset',
  async (_, payload?: { assetId: number; userId?: number }) => {
    try {
      const { validateId } = await import('./utils/security.js');
      const { ErrorCode } = await import('./utils/errors.js');
      
      const { assetId, userId } = payload || { assetId: undefined };
      
      // Validate inputs
      if (typeof assetId !== 'number' || !validateId(assetId)) {
        return { success: false, error: 'Invalid assetId', code: ErrorCode.INVALID_INPUT };
      }
      if (typeof userId !== 'number' || !validateId(userId)) {
        return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
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

// Window controls for frameless window
ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

// Auto-updater IPC handlers
ipcMain.handle('update-download', async () => {
  try {
    if (!app.isPackaged) {
      return { success: false, error: 'Updates only available in production' };
    }
    await updater.downloadUpdate();
    return { success: true };
  } catch (error: any) {
    safeError('[AutoUpdater] Failed to download update:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-install', () => {
  try {
    if (!app.isPackaged) {
      return { success: false, error: 'Updates only available in production' };
    }
    // This will quit the app and install the update
    updater.quitAndInstall(false, true);
    return { success: true };
  } catch (error: any) {
    safeError('[AutoUpdater] Failed to install update:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-captures', async (_, payload?: { userId: number; sessionId?: number; includeArchived?: boolean }) => {
  try {
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    const userId = typeof payload === 'object' ? payload.userId : payload;
    const sessionId = typeof payload === 'object' ? payload.sessionId : undefined;
    const includeArchived = typeof payload === 'object' ? (payload.includeArchived || false) : false;
    
    // Validate userId
    if (typeof userId !== 'number' || !validateId(userId)) {
      return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate sessionId if provided
    if (sessionId !== undefined && (typeof sessionId !== 'number' || !validateId(sessionId))) {
      return { success: false, error: 'Invalid sessionId', code: ErrorCode.INVALID_INPUT };
    }
    safeLog(`Getting captures from database... (sessionId: ${sessionId || 'all'}, includeArchived: ${includeArchived})`);
    const { prepare } = await import('./database.js');
    
    let query = 'SELECT * FROM captures WHERE (user_id = ? OR user_id IS NULL)';
    let params: (number | boolean)[] = [userId];
    
    if (!includeArchived) {
      query += ' AND archived = 0';
    }
    
    if (sessionId !== undefined) {
      // If sessionId is provided, show captures for that session OR captures with no session_id (legacy captures)
      query += ' AND (session_id = ? OR session_id IS NULL)';
      params.push(sessionId);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const captures = prepare(query).all(...params);

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
    
    // Validate metadata is valid JSON (fix any corrupted entries silently)
    let corruptedCount = 0;
    let missingTitleCount = 0;
    const validAssets = assets.map((asset: any) => {
      if (asset.metadata) {
        try {
          // Try to parse to validate it's valid JSON
          JSON.parse(asset.metadata);
        } catch (error) {
          corruptedCount++;
          // If metadata is invalid, replace with minimal valid metadata
          asset.metadata = JSON.stringify({
            asset_type: asset.asset_type,
            note: 'Metadata was corrupted and has been reset',
          });
        }
      }
      // Ensure all required fields are present
      if (!asset.title) {
        missingTitleCount++;
        asset.title = `Untitled ${asset.asset_type || 'asset'}`;
      }
      if (!asset.asset_type) {
        asset.asset_type = 'other';
      }
      return asset;
    });

    // Log summary of fixes (only if issues were found)
    if (corruptedCount > 0) {
      safeLog(`[Database] Fixed ${corruptedCount} asset(s) with corrupted metadata`);
    }
    if (missingTitleCount > 0) {
      safeLog(`[Database] Fixed ${missingTitleCount} asset(s) with missing titles`);
    }

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
      const { validateId } = await import('./utils/security.js');
      const { ErrorCode } = await import('./utils/errors.js');
      
      const { captureId, userId } = payload || { captureId: undefined };
      
      // Validate inputs
      if (typeof captureId !== 'number' || !validateId(captureId)) {
        return { success: false, error: 'Invalid captureId', code: ErrorCode.INVALID_INPUT };
      }
      if (typeof userId !== 'number' || !validateId(userId)) {
        return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
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
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    if (typeof userId !== 'number' || !validateId(userId)) {
      return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
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
  async (_, payload?: { settings: Record<string, unknown>; userId?: number }) => {
  try {
      const { validateId, sanitizeString } = await import('./utils/security.js');
      const { ErrorCode } = await import('./utils/errors.js');
      
      const { settings, userId } = payload || {};
      if (!settings || typeof settings !== 'object') {
        return { success: false, error: 'Invalid settings (must be object)', code: ErrorCode.INVALID_INPUT };
      }
      if (typeof userId !== 'number' || !validateId(userId)) {
        return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
      }
      
      // Validate and sanitize setting keys and values
      const sanitizedSettings: Record<string, string> = {};
      for (const [key, value] of Object.entries(settings)) {
        // Sanitize key
        const sanitizedKey = sanitizeString(key.trim(), 100);
        if (sanitizedKey.length === 0) {
          continue; // Skip empty keys
        }
        
        // Convert value to string and sanitize
        const valueStr = typeof value === 'string' 
          ? sanitizeString(value, 10000) // Allow longer values for settings
          : JSON.stringify(value);
        
        sanitizedSettings[sanitizedKey] = valueStr;
      }

      const { prepare, saveDatabase } = await import('./database.js');

      // Save sanitized settings
      for (const [key, value] of Object.entries(sanitizedSettings)) {
        prepare('INSERT OR REPLACE INTO settings (key, value, user_id) VALUES (?, ?, ?)').run(
          key,
          value,
          userId
        );
      }

      saveDatabase();
      return { success: true };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('Failed to save settings:', error);
    return handleError(error);
  }
});

ipcMain.handle('launch-browser-with-debugging', async (_, browserName: string) => {
  try {
    const { sanitizeString } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate and sanitize browser name
    if (typeof browserName !== 'string') {
      return { success: false, error: 'Invalid browserName (must be string)', code: ErrorCode.INVALID_INPUT };
    }
    const sanitizedBrowserName = sanitizeString(browserName.trim(), 50);
    if (sanitizedBrowserName.length === 0) {
      return { success: false, error: 'Browser name cannot be empty', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate browser name is from allowed list
    const allowedBrowsers = ['chrome', 'edge', 'firefox', 'brave', 'safari'];
    if (!allowedBrowsers.includes(sanitizedBrowserName.toLowerCase())) {
      return { success: false, error: `Invalid browser name. Allowed: ${allowedBrowsers.join(', ')}`, code: ErrorCode.INVALID_INPUT };
    }
    
    safeLog(`[Main IPC] Launching ${sanitizedBrowserName} with remote debugging...`);
    const { launchBrowserWithDebugging } = await import('./browser-integration.js');
    const result = await launchBrowserWithDebugging(sanitizedBrowserName);
    return result;
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError(`[Main IPC] Failed to launch browser:`, error);
    return handleError(error);
  }
});

ipcMain.handle('get-browsers-without-debugging', async () => {
  try {
    const { detectBrowsersWithoutDebugging } = await import('./browser-integration.js');
    const browsers = await detectBrowsersWithoutDebugging();
    return { success: true, data: browsers };
  } catch (error) {
    safeError('[Main IPC] Failed to detect browsers without debugging:', error);
    return { success: false, error: (error as Error).message, data: [] };
  }
});

ipcMain.handle('prompt-close-and-relaunch-browser', async (_, browserName: string) => {
  try {
    const { sanitizeString } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate and sanitize browser name
    if (typeof browserName !== 'string') {
      return { success: false, error: 'Invalid browserName (must be string)', code: ErrorCode.INVALID_INPUT };
    }
    const sanitizedBrowserName = sanitizeString(browserName.trim(), 50);
    if (sanitizedBrowserName.length === 0) {
      return { success: false, error: 'Browser name cannot be empty', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate browser name is from allowed list
    const allowedBrowsers = ['chrome', 'edge', 'firefox', 'brave', 'safari'];
    if (!allowedBrowsers.includes(sanitizedBrowserName.toLowerCase())) {
      return { success: false, error: `Invalid browser name. Allowed: ${allowedBrowsers.join(', ')}`, code: ErrorCode.INVALID_INPUT };
    }
    
    // Show dialog to prompt user
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available', code: ErrorCode.INVALID_INPUT };
    }
    
    const normalizedName = sanitizedBrowserName.charAt(0).toUpperCase() + sanitizedBrowserName.slice(1).toLowerCase();
    const browserNameMap: Record<string, string> = {
      'Chrome': 'Chrome',
      'Brave': 'Brave',
      'Edge': 'Edge',
      'Msedge': 'Edge',
    };
    const displayName = browserNameMap[normalizedName] || normalizedName;
    
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Yes, Close and Relaunch', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Enable Browser Debugging',
      message: `${displayName} needs to be closed and reopened with debugging enabled`,
      detail: `To capture ${displayName} tabs, FlowState needs to close ${displayName} and reopen it with remote debugging enabled.\n\nThis will close all ${displayName} windows. Any unsaved work in ${displayName} may be lost.\n\nWould you like to proceed?`,
    });
    
    if (response.response === 0) {
      // User clicked "Yes"
      safeLog(`[Main IPC] User confirmed: Closing and relaunching ${displayName} with remote debugging...`);
      const { closeAndRelaunchBrowserWithDebugging } = await import('./browser-integration.js');
      const result = await closeAndRelaunchBrowserWithDebugging(sanitizedBrowserName);
      return result;
    } else {
      // User clicked "Cancel"
      return { success: false, error: 'User cancelled', cancelled: true };
    }
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError(`[Main IPC] Failed to prompt close and relaunch browser:`, error);
    return handleError(error);
  }
});

// Auth IPC Handlers
ipcMain.handle('auth-signup', async (_, email: string, password: string, username?: string) => {
  try {
    const { signupRateLimiter, validateEmail, sanitizeString, validatePassword, validateUsername } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Rate limiting check
    const clientId = email || 'unknown';
    if (!signupRateLimiter.check(clientId)) {
      return { success: false, error: 'Too many signup attempts. Please try again in an hour.', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate inputs
    if (typeof email !== 'string') {
      return { success: false, error: 'Invalid email (must be string)', code: ErrorCode.INVALID_INPUT };
    }
    const sanitizedEmail = sanitizeString(email.toLowerCase().trim(), 254);
    if (!validateEmail(sanitizedEmail)) {
      return { success: false, error: 'Invalid email format', code: ErrorCode.INVALID_INPUT };
    }
    
    if (typeof password !== 'string') {
      return { success: false, error: 'Invalid password (must be string)', code: ErrorCode.INVALID_INPUT };
    }
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error || 'Invalid password', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate username if provided
    let sanitizedUsername: string | undefined = undefined;
    if (username !== undefined) {
      if (typeof username !== 'string') {
        return { success: false, error: 'Invalid username (must be string)', code: ErrorCode.INVALID_INPUT };
      }
      sanitizedUsername = sanitizeString(username.trim(), 30);
      if (sanitizedUsername.length === 0) {
        sanitizedUsername = undefined;
      } else if (!validateUsername(sanitizedUsername)) {
        return { success: false, error: 'Username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens', code: ErrorCode.INVALID_INPUT };
      }
    }

    safeLog('[Main IPC] Signup request for:', sanitizedEmail);
    const { createUser } = await import('./auth.js');
    const result = await createUser(sanitizedEmail, password, sanitizedUsername);
    
    // Reset rate limiter on successful signup
    if (result.success) {
      signupRateLimiter.reset(clientId);
    }
    
    return result;
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Signup error:', error);
    return handleError(error);
  }
});

ipcMain.handle('auth-login', async (_, email: string, password: string) => {
  try {
    const { loginRateLimiter, validateEmail, sanitizeString } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Rate limiting check
    const clientId = email || 'unknown';
    if (!loginRateLimiter.check(clientId)) {
      return { success: false, error: 'Too many login attempts. Please try again in 15 minutes.', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate inputs
    if (typeof email !== 'string') {
      return { success: false, error: 'Invalid email (must be string)', code: ErrorCode.INVALID_INPUT };
    }
    const sanitizedEmail = sanitizeString(email.toLowerCase().trim(), 254);
    if (!validateEmail(sanitizedEmail)) {
      return { success: false, error: 'Invalid email format', code: ErrorCode.INVALID_INPUT };
    }
    
    if (typeof password !== 'string') {
      return { success: false, error: 'Invalid password (must be string)', code: ErrorCode.INVALID_INPUT };
    }
    if (password.length === 0) {
      return { success: false, error: 'Password cannot be empty', code: ErrorCode.INVALID_INPUT };
    }

    safeLog('[Main IPC] Login request for:', sanitizedEmail);
    const { loginUser } = await import('./auth.js');
    const result = await loginUser(sanitizedEmail, password);
    
    // Reset rate limiter on successful login
    if (result.success) {
      loginRateLimiter.reset(clientId);
    }
    
    return result;
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Login error:', error);
    return handleError(error);
  }
});

ipcMain.handle('auth-verify-session', async (_, sessionToken: string) => {
  try {
    const { validateSessionToken } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate session token format
    if (typeof sessionToken !== 'string' || !validateSessionToken(sessionToken)) {
      return { success: false, error: 'Invalid session token format', code: ErrorCode.INVALID_INPUT };
    }
    
    const { verifySession } = await import('./auth.js');
    const result = await verifySession(sessionToken);
    return result;
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Session verification error:', error);
    return handleError(error);
  }
});

ipcMain.handle('auth-logout', async (_, sessionToken: string) => {
  try {
    const { validateSessionToken } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate session token format
    if (typeof sessionToken !== 'string' || !validateSessionToken(sessionToken)) {
      return { success: false, error: 'Invalid session token format', code: ErrorCode.INVALID_INPUT };
    }
    
    safeLog('[Main IPC] Logout request');
    const { logoutUser } = await import('./auth.js');
    const result = await logoutUser(sessionToken);
    return result;
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Logout error:', error);
    return handleError(error);
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
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate userId
    if (typeof userId !== 'number' || !validateId(userId)) {
      return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
    }
    
    safeLog(`[Main IPC] Complete feature tour for user ${userId}`);
    const { completeFeatureTour } = await import('./auth.js');
    const result = await completeFeatureTour(userId);
    return result;
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Complete feature tour error:', error);
    return handleError(error);
  }
});

// Work Session Management IPC Handlers
ipcMain.handle('session-get-current', async (_, userId: number) => {
  try {
    safeLog(`[Main IPC] Get current session for user ${userId}`);
    const { getCurrentWorkSession } = await import('./session-management.js');
    const session = getCurrentWorkSession(userId);
    return { success: true, data: session };
  } catch (error) {
    safeError('[Main IPC] Get current session error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('session-get-all', async (_, userId: number, includeArchived?: boolean) => {
  try {
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate userId
    if (typeof userId !== 'number' || !validateId(userId)) {
      return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate includeArchived is boolean if provided
    if (includeArchived !== undefined && typeof includeArchived !== 'boolean') {
      return { success: false, error: 'Invalid includeArchived (must be boolean)', code: ErrorCode.INVALID_INPUT };
    }
    
    safeLog(`[Main IPC] Get all sessions for user ${userId}, includeArchived: ${includeArchived}`);
    const { getUserWorkSessions } = await import('./session-management.js');
    const sessions = getUserWorkSessions(userId, includeArchived || false);
    return { success: true, data: sessions };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Get all sessions error:', error);
    return handleError(error);
  }
});

ipcMain.handle('session-create', async (_, userId: number, name?: string, description?: string) => {
  try {
    const { validateId, sanitizeString } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate userId
    if (typeof userId !== 'number' || !validateId(userId)) {
      return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate and sanitize name if provided
    let sanitizedName: string | undefined = undefined;
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return { success: false, error: 'Invalid name (must be string)', code: ErrorCode.INVALID_INPUT };
      }
      sanitizedName = sanitizeString(name.trim(), 100);
      if (sanitizedName.length === 0) {
        sanitizedName = undefined;
      }
    }
    
    // Validate and sanitize description if provided
    let sanitizedDescription: string | undefined = undefined;
    if (description !== undefined) {
      if (typeof description !== 'string') {
        return { success: false, error: 'Invalid description (must be string)', code: ErrorCode.INVALID_INPUT };
      }
      sanitizedDescription = sanitizeString(description.trim(), 500);
      if (sanitizedDescription.length === 0) {
        sanitizedDescription = undefined;
      }
    }

    safeLog(`[Main IPC] Create session for user ${userId}, name: ${sanitizedName || 'auto-generated'}`);
    const { createWorkSession } = await import('./session-management.js');
    const session = createWorkSession(userId, sanitizedName, sanitizedDescription);
    return { success: true, data: session };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Create session error:', error);
    return handleError(error);
  }
});

ipcMain.handle('session-update', async (_, sessionId: number, name?: string, description?: string) => {
  try {
    const { validateId, sanitizeString } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate sessionId
    if (typeof sessionId !== 'number' || !validateId(sessionId)) {
      return { success: false, error: 'Invalid sessionId', code: ErrorCode.INVALID_INPUT };
    }
    
    // Validate and sanitize name if provided
    let sanitizedName: string | undefined = undefined;
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return { success: false, error: 'Invalid name (must be string)', code: ErrorCode.INVALID_INPUT };
      }
      sanitizedName = sanitizeString(name.trim(), 100);
      if (sanitizedName.length === 0) {
        sanitizedName = undefined;
      }
    }
    
    // Validate and sanitize description if provided
    let sanitizedDescription: string | undefined = undefined;
    if (description !== undefined) {
      if (typeof description !== 'string') {
        return { success: false, error: 'Invalid description (must be string)', code: ErrorCode.INVALID_INPUT };
      }
      sanitizedDescription = sanitizeString(description.trim(), 500);
      if (sanitizedDescription.length === 0) {
        sanitizedDescription = undefined;
      }
    }
    
    safeLog(`[Main IPC] Update session ${sessionId}, name: ${sanitizedName}`);
    const { updateWorkSession } = await import('./session-management.js');
    const result = updateWorkSession(sessionId, sanitizedName, sanitizedDescription);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Update session error:', error);
    return handleError(error);
  }
});

ipcMain.handle('session-archive', async (_, sessionId: number) => {
  try {
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate sessionId
    if (typeof sessionId !== 'number' || !validateId(sessionId)) {
      return { success: false, error: 'Invalid sessionId', code: ErrorCode.INVALID_INPUT };
    }
    
    safeLog(`[Main IPC] Archive session ${sessionId}`);
    const { archiveWorkSession } = await import('./session-management.js');
    const result = archiveWorkSession(sessionId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Archive session error:', error);
    return handleError(error);
  }
});

ipcMain.handle('session-unarchive', async (_, sessionId: number) => {
  try {
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');

    // Validate sessionId
    if (typeof sessionId !== 'number' || !validateId(sessionId)) {
      return { success: false, error: 'Invalid sessionId', code: ErrorCode.INVALID_INPUT };
    }

    safeLog(`[Main IPC] Unarchive session ${sessionId}`);
    const { unarchiveWorkSession } = await import('./session-management.js');
    const result = unarchiveWorkSession(sessionId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Unarchive session error:', error);
    return handleError(error);
  }
});

ipcMain.handle('session-delete', async (_, sessionId: number) => {
  try {
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate sessionId
    if (typeof sessionId !== 'number' || !validateId(sessionId)) {
      return { success: false, error: 'Invalid sessionId', code: ErrorCode.INVALID_INPUT };
    }
    
    safeLog(`[Main IPC] Delete session ${sessionId}`);
    const { deleteWorkSession } = await import('./session-management.js');
    const result = deleteWorkSession(sessionId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Delete session error:', error);
    return handleError(error);
  }
});

// Archive management IPC handlers
ipcMain.handle('archive-capture', async (_, payload: { captureId: number; userId: number }) => {
  try {
    safeLog(`[Main IPC] Archive capture ${payload.captureId}`);
    const { archiveCapture } = await import('./archive-management.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate inputs
    if (typeof payload.captureId !== 'number' || typeof payload.userId !== 'number') {
      return { success: false, error: 'Invalid captureId or userId', code: ErrorCode.INVALID_INPUT };
    }
    
    const result = archiveCapture(payload.captureId, payload.userId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Archive capture error:', error);
    return handleError(error);
  }
});

ipcMain.handle('unarchive-capture', async (_, payload: { captureId: number; userId: number }) => {
  try {
    safeLog(`[Main IPC] Unarchive capture ${payload.captureId}`);
    const { unarchiveCapture } = await import('./archive-management.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate inputs
    if (typeof payload.captureId !== 'number' || typeof payload.userId !== 'number') {
      return { success: false, error: 'Invalid captureId or userId', code: ErrorCode.INVALID_INPUT };
    }
    
    const result = unarchiveCapture(payload.captureId, payload.userId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Unarchive capture error:', error);
    return handleError(error);
  }
});

ipcMain.handle('archive-asset', async (_, payload: { assetId: number; userId: number }) => {
  try {
    safeLog(`[Main IPC] Archive asset ${payload.assetId}`);
    const { archiveAsset } = await import('./archive-management.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate inputs
    if (typeof payload.assetId !== 'number' || typeof payload.userId !== 'number') {
      return { success: false, error: 'Invalid assetId or userId', code: ErrorCode.INVALID_INPUT };
    }
    
    const result = archiveAsset(payload.assetId, payload.userId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Archive asset error:', error);
    return handleError(error);
  }
});

ipcMain.handle('unarchive-asset', async (_, payload: { assetId: number; userId: number }) => {
  try {
    safeLog(`[Main IPC] Unarchive asset ${payload.assetId}`);
    const { unarchiveAsset } = await import('./archive-management.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate inputs
    if (typeof payload.assetId !== 'number' || typeof payload.userId !== 'number') {
      return { success: false, error: 'Invalid assetId or userId', code: ErrorCode.INVALID_INPUT };
    }
    
    const result = unarchiveAsset(payload.assetId, payload.userId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Unarchive asset error:', error);
    return handleError(error);
  }
});

ipcMain.handle('delete-asset', async (_, payload: { assetId: number; userId: number }) => {
  try {
    safeLog(`[Main IPC] Delete asset ${payload.assetId}`);
    const { deleteAsset } = await import('./archive-management.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    // Validate inputs
    if (typeof payload.assetId !== 'number' || typeof payload.userId !== 'number') {
      return { success: false, error: 'Invalid assetId or userId', code: ErrorCode.INVALID_INPUT };
    }
    
    const result = deleteAsset(payload.assetId, payload.userId);
    return { success: result };
  } catch (error) {
    const { handleError } = await import('./utils/errors.js');
    safeError('[Main IPC] Delete asset error:', error);
    return handleError(error);
  }
});

ipcMain.handle('session-get-auto-recovered', async (_, userId: number) => {
  try {
    safeLog(`[Main IPC] Get auto-recovered sessions for user ${userId}`);
    const { getAutoRecoveredSessions } = await import('./session-management.js');
    const sessions = getAutoRecoveredSessions(userId);
    return { success: true, data: sessions };
  } catch (error) {
    safeError('[Main IPC] Get auto-recovered sessions error:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('create-demo-capture', async (_, userId?: number) => {
  try {
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');
    
    if (typeof userId !== 'number' || !validateId(userId)) {
      return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
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

ipcMain.handle('create-demo-archived-captures', async (_, userId?: number) => {
  try {
    const { validateId } = await import('./utils/security.js');
    const { ErrorCode } = await import('./utils/errors.js');

    if (typeof userId !== 'number' || !validateId(userId)) {
      return { success: false, error: 'Invalid userId', code: ErrorCode.INVALID_INPUT };
    }
    safeLog(`[Main IPC] Creating demo archived captures for user ${userId}`);
    const { createDemoArchivedCaptures } = await import('./capture.js');
    const captures = await createDemoArchivedCaptures(userId);
    return { success: true, data: captures };
  } catch (error) {
    safeError('[Main IPC] Create demo archived captures error:', error);
    return { success: false, error: (error as Error).message };
  }
});
