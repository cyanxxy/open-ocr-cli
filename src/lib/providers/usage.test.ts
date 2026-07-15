import { beforeEach, describe, expect, it } from 'vitest';

import type { ProviderRuntimeConfig } from './types';
import { getProviderUsage, recordProviderUsage, resetProviderUsage } from './usage';

const openRouterConfig: ProviderRuntimeConfig = {
  provider: 'openrouter',
  gateway: 'direct',
  apiKey: 'secret',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  model: 'google/gemini-3.5-flash',
  baseUrl: 'https://openrouter.ai/api/v1',
};

beforeEach(() => resetProviderUsage());

describe('provider usage accounting', () => {
  it('treats an explicitly reported zero cost as exact instead of estimating a charge', () => {
    recordProviderUsage({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        total_tokens: 1100,
        cost: 0,
      },
    }, openRouterConfig);

    expect(getProviderUsage()).toMatchObject({
      requests: 1,
      totalTokens: 1100,
      estimatedCostUsd: 0,
    });
  });

  it('uses configured pricing when the provider omits billed cost', () => {
    recordProviderUsage({
      usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
    }, {
      ...openRouterConfig,
      inputPricePerMillionUsd: 2,
      outputPricePerMillionUsd: 10,
    });

    expect(getProviderUsage().estimatedCostUsd).toBe(0.003);
  });

  it('does not charge cached Kimi input at the uncached rate', () => {
    recordProviderUsage({
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        total_tokens: 1_100_000,
        prompt_tokens_details: { cached_tokens: 250_000 },
      },
    }, {
      ...openRouterConfig,
      provider: 'kimi',
      model: 'kimi-k2.6',
    });

    expect(getProviderUsage()).toMatchObject({
      cachedTokens: 250_000,
      estimatedCostUsd: 1.1525,
    });
  });
});
