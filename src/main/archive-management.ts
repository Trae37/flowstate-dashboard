/**
 * Archive Management
 * Handles archiving and deleting individual captures, assets, and sessions
 */

import { prepare, saveDatabase } from './database.js';
import { validateId } from './utils/security.js';
import { logger } from './utils/logger.js';

/**
 * Archive a single capture
 */
export function archiveCapture(captureId: number, userId: number): boolean {
  try {
    // Validate inputs
    if (!validateId(captureId) || !validateId(userId)) {
      logger.error(`[Archive] Invalid IDs: captureId=${captureId}, userId=${userId}`);
      return false;
    }

    // Verify ownership
    const capture = prepare(
      'SELECT id FROM captures WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
    ).get(captureId, userId);

    if (!capture) {
      logger.error(`[Archive] Capture ${captureId} not found or not authorized for user ${userId}`);
      return false;
    }

    const now = new Date().toISOString();
    prepare(`
      UPDATE captures
      SET archived = 1, archived_at = ?
      WHERE id = ?
    `).run(now, captureId);

    // Archive all assets in this capture
    prepare(`
      UPDATE assets
      SET archived = 1, archived_at = ?
      WHERE capture_id = ? AND archived = 0
    `).run(now, captureId);

    saveDatabase();
    logger.info(`[Archive] Archived capture ${captureId} and its assets`);
    return true;
  } catch (error) {
    logger.error('[Archive] Error archiving capture:', error);
    return false;
  }
}

/**
 * Unarchive a single capture
 */
export function unarchiveCapture(captureId: number, userId: number): boolean {
  try {
    // Validate inputs
    if (!validateId(captureId) || !validateId(userId)) {
      logger.error(`[Archive] Invalid IDs: captureId=${captureId}, userId=${userId}`);
      return false;
    }

    // Verify ownership
    const capture = prepare(
      'SELECT id FROM captures WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
    ).get(captureId, userId);

    if (!capture) {
      logger.error(`[Archive] Capture ${captureId} not found or not authorized for user ${userId}`);
      return false;
    }

    prepare(`
      UPDATE captures
      SET archived = 0, archived_at = NULL
      WHERE id = ?
    `).run(captureId);

    // Unarchive all assets in this capture
    prepare(`
      UPDATE assets
      SET archived = 0, archived_at = NULL
      WHERE capture_id = ?
    `).run(captureId);

    saveDatabase();
    logger.info(`[Archive] Unarchived capture ${captureId} and its assets`);
    return true;
  } catch (error) {
    logger.error('[Archive] Error unarchiving capture:', error);
    return false;
  }
}

/**
 * Archive a single asset
 */
export function archiveAsset(assetId: number, userId: number): boolean {
  try {
    // Validate inputs
    if (!validateId(assetId) || !validateId(userId)) {
      logger.error(`[Archive] Invalid IDs: assetId=${assetId}, userId=${userId}`);
      return false;
    }

    // Verify ownership through capture
    const asset = prepare(`
      SELECT assets.id, captures.user_id
      FROM assets
      LEFT JOIN captures ON captures.id = assets.capture_id
      WHERE assets.id = ?
    `).get(assetId) as { id: number; user_id: number | null } | null;

    if (!asset) {
      logger.error(`[Archive] Asset ${assetId} not found`);
      return false;
    }

    const ownerId = asset.user_id ?? null;
    if (ownerId && userId !== ownerId) {
      logger.error(`[Archive] Asset ${assetId} not authorized for user ${userId}`);
      return false;
    }

    const now = new Date().toISOString();
    prepare(`
      UPDATE assets
      SET archived = 1, archived_at = ?
      WHERE id = ?
    `).run(now, assetId);

    saveDatabase();
    logger.info(`[Archive] Archived asset ${assetId}`);
    return true;
  } catch (error) {
    logger.error('[Archive] Error archiving asset:', error);
    return false;
  }
}

/**
 * Unarchive a single asset
 */
export function unarchiveAsset(assetId: number, userId: number): boolean {
  try {
    // Validate inputs
    if (!validateId(assetId) || !validateId(userId)) {
      logger.error(`[Archive] Invalid IDs: assetId=${assetId}, userId=${userId}`);
      return false;
    }

    // Verify ownership through capture
    const asset = prepare(`
      SELECT assets.id, captures.user_id
      FROM assets
      LEFT JOIN captures ON captures.id = assets.capture_id
      WHERE assets.id = ?
    `).get(assetId) as { id: number; user_id: number | null } | null;

    if (!asset) {
      logger.error(`[Archive] Asset ${assetId} not found`);
      return false;
    }

    const ownerId = asset.user_id ?? null;
    if (ownerId && userId !== ownerId) {
      logger.error(`[Archive] Asset ${assetId} not authorized for user ${userId}`);
      return false;
    }

    prepare(`
      UPDATE assets
      SET archived = 0, archived_at = NULL
      WHERE id = ?
    `).run(assetId);

    saveDatabase();
    logger.info(`[Archive] Unarchived asset ${assetId}`);
    return true;
  } catch (error) {
    logger.error('[Archive] Error unarchiving asset:', error);
    return false;
  }
}

/**
 * Delete a single asset
 */
export function deleteAsset(assetId: number, userId: number): boolean {
  try {
    // Validate inputs
    if (!validateId(assetId) || !validateId(userId)) {
      logger.error(`[Archive] Invalid IDs: assetId=${assetId}, userId=${userId}`);
      return false;
    }

    // Verify ownership through capture
    const asset = prepare(`
      SELECT assets.id, captures.user_id
      FROM assets
      LEFT JOIN captures ON captures.id = assets.capture_id
      WHERE assets.id = ?
    `).get(assetId) as { id: number; user_id: number | null } | null;

    if (!asset) {
      logger.error(`[Archive] Asset ${assetId} not found`);
      return false;
    }

    const ownerId = asset.user_id ?? null;
    if (ownerId && userId !== ownerId) {
      logger.error(`[Archive] Asset ${assetId} not authorized for user ${userId}`);
      return false;
    }

    prepare('DELETE FROM assets WHERE id = ?').run(assetId);
    saveDatabase();
    logger.info(`[Archive] Deleted asset ${assetId}`);
    return true;
  } catch (error) {
    logger.error('[Archive] Error deleting asset:', error);
    return false;
  }
}

