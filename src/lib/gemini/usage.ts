import { estimateGeminiRequestCostUsd } from './pricing';
import type { GeminiModel } from './types';

export interface GeminiUsageSnapshot {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

const emptyUsage = (): GeminiUsageSnapshot => ({
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

/** Accumulate either generateContent usageMetadata or Interactions usage. */
export function recordGeminiUsage(response: unknown, model?: GeminiModel): void {
  if (!isRecord(response)) return;
  const candidate = response.usageMetadata ?? response.usage_metadata ?? response.usage;
  if (!isRecord(candidate)) return;

  const inputTokens = numberAt(candidate, 'promptTokenCount', 'prompt_token_count', 'totalInputTokens', 'total_input_tokens');
  const outputTokens = numberAt(candidate, 'candidatesTokenCount', 'candidates_token_count', 'totalOutputTokens', 'total_output_tokens');
  const thoughtTokens = numberAt(candidate, 'thoughtsTokenCount', 'thoughts_token_count', 'totalThoughtTokens', 'total_thought_tokens');
  const toolTokens = numberAt(candidate, 'toolUsePromptTokenCount', 'tool_use_prompt_token_count', 'totalToolUseTokens', 'total_tool_use_tokens');
  const cachedTokens = numberAt(candidate, 'cachedContentTokenCount', 'cached_content_token_count', 'totalCachedTokens', 'total_cached_tokens');
  const reportedTotal = numberAt(candidate, 'totalTokenCount', 'total_token_count', 'totalTokens', 'total_tokens');

  accumulatedUsage.requests += 1;
  accumulatedUsage.inputTokens += inputTokens;
  accumulatedUsage.outputTokens += outputTokens;
  accumulatedUsage.thoughtTokens += thoughtTokens;
  accumulatedUsage.toolTokens += toolTokens;
  accumulatedUsage.cachedTokens += cachedTokens;
  accumulatedUsage.totalTokens += reportedTotal || inputTokens + outputTokens + thoughtTokens + toolTokens;
  if (model) {
    // toolTokens is a diagnostic subset of prompt/input usage, not an
    // additional billed category. Adding it here would double-count input.
    accumulatedUsage.estimatedCostUsd += estimateGeminiRequestCostUsd(
      model,
      inputTokens,
      outputTokens,
      thoughtTokens,
    );
  }
}

export function resetGeminiUsage(): void {
  accumulatedUsage = emptyUsage();
}

export function getGeminiUsage(): GeminiUsageSnapshot {
  return {
    ...accumulatedUsage,
    estimatedCostUsd: Number(accumulatedUsage.estimatedCostUsd.toFixed(8)),
  };
}
