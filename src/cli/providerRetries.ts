import { waitForAbortableAgentDelay } from '../lib/agentStepStream';
import { isRetryableExtractionError } from '../lib/providers';
import type { ResolvedCliOptions } from './types';

export interface ProviderRetryResult<T> {
  value: T;
  attempts: number;
}

export class ExtractionAttemptsError extends Error {
  constructor(error: unknown, readonly attempts: number) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'ExtractionAttemptsError';
  }
}

/** Run one provider operation under the CLI's bounded retry contract. */
export async function runWithProviderRetries<T>(
  options: ResolvedCliOptions,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<ProviderRetryResult<T>> {
  const allowedAttempts = options.mode === 'agentic' ? 1 : options.retries + 1;
  for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      if (
        signal.aborted
        || attempt === allowedAttempts
        || !isRetryableExtractionError(options.provider, error)
      ) {
        throw new ExtractionAttemptsError(error, attempt);
      }
      const delayMs = 750 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      try {
        await waitForAbortableAgentDelay(delayMs, signal);
      } catch (waitError) {
        throw new ExtractionAttemptsError(waitError, attempt);
      }
    }
  }
  throw new ExtractionAttemptsError(
    new Error('Extraction exhausted its retry budget'),
    allowedAttempts,
  );
}
