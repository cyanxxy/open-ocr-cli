import {
  getProviderUsage,
  recordProviderUsage,
  resetProviderUsage,
} from '../providers/usage';
import type { ProviderUsageSnapshot } from '../providers/types';
import type { GeminiModel } from './types';

/** Backward-compatible name for the CLI's provider-neutral usage snapshot. */
export type GeminiUsageSnapshot = ProviderUsageSnapshot;

export function recordGeminiUsage(response: unknown, model?: GeminiModel): void {
  recordProviderUsage(
    response,
    model ? { provider: 'gemini', model } : undefined,
  );
}

export function resetGeminiUsage(): void {
  resetProviderUsage();
}

export function getGeminiUsage(): GeminiUsageSnapshot {
  return getProviderUsage();
}
