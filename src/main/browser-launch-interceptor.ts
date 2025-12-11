/**
 * Browser Launch Interceptor
 * Monitors for browser launches and automatically starts them with debugging enabled
 * when FlowState is running
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './utils/logger.js';

const execPromise = promisify(exec);

interface BrowserConfig {
  processName: string;
  browserName: string;
  defaultPort: number;
  findPath: () => Promise<string | null>;
}

const BROWSER_CONFIGS: BrowserConfig[] = [
  {
    processName: 'chrome.exe',
    browserName: 'Chrome',
    defaultPort: 9222,
    findPath: async () => {
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
    },
  },
  {
    processName: 'brave.exe',
    browserName: 'Brave',
    defaultPort: 9222,
    findPath: async () => {
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
    },
  },
  {
    processName: 'msedge.exe',
    browserName: 'Edge',
    defaultPort: 9223,
    findPath: async () => {
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
    },
  },
];

let monitoringInterval: NodeJS.Timeout | null = null;
let lastKnownProcesses = new Set<string>();
let isMonitoring = false;

/**
 * Check if a browser process has remote debugging enabled
 */
async function hasDebuggingEnabled(processName: string): Promise<boolean> {
  try {
    const { stdout } = await execPromise(
      `wmic process where "name='${processName}'" get commandline /format:csv`
    );
    // Check if command line contains remote debugging port flag
    return /--remote-debugging-port[=:](\d+)/gi.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Capture tabs from browser before closing (for interceptor)
 */
async function captureTabsForInterceptor(config: BrowserConfig): Promise<Array<{ url: string; title: string }>> {
  try {
    // Try to find browser on any port and capture tabs
    const CDP = (await import('chrome-remote-interface')).default;
    const portsToCheck = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230];
    
    for (const port of portsToCheck) {
      try {
        const targets = await CDP.List({ port });
        if (targets.length === 0) continue;
        
        // Check if this is the right browser by checking user agent
        try {
          const version = await CDP.Version({ port });
          const userAgent = version['User-Agent'] || '';
          
          const isMatch = (config.browserName === 'Chrome' && userAgent.includes('Chrome') && !userAgent.includes('Brave') && !userAgent.includes('Edg/')) ||
                         (config.browserName === 'Brave' && userAgent.includes('Brave')) ||
                         (config.browserName === 'Edge' && userAgent.includes('Edg/'));
          
          if (isMatch) {
            // Found the browser - capture tabs
            const tabs: Array<{ url: string; title: string }> = [];
            for (const target of targets) {
              if (target.type === 'page') {
                const url = target.url || '';
                const title = target.title || 'Untitled';
                
                // Skip internal pages
                if (!url.startsWith('chrome://') && 
                    !url.startsWith('edge://') && 
                    !url.startsWith('brave://') &&
                    !url.startsWith('chrome-extension://') &&
                    !url.startsWith('edge-extension://') &&
                    !url.startsWith('brave-extension://')) {
                  tabs.push({ url, title });
                }
              }
            }
            if (tabs.length > 0) {
              logger.info(`[Browser Interceptor] Captured ${tabs.length} tab(s) from ${config.browserName}`);
              return tabs;
            }
          }
        } catch {
          continue;
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    logger.warn(`[Browser Interceptor] Could not capture tabs:`, error);
  }
  return [];
}

/**
 * Restore tabs after relaunch (for interceptor)
 */
async function restoreTabsForInterceptor(config: BrowserConfig, tabs: Array<{ url: string; title: string }>): Promise<void> {
  if (tabs.length === 0) return;
  
  try {
    // Wait for browser to fully start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try to restore via CDP
    const CDP = (await import('chrome-remote-interface')).default;
    const targets = await CDP.List({ port: config.defaultPort });
    
    if (targets.length > 0) {
      const browserTarget = targets.find(t => t.type === 'browser');
      if (browserTarget) {
        const client = await CDP({ port: config.defaultPort, target: browserTarget.id });
        
        for (const tab of tabs) {
          try {
            await client.Target.createTarget({ url: tab.url });
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch {
            // Continue with next tab
          }
        }
        
        await client.close();
        logger.info(`[Browser Interceptor] ✓ Restored ${tabs.length} tab(s) to ${config.browserName}`);
        return;
      }
    }
    
    // Fallback: use spawn
    const browserPath = await config.findPath();
    if (browserPath) {
      const { spawn } = await import('child_process');
      for (const tab of tabs) {
        spawn(browserPath, [tab.url], { detached: true, stdio: 'ignore' });
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      logger.info(`[Browser Interceptor] ✓ Restored ${tabs.length} tab(s) using fallback method`);
    }
  } catch (error) {
    logger.warn(`[Browser Interceptor] Failed to restore tabs:`, error);
  }
}

/**
 * Intercept a browser launch by closing it and relaunching with debugging
 * Also captures and restores all tabs to maintain user's workspace
 */
async function interceptBrowserLaunch(config: BrowserConfig): Promise<void> {
  try {
    logger.info(`[Browser Interceptor] Intercepting ${config.browserName} launch...`);
    
    // Wait a moment for the browser to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check if it has debugging enabled
    const hasDebugging = await hasDebuggingEnabled(config.processName);
    if (hasDebugging) {
      logger.info(`[Browser Interceptor] ${config.browserName} already has debugging enabled, no action needed`);
      return;
    }
    
    // Capture tabs before closing
    const tabs = await captureTabsForInterceptor(config);
    if (tabs.length > 0) {
      logger.info(`[Browser Interceptor] Captured ${tabs.length} tab(s) to restore after relaunch`);
    }
    
    // Close the browser
    logger.info(`[Browser Interceptor] Closing ${config.browserName} to relaunch with debugging...`);
    await execPromise(`taskkill /IM ${config.processName} /F /T`).catch(() => {
      // Ignore errors - process might already be closing
    });
    
    // Wait for it to close
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Find browser path
    const browserPath = await config.findPath();
    if (!browserPath) {
      logger.warn(`[Browser Interceptor] Could not find ${config.browserName} path, cannot intercept`);
      return;
    }
    
    // Relaunch with debugging
    const { spawn } = await import('child_process');
    spawn(browserPath, [`--remote-debugging-port=${config.defaultPort}`], {
      detached: true,
      stdio: 'ignore'
    });
    
    logger.info(`[Browser Interceptor] ✓ ${config.browserName} relaunched with debugging on port ${config.defaultPort}`);
    
    // Restore tabs after relaunch
    if (tabs.length > 0) {
      await restoreTabsForInterceptor(config, tabs);
    }
  } catch (error) {
    logger.error(`[Browser Interceptor] Failed to intercept ${config.browserName}:`, error);
  }
}

/**
 * Start monitoring for browser launches
 */
export function startBrowserLaunchMonitoring(): void {
  if (isMonitoring) {
    logger.warn('[Browser Interceptor] Already monitoring browser launches');
    return;
  }
  
  if (process.platform !== 'win32') {
    logger.info('[Browser Interceptor] Browser launch interception is only supported on Windows');
    return;
  }
  
  isMonitoring = true;
  logger.info('[Browser Interceptor] Starting browser launch monitoring...');
  
  // Poll for new browser processes every 2 seconds
  monitoringInterval = setInterval(async () => {
    try {
      for (const config of BROWSER_CONFIGS) {
        try {
          // Check if browser is running
          const { sanitizeProcessName } = await import('./utils/security.js');
          const sanitizedProcess = sanitizeProcessName(config.processName);
          const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${sanitizedProcess}"`);
          if (!stdout || !stdout.includes(config.processName)) {
            // Browser not running, remove from known processes
            lastKnownProcesses.delete(config.processName);
            continue;
          }
          
          // Browser is running - check if we've seen it before
          const processKey = config.processName;
          if (!lastKnownProcesses.has(processKey)) {
            // New browser process detected
            lastKnownProcesses.add(processKey);
            
            // Check if it has debugging enabled
            const hasDebugging = await hasDebuggingEnabled(config.processName);
            if (!hasDebugging) {
              // Intercept it
              await interceptBrowserLaunch(config);
            } else {
              logger.info(`[Browser Interceptor] ${config.browserName} launched with debugging already enabled`);
            }
          }
        } catch (error) {
          // Browser not running or error checking - that's okay
          lastKnownProcesses.delete(config.processName);
        }
      }
    } catch (error) {
      logger.error('[Browser Interceptor] Error in monitoring loop:', error);
    }
  }, 2000); // Check every 2 seconds
}

/**
 * Stop monitoring for browser launches
 */
export function stopBrowserLaunchMonitoring(): void {
  if (!isMonitoring) {
    return;
  }
  
  isMonitoring = false;
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  lastKnownProcesses.clear();
  logger.info('[Browser Interceptor] Stopped browser launch monitoring');
}

