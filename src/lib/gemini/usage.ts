import {
  getProviderUsage,
  recordProviderUsage,
  resetProviderUsage,
} from '../providers/usage';
import type { ProviderUsageSnapshot } from '../providers/types';
import {
  defaultProviderExecutionContext,
  type ProviderExecutionContext,
} from '../providers/runtime';
import type { GeminiModel } from './types';

/** Backward-compatible name for the CLI's provider-neutral usage snapshot. */
export type GeminiUsageSnapshot = ProviderUsageSnapshot;

export function recordGeminiUsage(
  response: unknown,
  model?: GeminiModel,
  runtime?: ProviderExecutionContext,
): void {
  recordProviderUsage(
    response,
    model ? { provider: 'gemini', model } : undefined,
    runtime,
  );
}

/** Record the usage reported for one Interactions API request. */
export function recordGeminiInteractionUsage(
  response: unknown,
  model?: GeminiModel,
  runtime?: ProviderExecutionContext,
): void {
  (runtime ?? defaultProviderExecutionContext).recordUsage(
    response,
    model ? { provider: 'gemini', model } : undefined,
  );
}

/** Record per-step Interactions usage as one request when no total is emitted. */
export function recordGeminiInteractionStepUsages(
  responses: readonly unknown[],
  model?: GeminiModel,
  runtime?: ProviderExecutionContext,
): void {
  (runtime ?? defaultProviderExecutionContext).recordUsageParts(
    responses,
    model ? { provider: 'gemini', model } : undefined,
  );
}

export function resetGeminiUsage(): void {
  resetProviderUsage();
}

export function getGeminiUsage(): GeminiUsageSnapshot {
  return getProviderUsage();
}
