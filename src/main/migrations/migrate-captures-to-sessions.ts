/**
 * Migration Script: Group Existing Captures by Day into Sessions
 * 
 * This script migrates existing captures (that don't have a session_id) 
 * by grouping them by creation date and assigning them to work sessions.
 * 
 * Run this once after deploying the session feature to organize existing data.
 */

import { prepare, saveDatabase } from '../database.js';
import { logger } from '../utils/logger.js';

interface Capture {
  id: number;
  user_id: number | null;
  created_at: string;
  session_id: number | null;
}

interface SessionGroup {
  dateKey: string;
  userId: number;
  captures: Capture[];
}

/**
 * Migrate captures to sessions by grouping them by day
 */
export function migrateCapturesToSessions(): { success: boolean; sessionsCreated: number; capturesMigrated: number; error?: string } {
  try {
    logger.info('[Migration] Starting capture-to-session migration...');

    // Get all captures without a session_id
    const capturesWithoutSession = prepare(`
      SELECT id, user_id, created_at, session_id
      FROM captures
      WHERE session_id IS NULL
      ORDER BY user_id, created_at
    `).all() as unknown as Capture[];

    if (capturesWithoutSession.length === 0) {
      logger.info('[Migration] No captures to migrate');
      return { success: true, sessionsCreated: 0, capturesMigrated: 0 };
    }

    logger.info(`[Migration] Found ${capturesWithoutSession.length} captures to migrate`);

    // Group captures by user and date
    const groupsByUserAndDate = new Map<string, SessionGroup>();

    for (const capture of capturesWithoutSession) {
      const userId = capture.user_id || 0; // Use 0 for null user_id
      const date = new Date(capture.created_at);
      const dateKey = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const groupKey = `${userId}-${dateKey}`;

      if (!groupsByUserAndDate.has(groupKey)) {
        groupsByUserAndDate.set(groupKey, {
          dateKey,
          userId,
          captures: [],
        });
      }

      groupsByUserAndDate.get(groupKey)!.captures.push(capture);
    }

    logger.info(`[Migration] Grouped into ${groupsByUserAndDate.size} date-based groups`);

    let sessionsCreated = 0;
    let capturesMigrated = 0;

    // Create sessions and assign captures
    for (const [, group] of groupsByUserAndDate.entries()) {
      // Create a session for this date group
      const sessionName = `Work Period - ${group.dateKey}`;
      
      const sessionResult = prepare(`
        INSERT INTO work_sessions (user_id, name, created_at)
        VALUES (?, ?, datetime('now'))
      `).run(group.userId, sessionName);

      const sessionId = sessionResult.lastInsertRowid as number;
      sessionsCreated++;

      // Update all captures in this group to use the new session
      for (const capture of group.captures) {
        prepare(`
          UPDATE captures
          SET session_id = ?
          WHERE id = ?
        `).run(sessionId, capture.id);
        capturesMigrated++;
      }

      logger.info(`[Migration] Created session "${sessionName}" (ID: ${sessionId}) with ${group.captures.length} captures`);
    }

    saveDatabase();

    logger.info(`[Migration] Complete! Created ${sessionsCreated} sessions, migrated ${capturesMigrated} captures`);
    return { success: true, sessionsCreated, capturesMigrated };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[Migration] Error during migration:', errorMessage);
    return { success: false, sessionsCreated: 0, capturesMigrated: 0, error: errorMessage };
  }
}

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  try {
    const capturesWithoutSession = prepare(`
      SELECT COUNT(*) as count
      FROM captures
      WHERE session_id IS NULL
    `).get() as { count: number } | null;

    return (capturesWithoutSession?.count || 0) > 0;
  } catch (error) {
    logger.error('[Migration] Error checking migration status:', error);
    return false;
  }
}

