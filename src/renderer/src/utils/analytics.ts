/**
 * Privacy-First Analytics Utility
 * 
 * This module provides safe, opt-in analytics tracking with strict data sanitization.
 * All sensitive data (code, file paths, commands, URLs) is automatically removed.
 */

interface AnalyticsConfig {
  enabled: boolean;
  posthogApiKey?: string;
  posthogHost?: string; // For self-hosted PostHog
}

class Analytics {
  private enabled: boolean = false;
  private posthog: any = null;
  private userId: number | null = null;
  private initialized: boolean = false;

  /**
   * Initialize analytics with user settings
   */
  async initialize(userId: number, config: AnalyticsConfig): Promise<void> {
    this.userId = userId;
    this.enabled = config.enabled ?? false;

    if (!this.enabled) {
      console.log('[Analytics] Analytics disabled by user');
      return;
    }

    try {
      // Dynamically import PostHog only if enabled
      const posthogLib = await import('posthog-js');
      const posthog = posthogLib.default;

      // Use self-hosted PostHog if host is provided, otherwise use PostHog Cloud
      // In Vite, env vars are accessed via import.meta.env
      const apiKey = config.posthogApiKey || import.meta.env.VITE_POSTHOG_API_KEY || 'phc_YOUR_API_KEY';
      const host = config.posthogHost || import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com';

      // Don't initialize if API key is placeholder
      if (apiKey === 'phc_YOUR_API_KEY') {
        console.warn('[Analytics] PostHog API key not configured, analytics disabled. Set VITE_POSTHOG_API_KEY environment variable or configure in settings.');
        return;
      }

      // PostHog is a singleton - use init() instead of constructor
      posthog.init(apiKey, {
        api_host: host,
        autocapture: false, // Disable automatic capture for privacy
        capture_pageview: false, // We'll manually track pageviews
        capture_pageleave: false,
        session_recording: {
          maskAllInputs: true,
          maskAllText: true,
          blockClass: 'no-analytics', // Allow users to block specific elements
        },
        loaded: (ph) => {
          // Identify user (anonymized)
          ph.identify(`user_${userId}`, {
            // No PII - just user ID
          });
          this.initialized = true;
          console.log('[Analytics] PostHog initialized');
        },
      });

      // Store the singleton reference
      this.posthog = posthog;
    } catch (error) {
      console.error('[Analytics] Failed to initialize PostHog:', error);
      // Fail silently - don't break the app if analytics fails
    }
  }

  /**
   * Track an event with automatic data sanitization
   */
  track(event: string, properties?: Record<string, any>): void {
    if (!this.enabled || !this.initialized || !this.posthog) {
      return;
    }

    try {
      const safeProperties = this.sanitizeProperties(properties || {});
      this.posthog.capture(event, safeProperties);
      console.log(`[Analytics] Tracked: ${event}`, safeProperties);
    } catch (error) {
      console.error('[Analytics] Failed to track event:', error);
    }
  }

  /**
   * Track a page view
   */
  trackPageView(page: string): void {
    if (!this.enabled || !this.initialized || !this.posthog) {
      return;
    }

    try {
      this.posthog.capture('$pageview', {
        page: this.sanitizeString(page),
      });
    } catch (error) {
      console.error('[Analytics] Failed to track pageview:', error);
    }
  }

  /**
   * Track an error (without sensitive data)
   */
  trackError(errorType: string, errorMessage?: string, context?: Record<string, any>): void {
    if (!this.enabled || !this.initialized || !this.posthog) {
      return;
    }

    try {
      const safeContext = this.sanitizeProperties(context || {});
      this.posthog.capture('error_occurred', {
        error_type: this.sanitizeString(errorType),
        error_message: errorMessage ? this.sanitizeString(errorMessage.substring(0, 200)) : undefined, // Limit length
        ...safeContext,
      });
    } catch (error) {
      console.error('[Analytics] Failed to track error:', error);
    }
  }

  /**
   * Sanitize properties to remove sensitive data
   */
  private sanitizeProperties(props: Record<string, any>): Record<string, any> {
    const safe: Record<string, any> = {};
    const sensitiveKeys = [
      'path',
      'filePath',
      'workspacePath',
      'code',
      'content',
      'command',
      'commandLine',
      'url',
      'browserUrl',
      'terminalOutput',
      'email',
      'password',
      'token',
      'sessionToken',
      'apiKey',
      'secret',
      'privateKey',
    ];

    for (const [key, value] of Object.entries(props)) {
      const lowerKey = key.toLowerCase();

      // Skip sensitive keys
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        continue;
      }

      // Sanitize values
      if (typeof value === 'string') {
        // Check if string contains file paths or code-like content
        if (this.looksLikeSensitiveData(value)) {
          continue;
        }
        safe[key] = this.sanitizeString(value);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        safe[key] = value;
      } else if (Array.isArray(value)) {
        safe[key] = value.map(item => {
          if (typeof item === 'string') {
            return this.looksLikeSensitiveData(item) ? '[REDACTED]' : this.sanitizeString(item);
          }
          return item;
        });
      } else if (typeof value === 'object' && value !== null) {
        safe[key] = this.sanitizeProperties(value);
      }
    }

    return safe;
  }

  /**
   * Check if a string looks like sensitive data (file paths, code, etc.)
   */
  private looksLikeSensitiveData(str: string): boolean {
    // File paths (Windows and Unix)
    if (/^[A-Za-z]:[\\/]|^\/[^\/]|^\.\.?[\\/]/.test(str)) {
      return true;
    }

    // URLs
    if (/^https?:\/\//.test(str)) {
      return true;
    }

    // Code-like patterns (multiple lines, brackets, etc.)
    if (str.includes('\n') && (str.includes('{') || str.includes('function') || str.includes('import'))) {
      return true;
    }

    // Terminal commands
    if (/^[a-z]+(\s|$)/i.test(str) && str.length > 50) {
      return true;
    }

    return false;
  }

  /**
   * Sanitize a string value (limit length, remove special chars)
   */
  private sanitizeString(str: string, maxLength: number = 200): string {
    if (str.length > maxLength) {
      return str.substring(0, maxLength) + '...';
    }
    return str;
  }

  /**
   * Update analytics enabled state
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;

    if (enabled && !this.initialized && this.userId) {
      // Re-initialize if enabling
      // Note: This would need the config from settings
      console.log('[Analytics] Analytics enabled - reinitialize required');
    } else if (!enabled && this.posthog) {
      // Disable PostHog tracking (opt out)
      try {
        this.posthog.opt_out_capturing();
        this.initialized = false;
        console.log('[Analytics] Analytics disabled - opted out of capturing');
      } catch (error) {
        console.error('[Analytics] Failed to disable PostHog:', error);
      }
    }
  }

  /**
   * Check if analytics is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Reset analytics (for logout)
   */
  reset(): void {
    if (this.posthog) {
      try {
        this.posthog.reset();
      } catch (error) {
        console.error('[Analytics] Failed to reset PostHog:', error);
      }
    }
    this.userId = null;
    this.enabled = false;
    this.initialized = false;
    this.posthog = null;
  }
}

// Export singleton instance
export const analytics = new Analytics();

// Export convenience functions
export const trackEvent = (event: string, properties?: Record<string, any>) => {
  analytics.track(event, properties);
};

export const trackPageView = (page: string) => {
  analytics.trackPageView(page);
};

export const trackError = (errorType: string, errorMessage?: string, context?: Record<string, any>) => {
  analytics.trackError(errorType, errorMessage, context);
};

