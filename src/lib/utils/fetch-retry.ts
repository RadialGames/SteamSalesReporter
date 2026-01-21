// Shared retry logic for HTTP requests
// Extracted from steam-api-client.ts to eliminate code duplication

export class SyncCancelledError extends Error {
  constructor() {
    super('Sync cancelled by user');
    this.name = 'SyncCancelledError';
  }
}

/**
 * Check if an error is retryable (network error, timeout, or 5xx server error)
 */
export function isRetryableError(error: unknown, status?: number): boolean {
  // Network errors (TypeError from fetch) are retryable
  if (error instanceof TypeError) {
    return true;
  }

  // 5xx server errors are retryable
  if (status && status >= 500 && status < 600) {
    return true;
  }

  // 429 (Too Many Requests) is retryable
  if (status === 429) {
    return true;
  }

  // 408 (Request Timeout) is retryable
  if (status === 408) {
    return true;
  }

  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries: number;
  signal?: AbortSignal;
}

/**
 * Result of a fetch operation
 */
export interface FetchResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  status?: number;
}

/**
 * Fetch with retry logic - handles network errors, timeouts, and 5xx errors
 * with exponential backoff. Non-retryable errors (4xx client errors) are thrown immediately.
 */
export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit & RetryConfig,
  parseResponse: (response: Response) => Promise<T>
): Promise<T> {
  const { maxRetries, signal, ...fetchOptions } = options;

  let lastError: Error | null = null;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check if cancelled before each attempt
    if (signal?.aborted) {
      throw new SyncCancelledError();
    }

    try {
      const response = await fetch(url, fetchOptions);

      // Check if response is ok
      if (!response.ok) {
        lastStatus = response.status;
        const error = new Error(`HTTP error: ${response.status} ${response.statusText}`);

        // Don't retry on 4xx client errors (except 429 Too Many Requests)
        // These are thrown immediately without retry
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw error;
        }

        // For all other errors (including retryable ones), throw to trigger retry logic
        throw error;
      } else {
        // Success - return parsed response
        return await parseResponse(response);
      }
    } catch (error) {
      // Check if this was a cancellation
      if (error instanceof SyncCancelledError || signal?.aborted) {
        throw new SyncCancelledError();
      }

      // Check if this is a retryable error
      if (isRetryableError(error, lastStatus)) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Log retry attempt
        const errorType = error instanceof TypeError ? 'Network Error' : `HTTP ${lastStatus}`;
        const urlPath = new URL(url, window.location.origin).pathname;
        const endpointName = urlPath.split('/').pop() || urlPath;

        console.warn(
          `[Retry] ${errorType} on ${endpointName} (attempt ${attempt + 1}/${maxRetries + 1})`,
          {
            url: urlPath,
            status: lastStatus,
            error: error instanceof Error ? error.message : String(error),
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
          }
        );

        // If we have retries left, wait with exponential backoff
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s, etc.
          const delayMs = Math.pow(2, attempt) * 1000;
          console.log(`[Retry] Waiting ${delayMs}ms before retry...`);
          await sleep(delayMs);
          continue;
        } else {
          console.error(`[Retry] Exhausted all ${maxRetries + 1} attempts for ${endpointName}`, {
            url: urlPath,
            status: lastStatus,
            finalError: lastError.message,
          });
        }
      }

      // Not retryable or out of retries - throw the error
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new Error('Request failed after retries');
}
