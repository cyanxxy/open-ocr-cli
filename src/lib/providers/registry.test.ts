import { describe, expect, it } from 'vitest';

import {
  estimateProviderRequestCostUsd,
  providerTokenPrice,
  resolveProviderBaseUrl,
} from './registry';

describe('provider registry routing', () => {
  it('uses native Cloudflare routes for Gemini and OpenRouter', () => {
    expect(resolveProviderBaseUrl({
      provider: 'gemini',
      gateway: 'cloudflare',
      cloudflareAccountId: 'a/b',
      cloudflareGatewayId: 'g one',
    })).toBe('https://gateway.ai.cloudflare.com/v1/a%2Fb/g%20one/google-ai-studio');
    expect(resolveProviderBaseUrl({
      provider: 'openrouter',
      gateway: 'cloudflare',
      cloudflareAccountId: 'account',
      cloudflareGatewayId: 'gateway',
    })).toBe('https://gateway.ai.cloudflare.com/v1/account/gateway/openrouter');
  });

  it('requires an explicit custom-provider slug for other gateway profiles', () => {
    expect(() => resolveProviderBaseUrl({
      provider: 'kimi',
      gateway: 'cloudflare',
      cloudflareAccountId: 'account',
      cloudflareGatewayId: 'gateway',
    })).toThrow('cloudflareProvider');
  });

  it('provides published Muse and cache-aware Kimi default prices', () => {
    expect(providerTokenPrice({ provider: 'muse', model: 'muse-spark-1.1' }, 0)).toEqual({
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 4.25,
    });
    expect(providerTokenPrice({ provider: 'kimi', model: 'kimi-k2.6' }, 0)).toEqual({
      inputPerMillionUsd: 0.95,
      cachedInputPerMillionUsd: 0.16,
      outputPerMillionUsd: 4,
    });
    expect(estimateProviderRequestCostUsd(
      { provider: 'kimi', model: 'kimi-k2.6' },
      1_000_000,
      100_000,
      0,
      250_000,
    )).toBe(1.1525);
  });
});
