/**
 * Date formatting utilities with consistent timezone handling
 */

/**
 * Get the user's current timezone
 */
export function getCurrentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    // Fallback to UTC if timezone detection fails
    return 'UTC';
  }
}

/**
 * Get timezone offset string (e.g., "UTC-5", "UTC+2")
 */
export function getTimezoneOffset(): string {
  try {
    const offset = -new Date().getTimezoneOffset() / 60;
    const sign = offset >= 0 ? '+' : '';
    return `UTC${sign}${offset}`;
  } catch (error) {
    return 'UTC';
  }
}

/**
 * Get a formatted timezone string (e.g., "America/New_York (UTC-5)")
 */
export function getFormattedTimezone(timezone?: string): string {
  try {
    const tz = timezone || getCurrentTimezone();
    const offset = getTimezoneOffsetForTimezone(tz);
    return `${tz} (${offset})`;
  } catch (error) {
    return 'UTC';
  }
}

/**
 * Get timezone offset for a specific timezone
 */
export function getTimezoneOffsetForTimezone(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(part => part.type === 'timeZoneName');
    
    if (offsetPart) {
      // Format: "GMT-5" or "GMT+2" -> convert to "UTC-5" or "UTC+2"
      return offsetPart.value.replace('GMT', 'UTC');
    }
    
    // Fallback: calculate offset manually
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const offset = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60);
    const sign = offset >= 0 ? '+' : '';
    return `UTC${sign}${offset}`;
  } catch (error) {
    return 'UTC';
  }
}

/**
 * Get a list of common timezones grouped by region
 */
export function getCommonTimezones(): Array<{ region: string; timezones: Array<{ value: string; label: string }> }> {
  return [
    {
      region: 'Americas',
      timezones: [
        { value: 'America/New_York', label: 'Eastern Time (US & Canada)' },
        { value: 'America/Chicago', label: 'Central Time (US & Canada)' },
        { value: 'America/Denver', label: 'Mountain Time (US & Canada)' },
        { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)' },
        { value: 'America/Anchorage', label: 'Alaska' },
        { value: 'Pacific/Honolulu', label: 'Hawaii' },
        { value: 'America/Toronto', label: 'Toronto' },
        { value: 'America/Vancouver', label: 'Vancouver' },
        { value: 'America/Mexico_City', label: 'Mexico City' },
        { value: 'America/Sao_Paulo', label: 'São Paulo' },
        { value: 'America/Buenos_Aires', label: 'Buenos Aires' },
      ],
    },
    {
      region: 'Europe',
      timezones: [
        { value: 'Europe/London', label: 'London' },
        { value: 'Europe/Paris', label: 'Paris' },
        { value: 'Europe/Berlin', label: 'Berlin' },
        { value: 'Europe/Rome', label: 'Rome' },
        { value: 'Europe/Madrid', label: 'Madrid' },
        { value: 'Europe/Amsterdam', label: 'Amsterdam' },
        { value: 'Europe/Stockholm', label: 'Stockholm' },
        { value: 'Europe/Moscow', label: 'Moscow' },
        { value: 'Europe/Istanbul', label: 'Istanbul' },
      ],
    },
    {
      region: 'Asia',
      timezones: [
        { value: 'Asia/Dubai', label: 'Dubai' },
        { value: 'Asia/Kolkata', label: 'Mumbai, New Delhi' },
        { value: 'Asia/Bangkok', label: 'Bangkok' },
        { value: 'Asia/Singapore', label: 'Singapore' },
        { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
        { value: 'Asia/Shanghai', label: 'Beijing, Shanghai' },
        { value: 'Asia/Tokyo', label: 'Tokyo' },
        { value: 'Asia/Seoul', label: 'Seoul' },
        { value: 'Asia/Jakarta', label: 'Jakarta' },
      ],
    },
    {
      region: 'Australia & Pacific',
      timezones: [
        { value: 'Australia/Sydney', label: 'Sydney' },
        { value: 'Australia/Melbourne', label: 'Melbourne' },
        { value: 'Australia/Perth', label: 'Perth' },
        { value: 'Pacific/Auckland', label: 'Auckland' },
      ],
    },
    {
      region: 'Other',
      timezones: [
        { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
        { value: 'Africa/Cairo', label: 'Cairo' },
        { value: 'Africa/Johannesburg', label: 'Johannesburg' },
      ],
    },
  ];
}

/**
 * Get all available timezones (if supported by browser)
 */
export function getAllTimezones(): string[] {
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return (Intl as any).supportedValuesOf('timeZone');
    }
  } catch (error) {
    // Fallback if not supported
  }
  
  // Fallback: return common timezones
  const common = getCommonTimezones();
  return common.flatMap(group => group.timezones.map(tz => tz.value));
}

/**
 * Get the start of day in local timezone for a given date
 */
function getLocalDayStart(date: Date): Date {
  const localDate = new Date(date);
  localDate.setHours(0, 0, 0, 0);
  return localDate;
}

/**
 * Calculate the difference in calendar days between two dates in local timezone
 */
function getDaysDifference(date1: Date, date2: Date): number {
  const day1Start = getLocalDayStart(date1);
  const day2Start = getLocalDayStart(date2);
  const diffMs = day2Start.getTime() - day1Start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format a date string with consistent timezone handling
 * Shows relative dates (Today, Yesterday, X days ago) or formatted date
 * Handles SQLite datetime strings (UTC without timezone) correctly
 */
export function formatRelativeDate(dateString: string): string {
  try {
    if (!dateString || typeof dateString !== 'string') {
      return 'Invalid date';
    }

    let date: Date;
    
    // Check if it's already in ISO format with timezone (has Z, +, or - after the time)
    const hasTimezone = dateString.includes('Z') || 
                        dateString.match(/[+-]\d{2}:?\d{2}$/) !== null;
    
    if (hasTimezone) {
      // Already has timezone info, parse directly
      date = new Date(dateString);
    } else {
      // SQLite format without timezone - treat as UTC by appending 'Z'
      // SQLite format: "YYYY-MM-DD HH:MM:SS" (stored in UTC)
      // Replace space with 'T' for ISO format, then add 'Z' for UTC
      const utcString = dateString.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    const now = new Date();
    const diffDays = getDaysDifference(date, now);

    if (diffDays === 0) {
      // Today - show time only
      return `Today, ${date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })}`;
    } else if (diffDays === 1) {
      // Yesterday - show time
      return `Yesterday, ${date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })}`;
    } else if (diffDays > 1 && diffDays < 7) {
      // Within a week - show days ago
      return `${diffDays} days ago`;
    } else {
      // Older - show full date
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  } catch (error) {
    console.error('Error formatting date:', error, 'from:', dateString);
    return 'Invalid date';
  }
}

/**
 * Format a date string with full date and time
 * Handles SQLite datetime strings (UTC without timezone) correctly
 */
export function formatFullDateTime(dateString: string): string {
  try {
    if (!dateString || typeof dateString !== 'string') {
      return 'Invalid date';
    }

    let date: Date;
    
    // Check if it's already in ISO format with timezone (has Z, +, or - after the time)
    const hasTimezone = dateString.includes('Z') || 
                        dateString.match(/[+-]\d{2}:?\d{2}$/) !== null;
    
    if (hasTimezone) {
      // Already has timezone info, parse directly
      date = new Date(dateString);
    } else {
      // SQLite format without timezone - treat as UTC by appending 'Z'
      // SQLite format: "YYYY-MM-DD HH:MM:SS" (stored in UTC)
      // Replace space with 'T' for ISO format, then add 'Z' for UTC
      const utcString = dateString.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    }

    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    // Convert to local time for display
    return date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (error) {
    console.error('Error formatting date:', error, 'from:', dateString);
    return 'Invalid date';
  }
}

/**
 * Format a date string as just the date (no time)
 * Handles SQLite datetime strings (UTC without timezone) correctly
 */
export function formatDateOnly(dateString: string): string {
  try {
    if (!dateString || typeof dateString !== 'string') {
      return 'Invalid date';
    }

    let date: Date;
    
    // Check if it's already in ISO format with timezone (has Z, +, or - after the time)
    const hasTimezone = dateString.includes('Z') || 
                        dateString.match(/[+-]\d{2}:?\d{2}$/) !== null;
    
    if (hasTimezone) {
      // Already has timezone info, parse directly
      date = new Date(dateString);
    } else {
      // SQLite format without timezone - treat as UTC by appending 'Z'
      // SQLite format: "YYYY-MM-DD HH:MM:SS" (stored in UTC)
      // Replace space with 'T' for ISO format, then add 'Z' for UTC
      const utcString = dateString.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    }

    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    // Convert to local time for display
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting date:', error, 'from:', dateString);
    return 'Invalid date';
  }
}

/**
 * Format a date string as just the time (no date)
 * Handles SQLite datetime strings (UTC without timezone) correctly
 */
export function formatTimeOnly(dateString: string, timezone: string): string {
  try {
    if (!dateString || typeof dateString !== 'string') {
      return 'Invalid time';
    }

    if (!timezone) {
      console.error('[formatTimeOnly] Timezone is required');
      return 'Invalid time';
    }

    let date: Date;
    
    // Check if it's already in ISO format with timezone (has Z, +, or - after the time)
    const hasTimezone = dateString.includes('Z') || 
                        dateString.match(/[+-]\d{2}:?\d{2}$/) !== null;
    
    if (hasTimezone) {
      // Already has timezone info, parse directly
      date = new Date(dateString);
    } else {
      // SQLite format without timezone: "YYYY-MM-DD HH:MM:SS"
      // Standard SQLite datetime('now') returns UTC time
      // Parse as UTC, then convert to user's selected timezone
      const utcString = dateString.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    }

    if (isNaN(date.getTime())) {
      console.error('[formatTimeOnly] Invalid date:', dateString);
      return 'Invalid time';
    }

    // Always convert to the user's specified timezone
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (error) {
    console.error('Error formatting time:', error, 'from:', dateString, 'timezone:', timezone);
    return 'Invalid time';
  }
}

/**
 * Check if a date is recent (within the last 2 days)
 */
export function isRecentDate(dateString: string): boolean {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = getDaysDifference(date, now);
    return diffDays < 2;
  } catch (error) {
    return false;
  }
}
