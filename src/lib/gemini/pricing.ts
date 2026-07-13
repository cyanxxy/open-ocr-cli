import type { GeminiModel } from './types';

export interface GeminiTokenPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

/**
 * Paid-tier standard prices published by Google on 2026-07-13. Output prices
 * include thinking tokens. Pro pricing changes when one request exceeds 200k
 * input tokens, so the request-level input count is required here.
 */
export function geminiTokenPrice(model: GeminiModel, inputTokens: number): GeminiTokenPrice {
  switch (model) {
    case 'gemini-3.5-flash':
      return { inputPerMillionUsd: 1.5, outputPerMillionUsd: 9 };
    case 'gemini-3.1-flash-lite':
      return { inputPerMillionUsd: 0.25, outputPerMillionUsd: 1.5 };
    case 'gemini-3-flash-preview':
      return { inputPerMillionUsd: 0.5, outputPerMillionUsd: 3 };
    case 'gemini-3.1-pro-preview':
      return inputTokens > 200_000
        ? { inputPerMillionUsd: 4, outputPerMillionUsd: 18 }
        : { inputPerMillionUsd: 2, outputPerMillionUsd: 12 };
  }
}

export function estimateGeminiRequestCostUsd(
  model: GeminiModel,
  inputTokens: number,
  outputTokens: number,
  thoughtTokens: number,
): number {
  const price = geminiTokenPrice(model, inputTokens);
  return (
    inputTokens * price.inputPerMillionUsd
    + (outputTokens + thoughtTokens) * price.outputPerMillionUsd
  ) / 1_000_000;
}
