/**
 * Command Execution Security Utilities
 * Provides safe command execution with input validation
 */

import { sanitizePath } from './security.js';

/**
 * Sanitize command arguments to prevent command injection
 * Only allows safe characters for file paths and simple values
 */
export function sanitizeCommandArg(arg: string): string {
  if (typeof arg !== 'string') {
    throw new Error('Command argument must be a string');
  }

  // Remove dangerous characters that could be used for command injection
  // Allow: alphanumeric, spaces, dots, slashes (both / and \), hyphens, underscores, quotes, colons (for paths)
  const sanitized = arg.replace(/[;&|`$<>(){}[\]]/g, '');

  // Remove null bytes
  return sanitized.replace(/\x00/g, '');
}

/**
 * Safely construct a command with arguments
 * Validates that the command itself is safe and sanitizes all arguments
 */
export function buildSafeCommand(command: string, args: string[]): { command: string; args: string[] } {
  // Validate command is a simple identifier (no path traversal, no special chars)
  const commandPattern = /^[a-zA-Z0-9_-]+$/;
  if (!commandPattern.test(command)) {
    throw new Error(`Invalid command: ${command}`);
  }

  // Sanitize all arguments
  const sanitizedArgs = args.map(arg => {
    // If it looks like a file path, use path sanitization
    if (arg.includes('/') || arg.includes('\\')) {
      return sanitizePath(arg);
    }
    // Otherwise, use general command arg sanitization
    return sanitizeCommandArg(arg);
  });

  return {
    command,
    args: sanitizedArgs,
  };
}

/**
 * Validate that a file path is safe to use in commands
 */
export function validateFilePathForCommand(filePath: string): boolean {
  if (typeof filePath !== 'string') {
    return false;
  }

  // Check for path traversal attempts
  if (filePath.includes('..')) {
    return false;
  }

  // Check for null bytes
  if (filePath.includes('\x00')) {
    return false;
  }

  // Check for command injection attempts
  // Note: Backslashes are allowed for Windows paths, forward slashes for Unix paths
  const dangerousChars = /[;&|`$<>(){}[\]]/;
  if (dangerousChars.test(filePath)) {
    return false;
  }

  return true;
}

/**
 * Validate file path before using with shell.openPath
 * More lenient than command validation since shell.openPath handles paths safely
 */
export function validatePathForShell(filePath: string): boolean {
  if (typeof filePath !== 'string') {
    return false;
  }

  // Check for null bytes
  if (filePath.includes('\x00')) {
    return false;
  }

  // shell.openPath is generally safe, but we should still check for obvious issues
  // Allow paths with .. since shell.openPath will resolve them safely
  // But reject if path is empty or only whitespace
  if (filePath.trim().length === 0) {
    return false;
  }

  return true;
}



