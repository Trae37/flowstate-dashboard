import CDP from 'chrome-remote-interface';
import { exec } from 'child_process';
import { promisify } from 'util';

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
 * Get detailed tab information by connecting to the target
 */
async function getTabDetails(port: number, targetId: string): Promise<{ url: string; title: string } | null> {
  try {
    const client = await CDP({ port, target: targetId });
    await client.Page.enable();
    const frameTree = await client.Page.getFrameTree();
    const url = frameTree.frameTree.frame.url || '';
    const title = await client.Runtime.evaluate({ expression: 'document.title' }).then(r => r.result?.value || '').catch(() => '');
    await client.close();
    return { url, title: title || 'Untitled' };
  } catch (error) {
    // If we can't get details, that's okay - we'll use what we have from List
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
      console.log(...args);
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
    
    for (const target of targets) {
      // Get page targets - these are the actual browser tabs
      if (target.type === 'page') {
        let url = target.url || '';
        let title = target.title || 'Untitled';
        
        // Try to get more detailed information if URL/title is missing
        if (!url || !title || title === 'no title') {
          const details = await getTabDetails(port, target.id);
          if (details) {
            url = details.url || url;
            title = details.title || title;
            logCapture(`[Browser Capture]   Enhanced tab info: "${title}" (${url})`);
          }
        }
        
        // Skip only truly internal browser pages (settings, extensions, etc.)
        // But capture everything else, including about:blank (new tabs)
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
            url: url || 'about:blank',
            title: title,
            id: target.id,
            faviconUrl: (target as any).faviconUrl || undefined,
          });
          logCapture(`[Browser Capture]   ✓ Captured tab: "${title}" (${url || 'about:blank'})`);
        } else {
          logCapture(`[Browser Capture]   - Skipped internal page: ${url}`);
        }
      } else {
        // Log other target types for debugging (we might want to capture some of these later)
        logCapture(`[Browser Capture]   - Skipped ${target.type}: ${target.url || 'no URL'}`);
      }
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
    console.log(...args);
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
        const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${browser.process}"`);
        if (stdout && stdout.includes(browser.process)) {
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
1. Close all Chrome windows
2. Open Chrome with: chrome.exe --remote-debugging-port=9222
3. Or create a shortcut with this flag added to the target`,
    Brave: `To enable tab capture for Brave:
1. Close all Brave windows
2. Open Brave with: brave.exe --remote-debugging-port=9222
3. Or create a shortcut with this flag added to the target`,
    Edge: `To enable tab capture for Microsoft Edge:
1. Close all Edge windows
2. Open Edge with: msedge.exe --remote-debugging-port=9223
3. Or create a shortcut with this flag added to the target`,
  };

  return instructions[browserName] || 'Remote debugging not supported for this browser';
}

/**
 * Launch a browser with remote debugging enabled
 */
export async function launchBrowserWithDebugging(browserName: string): Promise<{ success: boolean; error?: string }> {
  const logCapture = (...args: any[]) => {
    console.log(...args);
    try {
      const logToRenderer = (global as any).logToRenderer;
      if (logToRenderer) logToRenderer(...args);
    } catch {}
  };

  logCapture(`[Browser Launch] Attempting to launch ${browserName} with remote debugging...`);

  try {
    let browserPath: string | null = null;
    let port = 9222;

    // Find browser path and set port
    if (browserName === 'Brave') {
      browserPath = await findBravePath();
      port = 9222;
    } else if (browserName === 'Chrome') {
      browserPath = await findChromePath();
      port = 9222;
    } else if (browserName === 'Edge') {
      browserPath = await findEdgePath();
      port = 9223;
    } else {
      return { success: false, error: `Unsupported browser: ${browserName}` };
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
