import { createHash, randomBytes } from 'crypto';
import { prepare } from './database.js';
import { validateEmail, validatePassword, validateUsername, sanitizeString } from './utils/security.js';

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
    // Sanitize and validate inputs
    const sanitizedEmail = sanitizeString(email.toLowerCase().trim(), 254);
    if (!validateEmail(sanitizedEmail)) {
      return { success: false, error: 'Invalid email format' };
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error || 'Invalid password' };
    }

    // Validate username if provided
    if (username) {
      const sanitizedUsername = sanitizeString(username.trim(), 30);
      if (!validateUsername(sanitizedUsername)) {
        return { success: false, error: 'Username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens' };
      }
      username = sanitizedUsername;
    }

    // Check if user already exists
    const existingUser = prepare('SELECT id FROM users WHERE email = ?').get(sanitizedEmail);
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
    `).run(sanitizedEmail, username || null, passwordHash);

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
    // Sanitize email
    const sanitizedEmail = sanitizeString(email.toLowerCase().trim(), 254);
    if (!validateEmail(sanitizedEmail)) {
      return { success: false, error: 'Invalid email format' };
    }

    // Find user by email
    const userRow = prepare('SELECT id, email, username, password_hash, created_at, last_login, onboarding_completed FROM users WHERE email = ?').get(sanitizedEmail) as any;

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

    // Create a new work session for the user on login if they don't have an active one
    // Note: We do NOT automatically archive existing sessions - archiving is manual only
    try {
      const { getUserWorkSessions, createWorkSession } = await import('./session-management.js');
      const existingSessions = getUserWorkSessions(userRow.id, false); // Get non-archived sessions
      
      // Only create a new session if the user doesn't have any active sessions
      // This allows users to continue their work across login sessions
      if (existingSessions.length === 0) {
        createWorkSession(userRow.id);
        console.log(`[Auth] Created new work session for user ${userRow.id} on login`);
      } else {
        console.log(`[Auth] User ${userRow.id} already has ${existingSessions.length} active session(s), not creating new one`);
      }
    } catch (sessionError) {
      // Don't fail login if session management fails
      console.warn('[Auth] Error managing sessions on login:', sessionError);
    }

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
 * Also archives the current work session if it exists and has captures
 */
export async function logoutUser(sessionToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Get user ID from session before deleting it
    const session = prepare('SELECT user_id FROM sessions WHERE session_token = ?').get(sessionToken) as { user_id: number } | null;
    
    if (session) {
      const userId = session.user_id;
      
      // Archive the current work session if it exists and has captures
      try {
        const { getCurrentWorkSession, archiveWorkSession } = await import('./session-management.js');
        const currentSession = getCurrentWorkSession(userId);
        
        // Only archive if the session has captures (to avoid archiving empty sessions)
        if (currentSession.capture_count && currentSession.capture_count > 0) {
          archiveWorkSession(currentSession.id!);
          console.log(`[Auth] Archived work session ${currentSession.id} on logout`);
        }
      } catch (sessionError) {
        // Don't fail logout if session archiving fails
        console.warn('[Auth] Error archiving session on logout:', sessionError);
      }
    }
    
    // Delete the auth session
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

