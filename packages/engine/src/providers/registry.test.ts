import { describe, expect, it } from 'vitest';

import {
  estimateProviderRequestCostUsd,
  isKimiK3Route,
  providerProfile,
  providerTokenPrice,
  resolveProviderBaseUrl,
} from './registry';

describe('provider registry routing', () => {
  it('recognizes Kimi K3 through direct, revisioned, and OpenRouter variant routes', () => {
    expect(isKimiK3Route('kimi', 'kimi-k3')).toBe(true);
    expect(isKimiK3Route('kimi', 'kimi-k3-preview')).toBe(true);
    expect(isKimiK3Route('openrouter', 'moonshotai/kimi-k3')).toBe(true);
    expect(isKimiK3Route('openrouter', 'moonshotai/kimi-k3:exacto')).toBe(true);
    expect(isKimiK3Route('openrouter', 'moonshotai/kimi-k2.7-code')).toBe(false);
  });

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

  it('advertises only image MIME types accepted by each known transport and this CLI', () => {
    expect(providerProfile('gemini').inputImageMimeTypes).toEqual([
      'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
    ]);
    expect(providerProfile('kimi').inputImageMimeTypes).toEqual([
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    ]);
    expect(providerProfile('muse').inputImageMimeTypes).toEqual([
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    ]);
    expect(providerProfile('muse').capabilities.pdfs).toBe(true);
    expect(providerProfile('openrouter').inputImageMimeTypes).toEqual([
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    ]);
    expect(providerProfile('openai-compatible').inputImageMimeTypes).toBeUndefined();
  });

  it('requires an explicit custom-provider slug for other gateway profiles', () => {
    expect(() => resolveProviderBaseUrl({
      provider: 'kimi',
      gateway: 'cloudflare',
      cloudflareAccountId: 'account',
      cloudflareGatewayId: 'gateway',
    })).toThrow('cloudflareProvider');
  });

  it('provides only verifiable built-in prices and keeps Kimi cache rates', () => {
    expect(providerTokenPrice({ provider: 'muse', model: 'muse-spark-1.1' }, 0)).toBeUndefined();
    expect(providerTokenPrice({ provider: 'kimi', model: 'kimi-k2.6' }, 0)).toEqual({
      inputPerMillionUsd: 0.95,
      cachedInputPerMillionUsd: 0.16,
      outputPerMillionUsd: 4,
    });
    expect(providerTokenPrice({ provider: 'kimi', model: 'kimi-k2.7-code-highspeed' }, 0)).toEqual({
      inputPerMillionUsd: 1.9,
      cachedInputPerMillionUsd: 0.38,
      outputPerMillionUsd: 8,
    });
    expect(estimateProviderRequestCostUsd(
      { provider: 'kimi', model: 'kimi-k2.6' },
      1_000_000,
      100_000,
      0,
      250_000,
    )).toBe(1.1525);
  });

  it('uses the published Gemini standard context-cache rates', () => {
    expect(providerTokenPrice({ provider: 'gemini', model: 'gemini-3.5-flash' }, 0)).toEqual({
      inputPerMillionUsd: 1.5,
      cachedInputPerMillionUsd: 0.15,
      outputPerMillionUsd: 9,
    });
    expect(providerTokenPrice({ provider: 'gemini', model: 'gemini-3.1-pro-preview' }, 200_001)).toEqual({
      inputPerMillionUsd: 4,
      cachedInputPerMillionUsd: 0.4,
      outputPerMillionUsd: 18,
    });
  });
});
