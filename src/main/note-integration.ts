import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';

const execPromise = promisify(exec);

// Production-silent logging - only log in development
const log = (...args: any[]) => { if (!app.isPackaged) log(...args); };
const logError = (...args: any[]) => console.error(...args);

export interface NoteSession {
  appName: 'Notion' | 'Notepad' | 'Apple Notes' | 'Unknown';
  title?: string;
  url?: string;
  filePath?: string;
  processId?: number;
  content?: string;
}

/**
 * Capture all active note-taking app sessions
 */
export async function captureNoteSessions(): Promise<NoteSession[]> {
  const sessions: NoteSession[] = [];

  if (process.platform === 'win32') {
    // Windows: Capture Notion and Notepad
    sessions.push(...await captureNotionWindows());
    sessions.push(...await captureNotepadWindows());
  } else if (process.platform === 'darwin') {
    // macOS: Capture Notion and Apple Notes
    sessions.push(...await captureNotionMacOS());
    sessions.push(...await captureAppleNotes());
  }

  return sessions;
}

/**
 * Capture Notion on Windows
 */
async function captureNotionWindows(): Promise<NoteSession[]> {
  const sessions: NoteSession[] = [];

  try {
    // Check if Notion desktop app is running
    const { stdout } = await execPromise('tasklist /FI "IMAGENAME eq Notion.exe" /FO CSV /NH');
    
    if (!stdout || !stdout.includes('Notion.exe')) {
      log('[Note Capture] Notion desktop app not running on Windows');
      return sessions;
    }

    log('[Note Capture] Notion desktop app detected on Windows');

    // Get all Notion windows with their titles
    try {
      const { stdout: windowInfo } = await execPromise(
        'powershell -Command "Get-Process Notion -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -and $_.MainWindowTitle -ne \'\'} | Select-Object MainWindowTitle,Id | ConvertTo-Json"'
      );

      if (windowInfo && windowInfo.trim()) {
        const processes = JSON.parse(windowInfo);
        const processList = Array.isArray(processes) ? processes : [processes];

        log(`[Note Capture] Found ${processList.length} Notion window(s) with titles`);

        for (const proc of processList) {
          let windowTitle = proc.MainWindowTitle || '';
          
          // Skip empty or generic titles
          if (!windowTitle || windowTitle === 'Notion') {
            continue;
          }

          // Notion window titles are formatted as: "Page Title - Workspace Name"
          // or just "Page Title"
          let pageName = windowTitle;
          let workspaceName: string | undefined;

          // Try to parse workspace from title
          const dashIndex = windowTitle.lastIndexOf(' - ');
          if (dashIndex > 0) {
            pageName = windowTitle.substring(0, dashIndex).trim();
            workspaceName = windowTitle.substring(dashIndex + 3).trim();
          }

          // Create a more descriptive content string
          let content = `Notion Page: ${pageName}`;
          if (workspaceName) {
            content += `\nWorkspace: ${workspaceName}`;
          }

          sessions.push({
            appName: 'Notion',
            title: pageName,
            processId: proc.Id,
            content,
            url: undefined, // Desktop app doesn't expose URLs easily, but we save the page name
          });

          log(`[Note Capture] Captured Notion page: "${pageName}"${workspaceName ? ` in workspace "${workspaceName}"` : ''}`);
        }
      }

      // If no windows with titles found, add a generic entry
      if (sessions.length === 0) {
        log('[Note Capture] Notion is running but no titled windows found');
        sessions.push({
          appName: 'Notion',
          title: 'Notion (Running)',
          content: 'Notion desktop app is running. Switch to a page to capture its title.',
        });
      }
    } catch (error) {
      console.warn('[Note Capture] Could not get Notion window details:', error);
      // Fallback: just show Notion is running
      sessions.push({
        appName: 'Notion',
        title: 'Notion (Running)',
        content: 'Notion is running. Specific page could not be determined.',
      });
    }
  } catch (error) {
    console.warn('[Note Capture] Error capturing Notion on Windows:', error);
  }

  return sessions;
}

/**
 * Capture Notepad on Windows
 */
async function captureNotepadWindows(): Promise<NoteSession[]> {
  const sessions: NoteSession[] = [];

  try {
    // Check if Notepad is running
    const { stdout } = await execPromise('tasklist /FI "IMAGENAME eq notepad.exe" /FO CSV /NH');
    
    if (!stdout || !stdout.includes('notepad.exe')) {
      log('[Note Capture] Notepad not running on Windows');
      return sessions;
    }

    log('[Note Capture] Notepad detected on Windows');

    // Get all Notepad windows with their titles (which contain the file path)
    try {
      const { stdout: windowInfo } = await execPromise(
        'powershell -Command "Get-Process notepad -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle} | Select-Object MainWindowTitle,Id | ConvertTo-Json"'
      );

      if (windowInfo && windowInfo.trim()) {
        const processes = JSON.parse(windowInfo);
        const processList = Array.isArray(processes) ? processes : [processes];

        for (const proc of processList) {
          const windowTitle = proc.MainWindowTitle || '';
          
          // Notepad window titles are formatted as: "filename.txt - Notepad" or "*filename.txt - Notepad" (if unsaved)
          let filePath: string | undefined;
          let title = windowTitle;

          // Try to extract file path from window title
          const notepadMatch = windowTitle.match(/^(\*?)(.+?)\s*-\s*Notepad$/i);
          if (notepadMatch) {
            const isUnsaved = notepadMatch[1] === '*';
            const fileName = notepadMatch[2];
            title = `${isUnsaved ? '(Unsaved) ' : ''}${fileName}`;
            
            // If it's a full path, use it
            if (fileName.includes('\\') || fileName.includes('/')) {
              filePath = fileName;
            }
          }

          sessions.push({
            appName: 'Notepad',
            title,
            filePath,
            processId: proc.Id,
            content: `Notepad file: ${title}`,
          });
        }
      }
    } catch (error) {
      console.warn('[Note Capture] Could not get Notepad window details:', error);
      // Fallback
      sessions.push({
        appName: 'Notepad',
        title: 'Notepad (Running)',
        content: 'Notepad is running. Specific file could not be determined.',
      });
    }
  } catch (error) {
    console.warn('[Note Capture] Error capturing Notepad on Windows:', error);
  }

  return sessions;
}

/**
 * Capture Notion on macOS
 */
async function captureNotionMacOS(): Promise<NoteSession[]> {
  const sessions: NoteSession[] = [];

  try {
    // Check if Notion is running
    const { stdout } = await execPromise('ps aux | grep -i "[N]otion" | grep -v grep || true');
    
    if (!stdout || !stdout.trim()) {
      log('[Note Capture] Notion not running on macOS');
      return sessions;
    }

    log('[Note Capture] Notion detected on macOS');

    // Try to get active window title using AppleScript
    try {
      const { stdout: windowTitle } = await execPromise(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' -e 'tell application "Notion" to get name of front window' 2>/dev/null || true`
      );

      const title = windowTitle.trim() || 'Notion';
      
      sessions.push({
        appName: 'Notion',
        title,
        content: `Notion page: ${title}`,
      });
    } catch (error) {
      console.warn('[Note Capture] Could not get Notion window details on macOS:', error);
      sessions.push({
        appName: 'Notion',
        title: 'Notion (Running)',
        content: 'Notion is running on macOS.',
      });
    }
  } catch (error) {
    console.warn('[Note Capture] Error capturing Notion on macOS:', error);
  }

  return sessions;
}

/**
 * Capture Apple Notes on macOS
 */
async function captureAppleNotes(): Promise<NoteSession[]> {
  const sessions: NoteSession[] = [];

  try {
    // Check if Apple Notes is running
    const { stdout } = await execPromise('ps aux | grep -i "[N]otes.app" | grep -v grep || true');
    
    if (!stdout || !stdout.trim()) {
      log('[Note Capture] Apple Notes not running on macOS');
      return sessions;
    }

    log('[Note Capture] Apple Notes detected on macOS');

    // Try to get active note using AppleScript
    try {
      const { stdout: noteTitle } = await execPromise(
        `osascript -e 'tell application "Notes" to get name of front note of front account' 2>/dev/null || echo "Apple Notes (Running)"`
      );

      const title = noteTitle.trim() || 'Apple Notes';
      
      sessions.push({
        appName: 'Apple Notes',
        title,
        content: `Apple Notes: ${title}`,
      });
    } catch (error) {
      console.warn('[Note Capture] Could not get Apple Notes details:', error);
      sessions.push({
        appName: 'Apple Notes',
        title: 'Apple Notes (Running)',
        content: 'Apple Notes is running on macOS.',
      });
    }
  } catch (error) {
    console.warn('[Note Capture] Error capturing Apple Notes on macOS:', error);
  }

  return sessions;
}

