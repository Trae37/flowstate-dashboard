import { createHash, randomBytes } from 'crypto';
import { prepare } from './database.js';

export interface User {
  id: number;
  email: string;
  username?: string;
  created_at: string;
  last_login?: string;
  onboarding_completed: boolean;
  feature_tour_completed: boolean;
}

export interface Session {
  id: number;
  user_id: number;
  session_token: string;
  created_at: string;
  expires_at: string;
}

/**
 * Hash a password using SHA-256 (simple but secure for local-first app)
 * For production, consider using bcrypt or argon2
 */
function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * Generate a secure random session token
 */
function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Create a new user account
 */
export async function createUser(email: string, password: string, username?: string): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: 'Invalid email format' };
    }

    // Validate password length
    if (password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    // Check if user already exists
    const existingUser = prepare('SELECT id FROM users WHERE email = ?').get(email);
    console.log(`[Auth] Checking for existing user with email: ${email}`);
    console.log(`[Auth] Existing user result:`, existingUser);
    if (existingUser) {
      console.log(`[Auth] User already exists with ID: ${existingUser.id}`);
      return { success: false, error: 'An account with this email already exists' };
    }
    console.log(`[Auth] No existing user found, proceeding with account creation`);

    // Check username if provided
    if (username) {
      const existingUsername = prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existingUsername) {
        return { success: false, error: 'This username is already taken' };
      }
    }

    // Hash password
    const passwordHash = hashPassword(password);

    // Create user
    const result = prepare(`
      INSERT INTO users (email, username, password_hash, onboarding_completed)
      VALUES (?, ?, ?, 0)
    `).run(email, username || null, passwordHash);

    const userId = result.lastInsertRowid as number;

    // Get created user
    const userRow = prepare('SELECT id, email, username, created_at, last_login, onboarding_completed, feature_tour_completed FROM users WHERE id = ?').get(userId) as any;
    const user: User = {
      ...userRow,
      onboarding_completed: userRow.onboarding_completed === 1 || userRow.onboarding_completed === true,
      feature_tour_completed: userRow.feature_tour_completed === 1 || userRow.feature_tour_completed === true,
    };

    console.log(`[Auth] Created user account: ${email} (ID: ${userId})`);

    return { success: true, user };
  } catch (error) {
    console.error('[Auth] Error creating user:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create account' };
  }
}

/**
 * Authenticate user and create session
 */
export async function loginUser(email: string, password: string): Promise<{ success: boolean; session?: Session; user?: User; error?: string }> {
  try {
    // Find user by email
    const userRow = prepare('SELECT id, email, username, password_hash, created_at, last_login, onboarding_completed FROM users WHERE email = ?').get(email) as any;

    if (!userRow) {
      return { success: false, error: 'Invalid email or password' };
    }

    // Verify password
    const passwordHash = hashPassword(password);
    const storedHash = prepare('SELECT password_hash FROM users WHERE id = ?').get(userRow.id) as { password_hash: string } | null;

    if (!storedHash || storedHash.password_hash !== passwordHash) {
      return { success: false, error: 'Invalid email or password' };
    }

    // Create session token
    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    // Create session
    prepare(`
      INSERT INTO sessions (user_id, session_token, expires_at)
      VALUES (?, ?, ?)
    `).run(userRow.id, sessionToken, expiresAt.toISOString());

    // Update last login
    prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userRow.id);

    const session = prepare('SELECT id, user_id, session_token, created_at, expires_at FROM sessions WHERE session_token = ?').get(sessionToken) as Session;

    // Convert user row to User object with proper boolean
    const user: User = {
      id: userRow.id,
      email: userRow.email,
      username: userRow.username,
      created_at: userRow.created_at,
      last_login: userRow.last_login,
      onboarding_completed: userRow.onboarding_completed === 1 || userRow.onboarding_completed === true,
      feature_tour_completed: userRow.feature_tour_completed === 1 || userRow.feature_tour_completed === true,
    };

    console.log(`[Auth] User logged in: ${email} (ID: ${user.id})`);

    return { success: true, session, user };
  } catch (error) {
    console.error('[Auth] Error logging in:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to login' };
  }
}

/**
 * Verify session token and get user
 */
export async function verifySession(sessionToken: string): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    if (!sessionToken) {
      return { success: false, error: 'No session token provided' };
    }

    // Find session and user
    const session = prepare(`
      SELECT s.user_id, u.email, u.username, u.created_at, u.last_login, u.onboarding_completed, u.feature_tour_completed
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_token = ? AND s.expires_at > datetime('now')
    `).get(sessionToken) as any;

    if (!session) {
      return { success: false, error: 'Invalid or expired session' };
    }

    const user: User = {
      id: session.user_id,
      email: session.email,
      username: session.username,
      created_at: session.created_at,
      last_login: session.last_login,
      onboarding_completed: session.onboarding_completed === 1 || session.onboarding_completed === true,
      feature_tour_completed: session.feature_tour_completed === 1 || session.feature_tour_completed === true,
    };

    return { success: true, user };
  } catch (error) {
    console.error('[Auth] Error verifying session:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to verify session' };
  }
}

/**
 * Logout user by deleting session
 */
export async function logoutUser(sessionToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    prepare('DELETE FROM sessions WHERE session_token = ?').run(sessionToken);
    console.log('[Auth] User logged out');
    return { success: true };
  } catch (error) {
    console.error('[Auth] Error logging out:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to logout' };
  }
}

/**
 * Mark onboarding as completed for a user
 */
export async function completeOnboarding(userId: number): Promise<{ success: boolean; error?: string }> {
  try {
    prepare('UPDATE users SET onboarding_completed = 1 WHERE id = ?').run(userId);
    console.log(`[Auth] Onboarding completed for user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error('[Auth] Error completing onboarding:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to complete onboarding' };
  }
}

/**
 * Mark feature tour as completed for a user
 */
export async function completeFeatureTour(userId: number): Promise<{ success: boolean; error?: string }> {
  try {
    prepare('UPDATE users SET feature_tour_completed = 1 WHERE id = ?').run(userId);
    console.log(`[Auth] Feature tour completed for user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error('[Auth] Error completing feature tour:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to complete feature tour' };
  }
}

/**
 * Clean up expired sessions (can be called periodically)
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    console.log(`[Auth] Cleaned up expired sessions`);
  } catch (error) {
    console.error('[Auth] Error cleaning up sessions:', error);
  }
}

/**
 * Delete a user account and all associated data
 * WARNING: This permanently deletes the user and all their data
 */
export async function deleteUser(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Find user
    const user = prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | null;
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Delete user (cascade will delete sessions, captures, assets, settings)
    prepare('DELETE FROM users WHERE id = ?').run(user.id);
    
    console.log(`[Auth] Deleted user account: ${email} (ID: ${user.id})`);
    return { success: true };
  } catch (error) {
    console.error('[Auth] Error deleting user:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete user' };
  }
}

