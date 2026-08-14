import { describe, expect, it } from 'vitest';

import { estimateGeminiRequestCostUsd, geminiTokenPrice } from './pricing';

describe('Gemini paid-tier cost estimates', () => {
  it('uses published standard Flash pricing', () => {
    expect(estimateGeminiRequestCostUsd('gemini-3.5-flash', 1_000_000, 500_000, 500_000)).toBe(10.5);
    expect(geminiTokenPrice('gemini-3.1-flash-lite', 1_000)).toEqual({
      inputPerMillionUsd: 0.25,
      outputPerMillionUsd: 1.5,
    });
  });

  it('applies the higher Pro tier only above 200k input tokens per request', () => {
    expect(geminiTokenPrice('gemini-3.1-pro-preview', 200_000).inputPerMillionUsd).toBe(2);
    expect(geminiTokenPrice('gemini-3.1-pro-preview', 200_001).inputPerMillionUsd).toBe(4);
  });
});
