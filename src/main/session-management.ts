/**
 * Work Session Management
 * Handles creation, switching, archiving, and deletion of work sessions
 */

import { prepare, getAllSettings } from './database.js';
import { validateId, sanitizeString } from './utils/security.js';
import { logger } from './utils/logger.js';

export interface WorkSession {
  id: number;
  user_id: number;
  name: string;
  description?: string;
  created_at: string;
  archived: boolean;
  archived_at?: string;
  auto_recovered: boolean;
  capture_count?: number; // Computed field
}

/**
 * Create a new work session
 */
export function createWorkSession(
  userId: number,
  name?: string,
  description?: string
): WorkSession {
  // Validate userId
  if (!validateId(userId)) {
    throw new Error(`Invalid userId: ${userId}`);
  }

  // Sanitize and validate name if provided
  if (name) {
    name = sanitizeString(name.trim(), 100);
    if (name.length === 0) {
      name = undefined; // Treat empty string as undefined
    }
  }

  // Auto-generate name if not provided
  if (!name) {
    // Get user's timezone preference for consistent date formatting
    const userSettings = getAllSettings(userId);
    let userTimezone: string;
    
    try {
      userTimezone = userSettings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Validate timezone is valid
      if (!userTimezone || typeof userTimezone !== 'string') {
        userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
    } catch (error) {
      // Fallback to system timezone if there's any error
      userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    
    // Always use the current date/time - create a fresh Date object
    // Use Date.now() to ensure we get the absolute current time
    const now = new Date(Date.now());
    const systemTimeISO = now.toISOString();
    const systemTimeLocal = now.toString();
    
    // Verify the date is reasonable (not in the past by more than a day)
    const currentYear = now.getFullYear();
    if (currentYear < 2024 || currentYear > 2030) {
      logger.error(`[Session Management] Suspicious system date detected: ${systemTimeISO}. Using fallback date calculation.`);
    }
    
    // Use the user's timezone to format the date for the session name
    let dateStr: string;
    try {
      dateStr = new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(now);
      
      // Verify the formatted date is reasonable
      if (!dateStr || dateStr.length < 10) {
        throw new Error('Invalid date format');
      }
    } catch (error) {
      // Fallback to local date if timezone formatting fails
      logger.warn(`[Session Management] Timezone formatting failed, using local date. Error: ${error}`);
      dateStr = now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    
    name = `Work Period - ${dateStr}`;
    
    // Detailed logging to debug date issues
    logger.info(`[Session Management] Creating new session - System time (ISO): ${systemTimeISO}, System time (local): ${systemTimeLocal}, User timezone: ${userTimezone}, Formatted date: ${dateStr}, Session name: ${name}`);
  }

  // Sanitize description if provided
  const sanitizedDescription = description ? sanitizeString(description.trim(), 500) : null;

  // Store timestamp in ISO format with timezone to avoid timezone confusion
  // This ensures consistent timezone handling regardless of SQLite implementation
  const now = new Date();
  const isoTimestamp = now.toISOString(); // Format: "2025-01-15T14:30:00.000Z"
  
  const result = prepare(`
    INSERT INTO work_sessions (user_id, name, description, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, name, sanitizedDescription, isoTimestamp);

  const sessionId = result.lastInsertRowid as number;

  return getWorkSession(sessionId)!;
}

/**
 * Get a work session by ID
 */
export function getWorkSession(sessionId: number): WorkSession | null {
  // Validate input
  if (!validateId(sessionId)) {
    logger.error(`[Session Management] Invalid sessionId: ${sessionId}`);
    return null;
  }

  const row = prepare(`
    SELECT 
      ws.*,
      COUNT(c.id) as capture_count
    FROM work_sessions ws
    LEFT JOIN captures c ON c.session_id = ws.id AND c.archived = 0
    WHERE ws.id = ?
    GROUP BY ws.id
  `).get(sessionId) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    id: row.id as number,
    user_id: row.user_id as number,
    name: row.name as string,
    description: row.description as string | undefined,
    created_at: row.created_at as string,
    archived: row.archived === 1 || row.archived === true,
    archived_at: (row.archived_at as string | undefined) || undefined,
    auto_recovered: row.auto_recovered === 1 || row.auto_recovered === true,
    capture_count: (row.capture_count as number) || 0,
  };
}

/**
 * Get all work sessions for a user (excluding archived by default)
 */
export function getUserWorkSessions(
  userId: number,
  includeArchived: boolean = false
): WorkSession[] {
  let query = `
    SELECT 
      ws.*,
      COUNT(CASE WHEN c.archived = 0 THEN c.id END) as capture_count
    FROM work_sessions ws
    LEFT JOIN captures c ON c.session_id = ws.id
    WHERE ws.user_id = ?
  `;

  if (!includeArchived) {
    query += ` AND ws.archived = 0`;
  }

  query += ` GROUP BY ws.id ORDER BY ws.created_at DESC`;

  const rows = prepare(query).all(userId) as any[];

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    archived: row.archived === 1 || row.archived === true,
    archived_at: row.archived_at || undefined,
    auto_recovered: row.auto_recovered === 1 || row.auto_recovered === true,
    capture_count: row.capture_count || 0,
  }));
}

/**
 * Get the current active session for a user
 * Returns the most recent non-archived session from today, or creates a new one if none exists
 * Automatically creates a new session when the clock hits midnight (12:00 AM)
 * @returns Object with the session and a flag indicating if a new session was created due to day change
 */
export function getCurrentWorkSession(userId: number): WorkSession & { wasNewDaySession?: boolean } {
  // Get user's timezone preference, or use system default
  const userSettings = getAllSettings(userId);
  const userTimezone = userSettings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Get today's date in the user's timezone (YYYY-MM-DD format)
  const now = new Date();
  const todayInUserTz = new Intl.DateTimeFormat('en-CA', {
    timeZone: userTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  // Debug logging
  logger.info(`[Session Management] Current date check - System time: ${now.toISOString()}, User timezone: ${userTimezone}, Today in user TZ: ${todayInUserTz}`);

  // Try to get the most recent non-archived session
  const row = prepare(`
    SELECT 
      ws.*,
      COUNT(CASE WHEN c.archived = 0 THEN c.id END) as capture_count
    FROM work_sessions ws
    LEFT JOIN captures c ON c.session_id = ws.id
    WHERE ws.user_id = ? AND ws.archived = 0
    GROUP BY ws.id
    ORDER BY ws.created_at DESC
    LIMIT 1
  `).get(userId) as any;

  if (row) {
    // Parse the session's created_at date (stored in UTC)
    // SQLite format: "YYYY-MM-DD HH:MM:SS" (UTC)
    const sessionCreatedAt = row.created_at;
    let sessionDate: Date;
    
    // Check if it's already in ISO format with timezone
    if (sessionCreatedAt.includes('Z') || sessionCreatedAt.match(/[+-]\d{2}:?\d{2}$/)) {
      sessionDate = new Date(sessionCreatedAt);
    } else {
      // SQLite format without timezone - treat as UTC by appending 'Z'
      const utcString = sessionCreatedAt.replace(' ', 'T') + 'Z';
      sessionDate = new Date(utcString);
    }

    // Get the session's date in the user's timezone (YYYY-MM-DD format)
    const sessionDateInUserTz = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(sessionDate);

    // Debug logging
    logger.info(`[Session Management] Session date check - Session created_at (raw): ${sessionCreatedAt}, Parsed as UTC: ${sessionDate.toISOString()}, Session date in user TZ: ${sessionDateInUserTz}, Today in user TZ: ${todayInUserTz}`);

    // Check if the session is from today
    if (sessionDateInUserTz === todayInUserTz) {
      // Session is from today, return it
      return {
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        description: row.description,
        created_at: row.created_at,
        archived: row.archived === 1 || row.archived === true,
        archived_at: row.archived_at || undefined,
        auto_recovered: row.auto_recovered === 1 || row.auto_recovered === true,
        capture_count: row.capture_count || 0,
      };
    } else {
      // Session is from a previous day, create a new session for today
      logger.info(`[Session Management] Session ${row.id} is from ${sessionDateInUserTz}, creating new session for ${todayInUserTz}`);
      logger.info(`[Session Management] Session name was: "${row.name}", will create new session for today`);
      const newSession = createWorkSession(userId);
      logger.info(`[Session Management] Created new session: ${newSession.id} with name: "${newSession.name}"`);
      
      // Trigger automatic capture for the new day session (if auto-save is enabled)
      // Do this asynchronously to not block the session creation
      setImmediate(async () => {
        try {
          const { getAllSettings } = await import('./database.js');
          const userSettings = getAllSettings(userId);
          const autoSaveEnabled = userSettings.autoSaveEnabled === 'true';
          
          if (autoSaveEnabled) {
            logger.info(`[Session Management] Auto-save enabled, triggering automatic capture for new day session ${newSession.id}`);
            const { captureWorkspace } = await import('./capture.js');
            await captureWorkspace(undefined, userId, newSession.id);
            logger.info(`[Session Management] Automatic capture completed for new day session ${newSession.id}`);
          } else {
            logger.info(`[Session Management] Auto-save disabled, skipping automatic capture for new day session ${newSession.id}`);
          }
        } catch (error) {
          logger.error(`[Session Management] Failed to automatically capture for new day session:`, error);
        }
      });
      
      // Mark that this is a new day session (created due to midnight transition)
      return { ...newSession, wasNewDaySession: true };
    }
  }

  // No active session found, create a new one
  const newSession = createWorkSession(userId);
  return { ...newSession, wasNewDaySession: false }; // Not a day-change, just first session
}

/**
 * Update work session name and description
 */
export function updateWorkSession(
  sessionId: number,
  name?: string,
  description?: string
): boolean {
  if (name !== undefined && description !== undefined) {
    prepare(`
      UPDATE work_sessions
      SET name = ?, description = ?
      WHERE id = ?
    `).run(name, description || null, sessionId);
  } else if (name !== undefined) {
    prepare(`
      UPDATE work_sessions
      SET name = ?
      WHERE id = ?
    `).run(name, sessionId);
  } else if (description !== undefined) {
    prepare(`
      UPDATE work_sessions
      SET description = ?
      WHERE id = ?
    `).run(description || null, sessionId);
  } else {
    return false;
  }

  return true;
}

/**
 * Archive a work session
 * This will also archive all captures and assets in the session
 * (replacing any individual component archives from the same session)
 * 
 * Archive hierarchy: When archiving a session, it replaces any individual
 * component archives from the same session to avoid confusion.
 */
export function archiveWorkSession(sessionId: number): boolean {
  const now = new Date().toISOString();

  // Start transaction-like behavior
  try {
    // Archive the session
    prepare(`
      UPDATE work_sessions
      SET archived = 1, archived_at = ?
      WHERE id = ?
    `).run(now, sessionId);

    // Archive all captures in this session (including already archived ones to ensure consistency)
    // This replaces any individual capture archives from the same session
    prepare(`
      UPDATE captures
      SET archived = 1, archived_at = ?
      WHERE session_id = ?
    `).run(now, sessionId);

    // Archive all assets in captures from this session (including already archived ones)
    // This replaces any individual asset archives from the same session
    prepare(`
      UPDATE assets
      SET archived = 1, archived_at = ?
      WHERE capture_id IN (
        SELECT id FROM captures WHERE session_id = ?
      )
    `).run(now, sessionId);

    logger.info(`[Session Management] Archived session ${sessionId} and all its captures/assets (replaced individual archives)`);
    return true;
  } catch (error) {
    logger.error('[Session Management] Error archiving session:', error);
    return false;
  }
}

/**
 * Delete a work session and all its captures/assets
 */
export function deleteWorkSession(sessionId: number): boolean {
  try {
    // Delete the session (cascade will delete captures and assets)
    prepare('DELETE FROM work_sessions WHERE id = ?').run(sessionId);
    return true;
  } catch (error) {
    logger.error('[Session Management] Error deleting session:', error);
    return false;
  }
}

/**
 * Mark a session as auto-recovered
 */
export function markSessionAsAutoRecovered(sessionId: number): boolean {
  try {
    prepare(`
      UPDATE work_sessions
      SET auto_recovered = 1
      WHERE id = ?
    `).run(sessionId);
    return true;
  } catch (error) {
    logger.error('[Session Management] Error marking session as auto-recovered:', error);
    return false;
  }
}

/**
 * Get auto-recovered sessions for a user
 */
export function getAutoRecoveredSessions(userId: number): WorkSession[] {
  return getUserWorkSessions(userId, true).filter(
    (session) => session.auto_recovered && !session.archived
  );
}

/**
 * Check for unexpected shutdown and mark last active session as auto-recovered
 * This should be called on app startup to detect if the app was closed unexpectedly
 * (e.g., computer crash, power failure, force quit)
 */
export function checkAndMarkAutoRecovery(userId: number): WorkSession | null {
  try {
    // Get the most recent non-archived session that hasn't been marked as auto-recovered
    const row = prepare(`
      SELECT 
        ws.*,
        COUNT(CASE WHEN c.archived = 0 THEN c.id END) as capture_count
      FROM work_sessions ws
      LEFT JOIN captures c ON c.session_id = ws.id
      WHERE ws.user_id = ? 
        AND ws.archived = 0 
        AND ws.auto_recovered = 0
      GROUP BY ws.id
      ORDER BY ws.created_at DESC
      LIMIT 1
    `).get(userId) as any;

    if (!row) {
      // No active session to recover
      return null;
    }

    // Check if session was created recently (within last 24 hours)
    // This helps avoid marking very old sessions as auto-recovered
    const sessionDate = new Date(row.created_at);
    const now = new Date();
    const hoursSinceCreation = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60);

    if (hoursSinceCreation > 24) {
      // Session is too old, don't mark as auto-recovered
      return null;
    }

    // Mark this session as auto-recovered
    markSessionAsAutoRecovered(row.id);

    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      description: row.description,
      created_at: row.created_at,
      archived: row.archived === 1 || row.archived === true,
      archived_at: row.archived_at || undefined,
      auto_recovered: true,
      capture_count: row.capture_count || 0,
    };
  } catch (error) {
    logger.error('[Session Management] Error checking auto-recovery:', error);
    return null;
  }
}

/**
 * Check auto-recovery for all users (called on app startup)
 */
export function checkAutoRecoveryForAllUsers(): void {
  try {
    // Get all users with active sessions
    const users = prepare(`
      SELECT DISTINCT user_id 
      FROM work_sessions 
      WHERE archived = 0 AND auto_recovered = 0
    `).all() as { user_id: number }[];

    for (const user of users) {
      const recoveredSession = checkAndMarkAutoRecovery(user.user_id);
      if (recoveredSession) {
        logger.info(`[Session Management] Marked session ${recoveredSession.id} as auto-recovered for user ${user.user_id}`);
      }
    }
  } catch (error) {
    logger.error('[Session Management] Error checking auto-recovery for all users:', error);
  }
}

