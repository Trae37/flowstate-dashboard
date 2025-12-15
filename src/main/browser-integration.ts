import CDP from 'chrome-remote-interface';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './utils/logger.js';

const execPromise = promisify(exec);

export interface BrowserTab {
  url: string;
  title: string;
  id: string;
  faviconUrl?: string;
}

export interface BrowserSession {
  browserName: string;
  browserPath: string;
  debuggingPort: number;
  tabs: BrowserTab[];
}

/**
 * Common debugging ports to check for Chrome/Brave/Edge
 * Expanded range to catch more browser instances
 */
const COMMON_DEBUG_PORTS = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230];

/**
 * Find debug ports from running browser processes by checking command line arguments
 */
async function findDebugPortsFromProcesses(): Promise<number[]> {
  const ports: number[] = [];
  
  if (process.platform === 'win32') {
    try {
      // Use wmic to get command line arguments for browser processes
      const browsers = ['chrome.exe', 'brave.exe', 'msedge.exe'];
      
      for (const browser of browsers) {
        try {
          // Get command line for all instances of this browser
          // Using /format:csv for more reliable parsing
          const { stdout } = await execPromise(
            `wmic process where "name='${browser}'" get commandline /format:csv`
          );
          
          // Extract --remote-debugging-port=XXXX from command lines
          // Match case-insensitive and handle various formats
          const portMatches = stdout.match(/--remote-debugging-port[=:](\d+)/gi);
          if (portMatches) {
            for (const match of portMatches) {
              const portStr = match.split(/[=:]/)[1];
              const port = parseInt(portStr, 10);
              if (port && port > 0 && port < 65536 && !ports.includes(port)) {
                ports.push(port);
              }
            }
          }
        } catch (err) {
          // Continue checking other browsers - wmic might fail if browser not running
          continue;
        }
      }
    } catch (err) {
      // wmic might not be available or might fail - this is okay, we'll fall back to common ports
      console.warn('[Browser Capture] Could not extract debug ports from processes (this is okay):', err);
    }
  }
  
  return ports;
}

/**
 * Check if a browser is running with remote debugging enabled on a specific port
 */
async function checkDebugPort(port: number): Promise<boolean> {
  try {
    const targets = await CDP.List({ port });
    return targets.length > 0;
  } catch {
    return false;
  }
}

/**
 * Timeout wrapper for promises - rejects if promise takes longer than specified timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}

/**
 * Get detailed tab information by connecting to the target
 * This provides more accurate URL and title information than CDP.List()
 * Has a 5-second timeout to prevent hanging on problematic tabs
 */
async function getTabDetails(port: number, targetId: string): Promise<{ url: string; title: string } | null> {
  try {
    // Wrap the entire operation in a 5-second timeout
    return await withTimeout(
      (async () => {
        const client = await CDP({ port, target: targetId });

        try {
          // Enable Page domain to get frame information
          await client.Page.enable();

          // Get the main frame URL
          const frameTree = await client.Page.getFrameTree();
          const url = frameTree.frameTree?.frame?.url || '';

          // Try to get the document title
          let title = 'Untitled';
          try {
            // First try to get title from the page
            const titleResult = await client.Runtime.evaluate({
              expression: 'document.title || window.location.href || ""'
            });
            title = titleResult.result?.value || '';

            // If that didn't work, try a different approach
            if (!title || title.trim() === '') {
              const pageTitle = await client.Page.getNavigationHistory().catch(() => null);
              if (pageTitle?.entries && pageTitle.entries.length > 0) {
                title = pageTitle.entries[pageTitle.entries.length - 1].title || '';
              }
            }
          } catch (titleError) {
            // Title fetch failed, we'll use the URL or default
          }

          return {
            url: url || '',
            title: title || 'Untitled'
          };
        } finally {
          // Always close the client connection
          await client.close().catch(() => {});
        }
      })(),
      5000, // 5 second timeout per tab
      `Timeout fetching details for tab ${targetId}`
    );
  } catch (error) {
    // If we can't get details, that's okay - we'll use what we have from List
    // This can happen if the tab is closing, in an invalid state, network issues, or timeout
    return null;
  }
}

/**
 * Get all tabs from a Chrome/Brave browser via CDP
 */
async function getTabsFromPort(port: number, browserName: string): Promise<BrowserSession | null> {
  try {
    const targets = await CDP.List({ port });
    const tabs: BrowserTab[] = [];

    // Helper to log to both console and renderer
    const logCapture = (...args: any[]) => {
      logger.log(...args);
      try {
        const logToRenderer = (global as any).logToRenderer;
        if (logToRenderer) logToRenderer(...args);
      } catch {}
    };

    logCapture(`[Browser Capture] Found ${targets.length} target(s) on port ${port}`);
    logCapture(`[Browser Capture] Target types: ${[...new Set(targets.map(t => t.type))].join(', ')}`);
    
    // Count targets by type
    const targetCounts = new Map<string, number>();
    targets.forEach(t => {
      targetCounts.set(t.type, (targetCounts.get(t.type) || 0) + 1);
    });
    logCapture(`[Browser Capture] Target breakdown: ${Array.from(targetCounts.entries()).map(([type, count]) => `${type}=${count}`).join(', ')}`);
    
    // Log all targets for debugging
    targets.forEach((target, idx) => {
      logCapture(`[Browser Capture]   Target ${idx + 1}: type=${target.type}, url=${target.url || 'no URL'}, title=${target.title || 'no title'}, id=${target.id}`);
    });
    
    // Process all page targets (actual browser tabs)
    // We'll enhance details for all tabs to ensure we get the most up-to-date information
    const pageTargets = targets.filter(t => t.type === 'page');

    logCapture(`[Browser Capture] Processing ${pageTargets.length} page target(s)...`);

    // Skip enhanced details for large tab counts to speed up capture
    const skipEnhancedDetails = pageTargets.length > 50;
    if (skipEnhancedDetails) {
      logCapture(`[Browser Capture] ⚠️  Large number of tabs detected (${pageTargets.length}). Skipping enhanced details for faster capture.`);
    }

    for (let i = 0; i < pageTargets.length; i++) {
      const target = pageTargets[i];
      let url = target.url || '';
      let title = target.title || 'Untitled';

      // Only get enhanced details for small tab counts (faster)
      if (!skipEnhancedDetails) {
        try {
          const details = await getTabDetails(port, target.id);
          if (details) {
            url = details.url || url;
            title = details.title || title;
            if (details.url || details.title) {
              logCapture(`[Browser Capture]   Enhanced tab info: "${title}" (${url || 'loading...'})`);
            }
          }
        } catch (error) {
          logCapture(`[Browser Capture]   Could not enhance tab ${target.id}, using initial values`);
        }

        // Small delay only when fetching enhanced details
        if (i < pageTargets.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }

      // Progress logging for large tab counts
      if (skipEnhancedDetails && (i + 1) % 100 === 0) {
        logCapture(`[Browser Capture] Progress: ${i + 1}/${pageTargets.length} tabs processed...`);
      }
      
      // Normalize empty values
      if (!url) {
        url = 'about:blank'; // New tab or loading tab
      }
      if (!title || title === 'no title' || title.trim() === '') {
        title = 'Untitled Tab';
      }
      
      // Skip only truly internal browser pages (settings, extensions, etc.)
      // But capture everything else, including about:blank (new tabs) and loading tabs
      const isInternalPage = url.startsWith('chrome://') || 
                            url.startsWith('edge://') || 
                            url.startsWith('brave://') ||
                            url.startsWith('chrome-extension://') ||
                            url.startsWith('edge-extension://') ||
                            url.startsWith('brave-extension://') ||
                            url === 'chrome://newtab' ||
                            url === 'edge://newtab' ||
                            url === 'brave://newtab' ||
                            url === 'about:newtab';
      
      if (!isInternalPage) {
        tabs.push({
          url: url,
          title: title,
          id: target.id,
          faviconUrl: (target as any).faviconUrl || undefined,
        });
        logCapture(`[Browser Capture]   ✓ Captured tab: "${title}" (${url})`);
      } else {
        logCapture(`[Browser Capture]   - Skipped internal page: ${url}`);
      }
    }
    
    // Log other target types for debugging (we might want to capture some of these later)
    const otherTargets = targets.filter(t => t.type !== 'page');
    if (otherTargets.length > 0) {
      logCapture(`[Browser Capture]   Found ${otherTargets.length} non-page target(s) (skipped): ${otherTargets.map(t => t.type).join(', ')}`);
    }

    if (tabs.length === 0) {
      logCapture(`[Browser Capture] ⚠️  No valid tabs found on port ${port} (found ${targets.length} targets but none were page types)`);
      // If we found targets but no pages, log what we did find
      if (targets.length > 0) {
        const pageTargets = targets.filter(t => t.type === 'page');
        logCapture(`[Browser Capture]   Found ${pageTargets.length} page target(s), but all were filtered out as internal pages`);
      }
      return null;
    }

    logCapture(`[Browser Capture] ✓ Collected ${tabs.length} valid tab(s) from ${browserName} on port ${port}`);
    return {
      browserName,
      browserPath: '', // Will be filled in by caller
      debuggingPort: port,
      tabs,
    };
  } catch (error) {
    console.error(`[Browser Capture] ✗ Failed to get tabs from port ${port}:`, error);
    if (error instanceof Error) {
      console.error(`[Browser Capture] Error details: ${error.message}`);
      console.error(`[Browser Capture] Stack: ${error.stack}`);
    }
    return null;
  }
}

/**
 * Find Chrome browser path on Windows
 */
async function findChromePath(): Promise<string | null> {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const path of possiblePaths) {
    try {
      const { stdout } = await execPromise(`if exist "${path}" echo exists`);
      if (stdout.includes('exists')) {
        return path;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Find Brave browser path on Windows
 */
async function findBravePath(): Promise<string | null> {
  const possiblePaths = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    process.env.LOCALAPPDATA + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];

  for (const path of possiblePaths) {
    try {
      const { stdout } = await execPromise(`if exist "${path}" echo exists`);
      if (stdout.includes('exists')) {
        return path;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Find Microsoft Edge browser path on Windows
 */
async function findEdgePath(): Promise<string | null> {
  const possiblePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.PROGRAMFILES + '\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  for (const path of possiblePaths) {
    try {
      const { stdout } = await execPromise(`if exist "${path}" echo exists`);
      if (stdout.includes('exists')) {
        return path;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Detect which browser is running on which debug port
 */
async function detectBrowserOnPort(port: number): Promise<{ name: string; path: string } | null> {
  try {
    // Try to determine browser type from the version endpoint
    const version = await CDP.Version({ port });
    const userAgent = version['User-Agent'] || '';

    if (userAgent.includes('Chrome')) {
      if (userAgent.includes('Brave')) {
        const path = await findBravePath();
        return { name: 'Brave', path: path || 'brave.exe' };
      }
      if (userAgent.includes('Edg/')) {
        const path = await findEdgePath();
        return { name: 'Edge', path: path || 'msedge.exe' };
      }
      const path = await findChromePath();
      return { name: 'Chrome', path: path || 'chrome.exe' };
    }
  } catch {
    // If we can't get version info, try to detect by process
    try {
      const { stdout: edgeCheck } = await execPromise('tasklist /FI "IMAGENAME eq msedge.exe"');
      if (edgeCheck.includes('msedge.exe')) {
        const path = await findEdgePath();
        return { name: 'Edge', path: path || 'msedge.exe' };
      }

      const { stdout: chromeCheck } = await execPromise('tasklist /FI "IMAGENAME eq chrome.exe"');
      if (chromeCheck.includes('chrome.exe')) {
        const path = await findChromePath();
        return { name: 'Chrome', path: path || 'chrome.exe' };
      }

      const { stdout: braveCheck } = await execPromise('tasklist /FI "IMAGENAME eq brave.exe"');
      if (braveCheck.includes('brave.exe')) {
        const path = await findBravePath();
        return { name: 'Brave', path: path || 'brave.exe' };
      }
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Capture all browser sessions that have remote debugging enabled
 */
export async function captureBrowserSessions(): Promise<BrowserSession[]> {
  const sessions: BrowserSession[] = [];
  const checkedPorts = new Set<number>();

  // Helper to log to both console and renderer
  const logCapture = (...args: any[]) => {
    logger.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  logCapture('[Browser Capture] ============================================');
  logCapture('[Browser Capture] Starting browser capture...');
  logCapture('[Browser Capture] ============================================');

  // First, try to find debug ports from running processes
  logCapture('[Browser Capture] Step 1: Searching for debug ports from running processes...');
  const processPorts = await findDebugPortsFromProcesses();
  logCapture(`[Browser Capture] Found ${processPorts.length} debug port(s) from processes: ${processPorts.length > 0 ? processPorts.join(', ') : 'none'}`);
  
  // Combine process ports with common ports
  const portsToCheck = [...new Set([...processPorts, ...COMMON_DEBUG_PORTS])];
  
  logCapture(`[Browser Capture] Step 2: Checking ${portsToCheck.length} port(s) for browser debugging...`);
  logCapture(`[Browser Capture] Ports to check: ${portsToCheck.join(', ')}`);

  for (const port of portsToCheck) {
    if (checkedPorts.has(port)) {
      continue; // Skip already checked ports
    }
    checkedPorts.add(port);

    logCapture(`[Browser Capture] --- Checking port ${port} ---`);
    const isActive = await checkDebugPort(port);
    if (!isActive) {
      logCapture(`[Browser Capture] Port ${port} is not active (no CDP connection)`);
      continue;
    }

    logCapture(`[Browser Capture] ✓ Port ${port} is active, detecting browser type...`);
    const browserInfo = await detectBrowserOnPort(port);
    if (!browserInfo) {
      logCapture(`[Browser Capture] ⚠️  Could not detect browser type on port ${port}`);
      continue;
    }

    logCapture(`[Browser Capture] ✓ Detected ${browserInfo.name} on port ${port} (path: ${browserInfo.path})`);

    const session = await getTabsFromPort(port, browserInfo.name);
    if (session) {
      session.browserPath = browserInfo.path;
      sessions.push(session);
      logCapture(`[Browser Capture] ✓✓✓ Successfully captured ${session.tabs.length} tab(s) from ${browserInfo.name} on port ${port}`);
    } else {
      logCapture(`[Browser Capture] ⚠️  No tabs found on port ${port} (browser detected but no page targets)`);
    }
  }

  logCapture('[Browser Capture] ============================================');
  logCapture(`[Browser Capture] SUMMARY: Found ${sessions.length} browser session(s) with ${sessions.reduce((sum, s) => sum + s.tabs.length, 0)} total tab(s)`);
  sessions.forEach((session, idx) => {
    logCapture(`[Browser Capture]   Session ${idx + 1}: ${session.browserName} (port ${session.debuggingPort}) - ${session.tabs.length} tab(s)`);
  });
  logCapture('[Browser Capture] ============================================');
  
  return sessions;
}

/**
 * Check if any browsers are running without remote debugging enabled
 */
export async function detectBrowsersWithoutDebugging(): Promise<string[]> {
  const browsersWithoutDebug: string[] = [];

  if (process.platform === 'win32') {
    const browserProcesses = [
      { process: 'chrome.exe', name: 'Chrome' },
      { process: 'brave.exe', name: 'Brave' },
      { process: 'msedge.exe', name: 'Edge' },
    ];

    // Get all ports to check (from processes + common ports)
    const processPorts = await findDebugPortsFromProcesses();
    const allPortsToCheck = [...new Set([...processPorts, ...COMMON_DEBUG_PORTS])];

    for (const browser of browserProcesses) {
      try {
        // Sanitize process name to prevent command injection
        const { sanitizeProcessName } = await import('./utils/security.js');
        const sanitizedProcess = sanitizeProcessName(browser.process);
        const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${sanitizedProcess}"`);
        if (stdout && stdout.includes(sanitizedProcess)) {
          // Check if any debug port is active for this browser
          let hasDebugPort = false;
          for (const port of allPortsToCheck) {
            if (await checkDebugPort(port)) {
              const browserInfo = await detectBrowserOnPort(port);
              if (browserInfo?.name === browser.name) {
                hasDebugPort = true;
                break;
              }
            }
          }

          if (!hasDebugPort) {
            browsersWithoutDebug.push(browser.name);
          }
        }
      } catch {
        // Browser not running
      }
    }
  }

  return browsersWithoutDebug;
}

/**
 * Get instructions for enabling remote debugging for a browser
 */
export function getDebugInstructions(browserName: string): string {
  const instructions: Record<string, string> = {
    Chrome: `To enable tab capture for Chrome:
⚠️ IMPORTANT: Remote debugging must be enabled when the browser starts.
If Chrome is already running, you MUST close all Chrome windows first.

1. Close all Chrome windows (if Chrome is currently running)
2. Open Chrome with: chrome.exe --remote-debugging-port=9222
3. Or use the "Launch Browser" button in Settings to launch it automatically
4. Or create a shortcut with this flag added to the target

Once launched with debugging, the app can detect it immediately - no restart needed.`,
    Brave: `To enable tab capture for Brave:
⚠️ IMPORTANT: Remote debugging must be enabled when the browser starts.
If Brave is already running, you MUST close all Brave windows first.

1. Close all Brave windows (if Brave is currently running)
2. Open Brave with: brave.exe --remote-debugging-port=9222
3. Or use the "Launch Browser" button in Settings to launch it automatically
4. Or create a shortcut with this flag added to the target

Once launched with debugging, the app can detect it immediately - no restart needed.`,
    Edge: `To enable tab capture for Microsoft Edge:
⚠️ IMPORTANT: Remote debugging must be enabled when the browser starts.
If Edge is already running, you MUST close all Edge windows first.

1. Close all Edge windows (if Edge is currently running)
2. Open Edge with: msedge.exe --remote-debugging-port=9223
3. Or use the "Launch Browser" button in Settings to launch it automatically
4. Or create a shortcut with this flag added to the target

Once launched with debugging, the app can detect it immediately - no restart needed.`,
  };

  return instructions[browserName] || 'Remote debugging not supported for this browser';
}

/**
 * Close all windows of a browser (Windows only)
 */
async function closeBrowserWindows(browserName: string): Promise<{ success: boolean; error?: string }> {
  const logCapture = (...args: any[]) => {
    logger.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  if (process.platform !== 'win32') {
    return { success: false, error: 'Auto-close is only supported on Windows' };
  }

  const processMap: Record<string, string> = {
    Chrome: 'chrome.exe',
    Brave: 'brave.exe',
    Edge: 'msedge.exe',
  };

  const processName = processMap[browserName];
  if (!processName) {
    return { success: false, error: `Unsupported browser: ${browserName}` };
  }

  try {
    logCapture(`[Browser Close] Closing all ${browserName} windows...`);
    
    // Sanitize process name to prevent command injection
    const { sanitizeProcessName } = await import('./utils/security.js');
    const sanitizedProcess = sanitizeProcessName(processName);
    
    // Check if browser is running
    const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${sanitizedProcess}"`);
    if (!stdout || !stdout.includes(sanitizedProcess)) {
      logCapture(`[Browser Close] ${browserName} is not running`);
      return { success: true }; // Already closed
    }

    // Close all browser processes gracefully
    // Using /F to force close if needed, /T to close child processes
    logCapture(`[Browser Close] Sending close signal to ${sanitizedProcess}...`);
    await execPromise(`taskkill /IM ${sanitizedProcess} /F /T`).catch(() => {
      // Ignore errors - process might already be closing
    });

    // Wait for processes to fully close (check every 500ms, max 10 seconds)
    logCapture(`[Browser Close] Waiting for ${browserName} to fully close...`);
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        const { stdout: checkStdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${sanitizedProcess}"`);
        if (!checkStdout || !checkStdout.includes(sanitizedProcess)) {
          logCapture(`[Browser Close] ✓ ${browserName} closed successfully`);
          return { success: true };
        }
      } catch {
        // Process not found - it's closed
        logCapture(`[Browser Close] ✓ ${browserName} closed successfully`);
        return { success: true };
      }
    }

    logCapture(`[Browser Close] ⚠️  ${browserName} may still be closing, but proceeding anyway`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCapture(`[Browser Close] ✗ Failed to close ${browserName}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Capture tabs from a browser before closing (if debugging is available)
 */
async function captureTabsBeforeClose(browserName: string): Promise<BrowserTab[]> {
  const logCapture = (...args: any[]) => {
    logger.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  logCapture(`[Browser Relaunch] Attempting to capture tabs from ${browserName} before closing...`);

  // Try to find the browser on any debugging port
  const portsToCheck = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230];
  
  for (const port of portsToCheck) {
    try {
      const isActive = await checkDebugPort(port);
      if (!isActive) {
        continue;
      }

      const browserInfo = await detectBrowserOnPort(port);
      if (browserInfo?.name === browserName) {
        // Found the browser on this port - capture tabs
        logCapture(`[Browser Relaunch] Found ${browserName} on port ${port}, capturing tabs...`);
        const session = await getTabsFromPort(port, browserName);
        if (session && session.tabs.length > 0) {
          logCapture(`[Browser Relaunch] ✓ Captured ${session.tabs.length} tab(s) from ${browserName}`);
          return session.tabs;
        }
      }
    } catch (error) {
      // Continue checking other ports
      continue;
    }
  }

  logCapture(`[Browser Relaunch] ⚠️  Could not capture tabs from ${browserName} (no debugging port found or no tabs)`);
  return [];
}

/**
 * Restore tabs to a browser after relaunch
 */
async function restoreTabsAfterRelaunch(browserName: string, tabs: BrowserTab[], port: number): Promise<void> {
  const logCapture = (...args: any[]) => {
    logger.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  if (tabs.length === 0) {
    logCapture(`[Browser Relaunch] No tabs to restore`);
    return;
  }

  logCapture(`[Browser Relaunch] Restoring ${tabs.length} tab(s) to ${browserName}...`);

  // Wait a moment for browser to fully start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Try to restore tabs using CDP
  try {
    const targets = await CDP.List({ port });
    
    if (targets.length > 0) {
      // Connect without a target to access the Target domain
      const client = await CDP({ port });
      
      // Open each tab
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        try {
          // Skip internal pages
          if (tab.url.startsWith('chrome://') || 
              tab.url.startsWith('edge://') || 
              tab.url.startsWith('brave://') ||
              tab.url.startsWith('chrome-extension://') ||
              tab.url.startsWith('edge-extension://') ||
              tab.url.startsWith('brave-extension://')) {
            continue;
          }

          // Use Target.createTarget to open a new tab with the URL
          await client.Target.createTarget({ url: tab.url });
          logCapture(`[Browser Relaunch]   ✓ Restored tab ${i + 1}/${tabs.length}: ${tab.title || tab.url}`);
          
          // Small delay between tabs
          if (i < tabs.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (tabError) {
          logCapture(`[Browser Relaunch]   ⚠️  Failed to restore tab "${tab.title}":`, tabError);
        }
      }
      
      await client.close();
      logCapture(`[Browser Relaunch] ✓ Restored ${tabs.length} tab(s) to ${browserName} via CDP`);
      return;
    }
  } catch (error) {
    logCapture(`[Browser Relaunch] ⚠️  Failed to restore tabs via CDP, using fallback:`, error);
  }
  
  // Fallback: use spawn to open URLs
  try {
    const browserPath = browserName === 'Chrome' ? await findChromePath() :
                        browserName === 'Brave' ? await findBravePath() :
                        await findEdgePath();
    
    if (browserPath) {
      const { spawn } = await import('child_process');
      for (const tab of tabs) {
        if (!tab.url.startsWith('chrome://') && 
            !tab.url.startsWith('edge://') && 
            !tab.url.startsWith('brave://') &&
            !tab.url.startsWith('chrome-extension://') &&
            !tab.url.startsWith('edge-extension://') &&
            !tab.url.startsWith('brave-extension://')) {
          spawn(browserPath, [tab.url], { detached: true, stdio: 'ignore' });
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      logCapture(`[Browser Relaunch] ✓ Restored ${tabs.length} tab(s) using fallback method`);
    }
  } catch (fallbackError) {
    logCapture(`[Browser Relaunch] ✗ Failed to restore tabs:`, fallbackError);
  }
}

/**
 * Close and relaunch a browser with remote debugging enabled
 * This is the best workaround for enabling debugging on an already-running browser
 * Also captures and restores all tabs to maintain user's workspace
 */
export async function closeAndRelaunchBrowserWithDebugging(browserName: string): Promise<{ success: boolean; error?: string }> {
  const logCapture = (...args: any[]) => {
    logger.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  // Normalize browser name (handle lowercase input from IPC)
  const normalizedName = browserName.charAt(0).toUpperCase() + browserName.slice(1).toLowerCase();
  const browserNameMap: Record<string, string> = {
    'Chrome': 'Chrome',
    'Brave': 'Brave',
    'Edge': 'Edge',
    'Msedge': 'Edge', // Handle msedge.exe -> Edge
  };
  
  const mappedName = browserNameMap[normalizedName] || normalizedName;
  
  logCapture(`[Browser Relaunch] Attempting to close and relaunch ${mappedName} with remote debugging...`);

  // Step 1: Capture tabs before closing (if possible)
  const tabs = await captureTabsBeforeClose(mappedName);
  const tabCount = tabs.length;
  if (tabCount > 0) {
    logCapture(`[Browser Relaunch] Captured ${tabCount} tab(s) to restore after relaunch`);
  }

  // Step 2: Close the browser
  const closeResult = await closeBrowserWindows(mappedName);
  if (!closeResult.success) {
    return { success: false, error: `Failed to close ${mappedName}: ${closeResult.error}` };
  }

  // Step 3: Wait a moment for processes to fully terminate
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Step 4: Launch with debugging
  const launchResult = await launchBrowserWithDebugging(mappedName);
  if (!launchResult.success) {
    return launchResult;
  }

  // Step 5: Restore tabs after relaunch
  if (tabCount > 0) {
    // Determine the port based on browser
    const port = mappedName === 'Edge' ? 9223 : 9222;
    await restoreTabsAfterRelaunch(mappedName, tabs, port);
  }

  return { success: true };
}

/**
 * Launch a browser with remote debugging enabled
 */
export async function launchBrowserWithDebugging(browserName: string): Promise<{ success: boolean; error?: string }> {
  const logCapture = (...args: any[]) => {
    logger.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  // Normalize browser name (handle lowercase input from IPC)
  const normalizedName = browserName.charAt(0).toUpperCase() + browserName.slice(1).toLowerCase();
  const browserNameMap: Record<string, string> = {
    'Chrome': 'Chrome',
    'Brave': 'Brave',
    'Edge': 'Edge',
    'Msedge': 'Edge', // Handle msedge.exe -> Edge
  };
  
  const mappedName = browserNameMap[normalizedName] || normalizedName;

  logCapture(`[Browser Launch] Attempting to launch ${mappedName} with remote debugging...`);

  try {
    let browserPath: string | null = null;
    let port = 9222;

    // Find browser path and set port
    if (mappedName === 'Brave') {
      browserPath = await findBravePath();
      port = 9222;
    } else if (mappedName === 'Chrome') {
      browserPath = await findChromePath();
      port = 9222;
    } else if (mappedName === 'Edge') {
      browserPath = await findEdgePath();
      port = 9223;
    } else {
      return { success: false, error: `Unsupported browser: ${mappedName}` };
    }

    if (!browserPath) {
      logCapture(`[Browser Launch] ✗ ${browserName} not found in common installation locations`);
      return { success: false, error: `${browserName} not found. Please install ${browserName} or launch it manually with --remote-debugging-port=${port}` };
    }

    logCapture(`[Browser Launch] Found ${browserName} at: ${browserPath}`);

    // Launch browser with debugging (allow multiple instances)
    logCapture(`[Browser Launch] Launching ${browserName} with --remote-debugging-port=${port}...`);
    const { spawn } = await import('child_process');
    
    spawn(browserPath, [`--remote-debugging-port=${port}`], {
      detached: true,
      stdio: 'ignore'
    });

    logCapture(`[Browser Launch] ✓ ${browserName} launched successfully with remote debugging on port ${port}`);
    logCapture(`[Browser Launch] You can now capture browser tabs. Wait a few seconds for ${browserName} to fully start.`);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logCapture(`[Browser Launch] ✗ Failed to launch ${browserName}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}
