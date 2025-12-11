/**
 * Security Utilities
 * Provides input validation, sanitization, and security helpers
 */

/**
 * Validate and sanitize string input for SQL queries
 * Prevents SQL injection by ensuring only safe characters
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }

  // Trim and limit length
  let sanitized = input.trim().slice(0, maxLength);

  // Remove null bytes and control characters (except newlines/tabs for content)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  return sanitized;
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  
  // RFC 5322 compliant email regex (simplified)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 254; // RFC 5321 max length
}

/**
 * Validate username format
 */
export function validateUsername(username: string): boolean {
  if (typeof username !== 'string') return false;
  
  // Username: 3-30 chars, alphanumeric, underscore, hyphen
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  return usernameRegex.test(username);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Password must be less than 128 characters' };
  }

  // Check for common weak passwords
  const commonPasswords = ['password', '12345678', 'qwerty', 'abc123'];
  if (commonPasswords.includes(password.toLowerCase())) {
    return { valid: false, error: 'Password is too common' };
  }

  return { valid: true };
}

/**
 * Validate numeric ID (positive integer)
 */
export function validateId(id: any): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

/**
 * Validate session token format
 */
export function validateSessionToken(token: string): boolean {
  if (typeof token !== 'string') return false;
  
  // Session tokens should be 64 hex characters (32 bytes = 64 hex chars)
  const tokenRegex = /^[a-f0-9]{64}$/i;
  return tokenRegex.test(token);
}

/**
 * Sanitize file path to prevent directory traversal
 */
export function sanitizePath(filePath: string): string {
  if (typeof filePath !== 'string') {
    throw new Error('Path must be a string');
  }

  // Remove null bytes
  let sanitized = filePath.replace(/\x00/g, '');

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove directory traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');

  // Remove leading/trailing slashes
  sanitized = sanitized.replace(/^\/+|\/+$/g, '');

  return sanitized;
}

/**
 * Validate URL to ensure it's safe to open
 * Only allows http, https, and specific browser schemes
 */
export function validateUrl(url: string): boolean {
  if (typeof url !== 'string') {
    return false;
  }

  // Remove whitespace
  const trimmed = url.trim();
  
  if (trimmed.length === 0) {
    return false;
  }

  // Check for dangerous schemes
  const dangerousSchemes = [
    'javascript:',
    'data:',
    'vbscript:',
    'file:',
    'about:',
    'chrome-extension:',
    'moz-extension:',
  ];

  const lowerUrl = trimmed.toLowerCase();
  for (const scheme of dangerousSchemes) {
    if (lowerUrl.startsWith(scheme)) {
      return false;
    }
  }

  // Allow http, https, and browser-specific schemes (chrome://, edge://, brave://)
  // These are needed for browser restoration
  const allowedSchemes = [
    'http://',
    'https://',
    'chrome://',
    'edge://',
    'brave://',
  ];

  const hasAllowedScheme = allowedSchemes.some(scheme => lowerUrl.startsWith(scheme));
  
  // For browser-specific schemes, we'll allow them but they're filtered out elsewhere
  // For external opening, only allow http/https
  return hasAllowedScheme;
}

/**
 * Validate URL for external opening (only http/https)
 */
export function validateExternalUrl(url: string): boolean {
  if (typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim().toLowerCase();
  
  // Only allow http and https for external opening
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/**
 * Sanitize process name for use in command-line tools
 * Prevents command injection in process name lookups
 */
export function sanitizeProcessName(processName: string): string {
  if (typeof processName !== 'string') {
    throw new Error('Process name must be a string');
  }

  // Only allow alphanumeric, dots, underscores, hyphens, and spaces
  // This matches typical process names like "chrome.exe", "msedge.exe"
  const sanitized = processName.replace(/[^a-zA-Z0-9._\-\s]/g, '');
  
  // Remove null bytes
  return sanitized.replace(/\x00/g, '');
}

/**
 * Validate and sanitize SQL parameter
 * Ensures parameter is safe for SQL queries
 */
export function sanitizeSqlParam(param: any): string | number | null {
  if (param === null || param === undefined) {
    return null;
  }

  if (typeof param === 'number') {
    // Validate it's a finite number
    if (!Number.isFinite(param)) {
      throw new Error('Invalid number parameter');
    }
    return param;
  }

  if (typeof param === 'string') {
    // Escape single quotes for SQL
    return param.replace(/'/g, "''");
  }

  if (typeof param === 'boolean') {
    return param ? 1 : 0;
  }

  throw new Error(`Unsupported parameter type: ${typeof param}`);
}

/**
 * Rate limiting helper (simple in-memory implementation)
 * For production, consider using Redis or a proper rate limiting library
 */
class RateLimiter {
  private attempts: Map<string, { count: number; resetAt: number }> = new Map();
  private readonly windowMs: number;
  private readonly maxAttempts: number;

  constructor(windowMs: number, maxAttempts: number) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
  }

  check(key: string): boolean {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record || now > record.resetAt) {
      // Reset or create new record
      this.attempts.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return true;
    }

    if (record.count >= this.maxAttempts) {
      return false; // Rate limit exceeded
    }

    record.count++;
    return true;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

// Create rate limiters for different operations
export const loginRateLimiter = new RateLimiter(15 * 60 * 1000, 5); // 5 attempts per 15 minutes
export const signupRateLimiter = new RateLimiter(60 * 60 * 1000, 3); // 3 attempts per hour
export const captureRateLimiter = new RateLimiter(60 * 1000, 10); // 10 captures per minute



