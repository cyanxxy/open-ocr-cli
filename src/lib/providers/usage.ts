import { estimateProviderRequestCostUsd } from './registry';
import type { ProviderRuntimeConfig, ProviderUsageSnapshot } from './types';

const emptyUsage = (): ProviderUsageSnapshot => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  toolTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
});

let accumulatedUsage = emptyUsage();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberAt(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function optionalNumberAt(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function nestedNumber(record: Record<string, unknown>, key: string, ...nestedKeys: string[]): number {
  const nested = record[key];
  return isRecord(nested) ? numberAt(nested, ...nestedKeys) : 0;
}

/** Accumulate usage from Gemini, OpenAI-compatible, or OpenRouter responses. */
export function recordProviderUsage(
  response: unknown,
  config?: Pick<ProviderRuntimeConfig, 'provider' | 'model' | 'inputPricePerMillionUsd' | 'outputPricePerMillionUsd'>,
): void {
  if (!isRecord(response)) return;
  const candidate = response.usageMetadata ?? response.usage_metadata ?? response.usage;
  if (!isRecord(candidate)) return;

  const inputTokens = numberAt(
    candidate,
    'promptTokenCount',
    'prompt_token_count',
    'totalInputTokens',
    'total_input_tokens',
    'prompt_tokens',
    'input_tokens',
  );
  const outputTokens = numberAt(
    candidate,
    'candidatesTokenCount',
    'candidates_token_count',
    'totalOutputTokens',
    'total_output_tokens',
    'completion_tokens',
    'output_tokens',
  );
  const thoughtTokens = numberAt(
    candidate,
    'thoughtsTokenCount',
    'thoughts_token_count',
    'totalThoughtTokens',
    'total_thought_tokens',
  ) || nestedNumber(candidate, 'completion_tokens_details', 'reasoning_tokens');
  const toolTokens = numberAt(
    candidate,
    'toolUsePromptTokenCount',
    'tool_use_prompt_token_count',
    'totalToolUseTokens',
    'total_tool_use_tokens',
  );
  const cachedTokens = numberAt(
    candidate,
    'cachedContentTokenCount',
    'cached_content_token_count',
    'totalCachedTokens',
    'total_cached_tokens',
  ) || nestedNumber(candidate, 'prompt_tokens_details', 'cached_tokens');
  const reportedTotal = numberAt(
    candidate,
    'totalTokenCount',
    'total_token_count',
    'totalTokens',
    'total_tokens',
  );
  const exactCost = optionalNumberAt(candidate, 'cost', 'estimated_cost', 'estimated_cost_usd');
  const usesOpenAITokenAccounting = 'completion_tokens' in candidate || 'output_tokens' in candidate;

  accumulatedUsage.requests += 1;
  accumulatedUsage.inputTokens += inputTokens;
  accumulatedUsage.outputTokens += outputTokens;
  accumulatedUsage.thoughtTokens += thoughtTokens;
  accumulatedUsage.toolTokens += toolTokens;
  accumulatedUsage.cachedTokens += cachedTokens;
  accumulatedUsage.totalTokens += reportedTotal
    || inputTokens + outputTokens + (usesOpenAITokenAccounting ? 0 : thoughtTokens);
  if (exactCost !== undefined) accumulatedUsage.estimatedCostUsd += exactCost;
  else if (config) {
    accumulatedUsage.estimatedCostUsd += estimateProviderRequestCostUsd(
      config,
      inputTokens,
      outputTokens,
      usesOpenAITokenAccounting ? 0 : thoughtTokens,
      cachedTokens,
    );
  }
}

export function resetProviderUsage(): void {
  accumulatedUsage = emptyUsage();
}

export function getProviderUsage(): ProviderUsageSnapshot {
  return {
    ...accumulatedUsage,
    estimatedCostUsd: Number(accumulatedUsage.estimatedCostUsd.toFixed(8)),
  };
}
