import type {
  GatewayId,
  ProviderId,
  ProviderProfile,
  ProviderRuntimeConfig,
  ProviderTokenPrice,
} from './types';

export const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
] as const;

export const PROVIDER_PROFILES: Record<ProviderId, ProviderProfile> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-3.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultApiKeyEnv: 'GEMINI_API_KEY',
    models: GEMINI_MODELS,
    capabilities: {
      images: true,
      pdfs: true,
      structuredOutput: true,
      toolCalling: true,
      reasoning: true,
      webUrls: true,
    },
  },
  kimi: {
    id: 'kimi',
    label: 'Moonshot Kimi',
    defaultModel: 'kimi-k2.6',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultApiKeyEnv: 'MOONSHOT_API_KEY',
    models: ['kimi-k2.6'],
    capabilities: {
      images: true,
      pdfs: true,
      structuredOutput: true,
      toolCalling: true,
      reasoning: true,
      webUrls: true,
    },
  },
  muse: {
    id: 'muse',
    label: 'Meta Muse',
    defaultModel: 'muse-spark-1.1',
    defaultBaseUrl: 'https://api.meta.ai/v1',
    defaultApiKeyEnv: 'META_API_KEY',
    models: ['muse-spark-1.1'],
    capabilities: {
      images: true,
      pdfs: true,
      structuredOutput: true,
      toolCalling: true,
      reasoning: true,
      webUrls: true,
    },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'google/gemini-3.5-flash',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultApiKeyEnv: 'OPENROUTER_API_KEY',
    models: ['google/gemini-3.5-flash', 'moonshotai/kimi-k2.6'],
    capabilities: {
      images: true,
      pdfs: true,
      structuredOutput: true,
      toolCalling: true,
      reasoning: true,
      webUrls: true,
    },
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible API',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultApiKeyEnv: 'OPEN_OCR_API_KEY',
    models: [],
    capabilities: {
      images: true,
      pdfs: false,
      structuredOutput: true,
      toolCalling: true,
      reasoning: false,
      webUrls: true,
    },
  },
};

export function providerProfile(provider: ProviderId): ProviderProfile {
  return PROVIDER_PROFILES[provider];
}

export function providerDefaultModel(provider: ProviderId): string | undefined {
  return providerProfile(provider).defaultModel;
}

export function providerDefaultApiKeyEnv(provider: ProviderId): string {
  return providerProfile(provider).defaultApiKeyEnv;
}

export function providerDefaultBaseUrl(provider: ProviderId): string {
  return providerProfile(provider).defaultBaseUrl;
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function cloudflareGatewayRoot(accountId: string, gatewayId: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}`;
}

export function resolveProviderBaseUrl(input: {
  provider: ProviderId;
  gateway: GatewayId;
  baseUrl?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  cloudflareProvider?: string;
}): string {
  if (input.baseUrl) return input.baseUrl.replace(/\/$/, '');
  if (input.gateway === 'direct') return providerDefaultBaseUrl(input.provider);

  if (!input.cloudflareAccountId || !input.cloudflareGatewayId) {
    throw new Error('Cloudflare AI Gateway requires cloudflareAccountId and cloudflareGatewayId');
  }
  const root = cloudflareGatewayRoot(input.cloudflareAccountId, input.cloudflareGatewayId);
  if (input.provider === 'gemini') return `${root}/google-ai-studio`;
  if (input.provider === 'openrouter') return `${root}/openrouter`;
  if (!input.cloudflareProvider) {
    throw new Error(
      `Cloudflare AI Gateway for ${input.provider} requires cloudflareProvider, the configured custom-provider slug`,
    );
  }
  return `${root}/custom-${encodeURIComponent(input.cloudflareProvider)}/v1`;
}

export function providerRequestHeaders(config: ProviderRuntimeConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.gatewayToken) headers['cf-aig-authorization'] = `Bearer ${config.gatewayToken}`;
  if (config.cloudflareByokAlias) headers['cf-aig-byok-alias'] = config.cloudflareByokAlias;
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/cyanxxy/gemini-ocr';
    headers['X-Title'] = 'Open OCR CLI';
  }
  return headers;
}

export function providerTokenPrice(
  config: Pick<ProviderRuntimeConfig, 'provider' | 'model' | 'inputPricePerMillionUsd' | 'outputPricePerMillionUsd'>,
  inputTokens: number,
): ProviderTokenPrice | undefined {
  if (config.inputPricePerMillionUsd !== undefined && config.outputPricePerMillionUsd !== undefined) {
    return {
      inputPerMillionUsd: config.inputPricePerMillionUsd,
      outputPerMillionUsd: config.outputPricePerMillionUsd,
    };
  }
  const model = config.model.replace(/^google\//, '').replace(/^moonshotai\//, '');
  switch (model) {
    // Verified against Moonshot's Kimi K2.6 pricing page on 2026-07-15.
    case 'kimi-k2.6':
      return {
        inputPerMillionUsd: 0.95,
        cachedInputPerMillionUsd: 0.16,
        outputPerMillionUsd: 4,
      };
    // Verified against Meta Model API pricing on 2026-07-15.
    case 'muse-spark-1.1':
      return { inputPerMillionUsd: 1.25, outputPerMillionUsd: 4.25 };
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
    default:
      return undefined;
  }
}

export function estimateProviderRequestCostUsd(
  config: Pick<ProviderRuntimeConfig, 'provider' | 'model' | 'inputPricePerMillionUsd' | 'outputPricePerMillionUsd'>,
  inputTokens: number,
  outputTokens: number,
  thoughtTokens: number,
  cachedTokens = 0,
): number {
  const price = providerTokenPrice(config, inputTokens);
  if (!price) return 0;
  const billedCachedTokens = Math.min(Math.max(cachedTokens, 0), inputTokens);
  const uncachedInputTokens = inputTokens - billedCachedTokens;
  return (
    uncachedInputTokens * price.inputPerMillionUsd
    + billedCachedTokens * (price.cachedInputPerMillionUsd ?? price.inputPerMillionUsd)
    + (outputTokens + thoughtTokens) * price.outputPerMillionUsd
  ) / 1_000_000;
}
