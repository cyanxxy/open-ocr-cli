import { beforeEach, describe, expect, it } from 'vitest';

import { getGeminiUsage, recordGeminiUsage, resetGeminiUsage } from './usage';

describe('Gemini usage accumulator', () => {
  beforeEach(() => resetGeminiUsage());

  it('combines generateContent and Interactions token metadata', () => {
    recordGeminiUsage({
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 5,
        totalTokenCount: 125,
      },
    });
    recordGeminiUsage({
      usage: {
        total_input_tokens: 50,
        total_output_tokens: 10,
        total_tool_use_tokens: 4,
        total_tokens: 64,
      },
    });

    expect(getGeminiUsage()).toEqual({
      requests: 2,
      inputTokens: 150,
      outputTokens: 30,
      thoughtTokens: 5,
      toolTokens: 4,
      cachedTokens: 0,
      totalTokens: 189,
    });
  });

  it('ignores responses without usage metadata', () => {
    recordGeminiUsage({ text: 'no metadata' });
    expect(getGeminiUsage().requests).toBe(0);
  });
});
