/**
 * License Management System
 * Validates license keys and manages trial periods
 */

import { app } from 'electron';
import * as crypto from 'crypto';
import { prepare } from '../database.js';

const LICENSE_SERVER_URL = 'https://your-license-server.com/api'; // Replace with your server
const TRIAL_DAYS = 14;

export interface LicenseInfo {
  key: string;
  email: string;
  activatedAt: string;
  expiresAt?: string;
  type: 'trial' | 'personal' | 'professional' | 'enterprise';
  isValid: boolean;
}

/**
 * Generate a license key (SERVER-SIDE ONLY - for your license server)
 * This is just an example - implement this on your backend
 */
function generateLicenseKey(email: string, productId: string, secret: string): string {
  const data = `${email}|${productId}|${Date.now()}`;
  const hash = crypto.createHmac('sha256', secret).update(data).digest('hex');

  // Format: XXXX-XXXX-XXXX-XXXX
  const key = hash.substring(0, 16).toUpperCase();
  return `${key.slice(0, 4)}-${key.slice(4, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}`;
}

/**
 * Validate license key format (client-side basic check)
 */
function validateLicenseKeyFormat(key: string): boolean {
  // Format: XXXX-XXXX-XXXX-XXXX
  const regex = /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/;
  return regex.test(key);
}

/**
 * Check if license is valid (online verification)
 */
export async function validateLicenseOnline(licenseKey: string, email: string): Promise<{ valid: boolean; error?: string; info?: LicenseInfo }> {
  try {
    const response = await fetch(`${LICENSE_SERVER_URL}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey,
        email,
        machineId: getMachineId(),
        appVersion: app.getVersion(),
      }),
    });

    if (!response.ok) {
      return { valid: false, error: 'License server unavailable' };
    }

    const data = await response.json();

    if (data.valid) {
      // Store license locally after successful validation
      storeLicenseLocally(licenseKey, email, data.info);
    }

    return data;
  } catch (error) {
    console.error('[License] Online validation failed:', error);
    // Fallback to offline validation
    return validateLicenseOffline(licenseKey);
  }
}

/**
 * Get unique machine ID (for license activation limits)
 */
function getMachineId(): string {
  const { machineId } = require('node-machine-id');
  try {
    return machineId.machineIdSync();
  } catch {
    // Fallback: use app path hash
    return crypto.createHash('md5').update(app.getPath('exe')).digest('hex');
  }
}

/**
 * Store license information locally
 */
function storeLicenseLocally(licenseKey: string, email: string, info: any): void {
  try {
    const stmt = prepare(`
      INSERT OR REPLACE INTO licenses (license_key, email, activated_at, expires_at, license_type, is_valid)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      licenseKey,
      email,
      info.activatedAt || new Date().toISOString(),
      info.expiresAt,
      info.type || 'personal',
      1
    );
  } catch (error) {
    console.error('[License] Failed to store license locally:', error);
  }
}

/**
 * Validate license offline (grace period if server is down)
 */
function validateLicenseOffline(licenseKey: string): { valid: boolean; error?: string; info?: LicenseInfo } {
  try {
    const result = prepare('SELECT * FROM licenses WHERE license_key = ? AND is_valid = 1').get(licenseKey) as any;

    if (!result) {
      return { valid: false, error: 'License not found. Please activate online.' };
    }

    // Check if expired
    if (result.expires_at) {
      const expiresAt = new Date(result.expires_at);
      if (expiresAt < new Date()) {
        return { valid: false, error: 'License has expired' };
      }
    }

    // Offline validation success (with grace period)
    const lastValidated = new Date(result.last_validated || result.activated_at);
    const gracePeriodDays = 7; // Allow 7 days offline
    const gracePeriodEnd = new Date(lastValidated);
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays);

    if (new Date() > gracePeriodEnd) {
      return { valid: false, error: 'Please connect to the internet to verify your license' };
    }

    return {
      valid: true,
      info: {
        key: result.license_key,
        email: result.email,
        activatedAt: result.activated_at,
        expiresAt: result.expires_at,
        type: result.license_type,
        isValid: true,
      },
    };
  } catch (error) {
    console.error('[License] Offline validation failed:', error);
    return { valid: false, error: 'License validation error' };
  }
}

/**
 * Check if trial period is active
 */
export function getTrialStatus(): { active: boolean; daysRemaining: number; startedAt?: string } {
  try {
    const result = prepare('SELECT * FROM trial_info WHERE id = 1').get() as any;

    if (!result) {
      // First launch - start trial
      const now = new Date().toISOString();
      prepare('INSERT INTO trial_info (id, started_at) VALUES (1, ?)').run(now);
      return { active: true, daysRemaining: TRIAL_DAYS, startedAt: now };
    }

    const startedAt = new Date(result.started_at);
    const expiresAt = new Date(startedAt);
    expiresAt.setDate(expiresAt.getDate() + TRIAL_DAYS);

    const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    return {
      active: daysRemaining > 0,
      daysRemaining: Math.max(0, daysRemaining),
      startedAt: result.started_at,
    };
  } catch (error) {
    console.error('[License] Trial status check failed:', error);
    return { active: false, daysRemaining: 0 };
  }
}

/**
 * Get current license status
 */
export async function getLicenseStatus(): Promise<{ licensed: boolean; trial: boolean; daysRemaining?: number; licenseInfo?: LicenseInfo }> {
  // Check for active license
  try {
    const licenseResult = prepare('SELECT * FROM licenses WHERE is_valid = 1 ORDER BY activated_at DESC LIMIT 1').get() as any;

    if (licenseResult) {
      // Validate license periodically
      const lastCheck = new Date(licenseResult.last_validated || 0);
      const hoursSinceCheck = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);

      if (hoursSinceCheck > 24) {
        // Revalidate online every 24 hours
        const validation = await validateLicenseOnline(licenseResult.license_key, licenseResult.email);
        if (validation.valid) {
          // Update last validated timestamp
          prepare('UPDATE licenses SET last_validated = ? WHERE license_key = ?')
            .run(new Date().toISOString(), licenseResult.license_key);
        }
      }

      return {
        licensed: true,
        trial: false,
        licenseInfo: {
          key: licenseResult.license_key,
          email: licenseResult.email,
          activatedAt: licenseResult.activated_at,
          expiresAt: licenseResult.expires_at,
          type: licenseResult.license_type,
          isValid: true,
        },
      };
    }
  } catch (error) {
    console.error('[License] License check failed:', error);
  }

  // No license - check trial status
  const trialStatus = getTrialStatus();

  return {
    licensed: false,
    trial: trialStatus.active,
    daysRemaining: trialStatus.daysRemaining,
  };
}

/**
 * Activate license with key
 */
export async function activateLicense(licenseKey: string, email: string): Promise<{ success: boolean; error?: string }> {
  // Validate format
  if (!validateLicenseKeyFormat(licenseKey)) {
    return { success: false, error: 'Invalid license key format' };
  }

  // Validate online
  const validation = await validateLicenseOnline(licenseKey, email);

  if (!validation.valid) {
    return { success: false, error: validation.error || 'License validation failed' };
  }

  return { success: true };
}

/**
 * Deactivate license (for machine transfers)
 */
export async function deactivateLicense(licenseKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Notify server
    await fetch(`${LICENSE_SERVER_URL}/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey,
        machineId: getMachineId(),
      }),
    });

    // Remove local license
    prepare('DELETE FROM licenses WHERE license_key = ?').run(licenseKey);

    return { success: true };
  } catch (error) {
    console.error('[License] Deactivation failed:', error);
    return { success: false, error: 'Failed to deactivate license' };
  }
}
