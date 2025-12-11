/**
 * Error Handling Utilities
 * Standardized error types and handling
 */

/**
 * Custom error class for application errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Error codes
 */
export enum ErrorCode {
  // Authentication errors
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  
  // Validation errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
  
  // Capture/Restore errors
  CAPTURE_FAILED = 'CAPTURE_FAILED',
  RESTORE_FAILED = 'RESTORE_FAILED',
  
  // System errors
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  PROCESS_ERROR = 'PROCESS_ERROR',
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  code: ErrorCode | string,
  message: string,
  details?: any
): { success: false; error: string; code?: string; details?: any } {
  return {
    success: false,
    error: message,
    code,
    details,
  };
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(
  data?: T
): { success: true; data?: T } {
  return {
    success: true,
    ...(data !== undefined && { data }),
  };
}

/**
 * Handle and format errors for IPC responses
 */
export function handleError(error: unknown): { success: false; error: string; code?: string } {
  if (error instanceof AppError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      success: false,
      error: error.message,
      code: ErrorCode.DATABASE_ERROR,
    };
  }

  return {
    success: false,
    error: 'An unknown error occurred',
    code: ErrorCode.DATABASE_ERROR,
  };
}







