import { isRetryableGeminiError } from '../gemini/client';
import { isRetryableProviderError } from './openaiCompatible';
import type { ProviderId } from './types';

/** Provider-neutral retry classification for CLI and service callers. */
export function isRetryableExtractionError(
  provider: ProviderId,
  error: unknown,
): boolean {
  return provider === 'gemini'
    ? isRetryableGeminiError(error)
    : isRetryableProviderError(error);
}

/**
 * Bounded exponential backoff with jitter for transient provider failures.
 * `retry` is the 0-based index of the retry being scheduled; a non-positive
 * `baseDelayMs` disables the delay entirely (used by tests and dry runs).
 */
export function transientRetryDelayMs(retry: number, baseDelayMs = 750): number {
  if (baseDelayMs <= 0) return 0;
  return baseDelayMs * 2 ** retry + Math.floor(Math.random() * 250);
}
