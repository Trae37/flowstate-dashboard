/**
 * Centralized Logging Utility
 * Provides structured logging with levels and optional renderer forwarding
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private logToRenderer: ((...args: any[]) => void) | null = null;

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Register a function to forward logs to the renderer process
   */
  setRendererLogger(fn: (...args: any[]) => void): void {
    this.logToRenderer = fn;
  }

  /**
   * Log a debug message
   */
  debug(...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug('[DEBUG]', ...args);
      this.logToRenderer?.('[DEBUG]', ...args);
    }
  }

  /**
   * Log an info message
   */
  info(...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      console.log('[INFO]', ...args);
      this.logToRenderer?.(`[INFO] ${message}`);
    }
  }

  /**
   * Log a warning message
   */
  warn(...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn('[WARN]', ...args);
      this.logToRenderer?.('[WARN]', ...args);
    }
  }

  /**
   * Log an error message
   */
  error(...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error('[ERROR]', ...args);
      this.logToRenderer?.('[ERROR]', ...args);
    }
  }

  /**
   * Safe error logging (handles EPIPE and other errors gracefully)
   */
  safeError(...args: any[]): void {
    try {
      if (this.level <= LogLevel.ERROR) {
        // Try to log, but don't throw if it fails
        try {
          console.error('[ERROR]', ...args);
        } catch {
          // Ignore logging errors (e.g., EPIPE)
        }
        try {
          this.logToRenderer?.('[ERROR]', ...args);
        } catch {
          // Ignore renderer logging errors
        }
      }
    } catch {
      // Completely ignore any errors in error logging
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Set default level based on environment
if (process.env.NODE_ENV === 'development') {
  logger.setLevel(LogLevel.DEBUG);
} else {
  logger.setLevel(LogLevel.INFO);
}



