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
