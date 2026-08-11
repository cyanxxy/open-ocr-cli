import { waitForAbortableAgentDelay } from '../../../src/lib/agentStepStream';
import { isProviderCostLimitError, isRetryableExtractionError } from '../../../src/lib/providers';
import { CliExitError } from './errors';
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

function isRetryableFailure(options: ResolvedCliOptions, error: unknown): boolean {
  if (error instanceof CliExitError) return error.retryable;
  return isRetryableExtractionError(options.provider, error);
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
        // A cost ceiling is a decision, not a transient fault: retrying spends
        // the whole backoff budget re-asking a runtime that has already refused,
        // and contradicts the COST_LIMIT taxonomy (retryable: false).
        || isProviderCostLimitError(error)
        || !isRetryableFailure(options, error)
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
