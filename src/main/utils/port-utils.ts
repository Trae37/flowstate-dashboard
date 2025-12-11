/**
 * Port Utilities - Check if ports are in use and kill processes
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Check if a specific port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execPromise(`netstat -ano | findstr :${port}`);
      return stdout.trim().length > 0;
    } else {
      const { stdout } = await execPromise(`lsof -i:${port}`);
      return stdout.trim().length > 0;
    }
  } catch (error) {
    // If command fails, port is likely not in use
    return false;
  }
}

/**
 * Kill process using a specific port
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      // Get PID using the port
      const { stdout } = await execPromise(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];

        if (pid && !isNaN(parseInt(pid))) {
          try {
            await execPromise(`taskkill /F /PID ${pid}`);
            console.log(`[Port Utils] Killed process ${pid} on port ${port}`);
            return true;
          } catch (killError) {
            console.warn(`[Port Utils] Failed to kill process ${pid}:`, killError);
          }
        }
      }
    } else {
      await execPromise(`lsof -ti:${port} | xargs kill -9`);
      console.log(`[Port Utils] Killed process on port ${port}`);
      return true;
    }

    return false;
  } catch (error) {
    console.warn(`[Port Utils] Failed to kill process on port ${port}:`, error);
    return false;
  }
}

/**
 * Find an available port starting from a given port
 */
export async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${startPort + maxAttempts}`);
}

/**
 * Get PowerShell command to check and handle port conflicts
 * Returns a script that will either kill the existing process or use an alt port
 */
export function getPortConflictHandler(port: number, command: string): string {
  return `
# Check if port ${port} is in use
$portInUse = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue
if ($portInUse) {
  Write-Host "Port ${port} is already in use. Attempting to free it..." -ForegroundColor Yellow
  $process = Get-Process -Id $portInUse[0].OwningProcess -ErrorAction SilentlyContinue
  if ($process) {
    Write-Host "Killing process: $($process.Name) (PID: $($process.Id))" -ForegroundColor Yellow
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
}
${command}
`.trim();
}
