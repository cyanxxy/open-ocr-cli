import { defaultProviderExecutionContext, type ProviderExecutionContext } from './runtime';
import type { ProviderRuntimeConfig, ProviderUsageSnapshot } from './types';

/** Accumulate usage from Gemini, OpenAI-compatible, or OpenRouter responses. */
export function recordProviderUsage(
  response: unknown,
  config?: Pick<ProviderRuntimeConfig, 'provider' | 'model' | 'inputPricePerMillionUsd' | 'outputPricePerMillionUsd'>,
  runtime: ProviderExecutionContext = defaultProviderExecutionContext,
): void {
  runtime.recordUsage(response, config);
}

export function resetProviderUsage(
  runtime: ProviderExecutionContext = defaultProviderExecutionContext,
): void {
  runtime.resetUsage();
}

export function getProviderUsage(
  runtime: ProviderExecutionContext = defaultProviderExecutionContext,
): ProviderUsageSnapshot {
  return runtime.getUsage();
}
