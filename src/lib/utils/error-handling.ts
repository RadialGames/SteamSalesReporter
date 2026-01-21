/**
 * Centralized error handling utilities
 * Provides consistent error logging and handling across the application
 */

/**
 * Log an error with context information
 * @param context - Description of where/why the error occurred
 * @param error - The error object
 * @param additionalInfo - Optional additional information to log
 */
export function logError(
  context: string,
  error: unknown,
  additionalInfo?: Record<string, unknown>
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  console.error(`[${context}]`, {
    message: errorMessage,
    stack: errorStack,
    ...additionalInfo,
  });
}

/**
 * Handle an async operation with error logging
 * @param operation - The async operation to execute
 * @param context - Context description for error logging
 * @param fallback - Fallback value to return on error
 * @returns The result of the operation or the fallback value
 */
export async function handleAsyncError<T>(
  operation: () => Promise<T>,
  context: string,
  fallback: T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logError(context, error);
    return fallback;
  }
}

/**
 * Create an error handler function for a specific context
 * @param context - Context description for error logging
 * @returns A function that logs errors with the given context
 */
export function createErrorHandler(context: string) {
  return (error: unknown, additionalInfo?: Record<string, unknown>) => {
    logError(context, error, additionalInfo);
  };
}

/**
 * Check if an error is a specific error type
 * @param error - The error to check
 * @param errorClass - The error class/constructor to check against
 * @returns True if the error is an instance of the error class
 */
export function isErrorType<T extends Error>(
  error: unknown,
  errorClass: new (...args: unknown[]) => T
): error is T {
  return error instanceof errorClass;
}

/**
 * Extract a user-friendly error message from an error
 * @param error - The error object
 * @returns A user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}
