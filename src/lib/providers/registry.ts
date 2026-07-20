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
    inputImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
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
    defaultModel: 'kimi-k3',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultApiKeyEnv: 'MOONSHOT_API_KEY',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'],
    inputImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
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
    inputImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    capabilities: {
      images: true,
      // Meta documents Chat Completions PDF parts as
      // { type: "file", file: { filename, file_data } } (same family as OpenRouter).
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
    models: [
      'google/gemini-3.5-flash',
      'moonshotai/kimi-k3',
      'moonshotai/kimi-k2.7-code',
      'moonshotai/kimi-k2.6',
    ],
    inputImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    capabilities: {
      images: 'model-dependent',
      pdfs: 'model-dependent',
      structuredOutput: 'model-dependent',
      toolCalling: 'model-dependent',
      reasoning: 'model-dependent',
      webUrls: 'model-dependent',
    },
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible API',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultApiKeyEnv: 'OPEN_OCR_API_KEY',
    models: [],
    capabilities: {
      images: 'unknown',
      pdfs: false,
      structuredOutput: 'unknown',
      toolCalling: 'unknown',
      reasoning: 'unknown',
      webUrls: 'unknown',
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

/** True when the selected route targets Kimi K3's current reasoning contract. */
export function isKimiK3Route(provider: ProviderId, model: string): boolean {
  if (provider === 'kimi') return /^kimi-k3(?:$|-)/u.test(model);
  // OpenRouter model variants use a colon suffix (for example routing
  // variants). They still target K3 and therefore keep K3's exact effort
  // contract instead of the gateway's generic effort vocabulary.
  return provider === 'openrouter' && /^moonshotai\/kimi-k3(?:$|[-:])/u.test(model);
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
    // Verified against Kimi's public platform pricing on 2026-07-20.
    case 'kimi-k3':
      return {
        inputPerMillionUsd: 3,
        cachedInputPerMillionUsd: 0.3,
        outputPerMillionUsd: 15,
      };
    case 'kimi-k2.7-code':
      return {
        inputPerMillionUsd: 0.95,
        cachedInputPerMillionUsd: 0.19,
        outputPerMillionUsd: 4,
      };
    case 'kimi-k2.7-code-highspeed':
      return {
        inputPerMillionUsd: 1.9,
        cachedInputPerMillionUsd: 0.38,
        outputPerMillionUsd: 8,
      };
    // Verified against Moonshot's Kimi K2.6 pricing page on 2026-07-15.
    case 'kimi-k2.6':
      return {
        inputPerMillionUsd: 0.95,
        cachedInputPerMillionUsd: 0.16,
        outputPerMillionUsd: 4,
      };
    case 'gemini-3.5-flash':
      return {
        inputPerMillionUsd: 1.5,
        cachedInputPerMillionUsd: 0.15,
        outputPerMillionUsd: 9,
      };
    case 'gemini-3.1-flash-lite':
      return {
        inputPerMillionUsd: 0.25,
        cachedInputPerMillionUsd: 0.025,
        outputPerMillionUsd: 1.5,
      };
    case 'gemini-3-flash-preview':
      return {
        inputPerMillionUsd: 0.5,
        cachedInputPerMillionUsd: 0.05,
        outputPerMillionUsd: 3,
      };
    case 'gemini-3.1-pro-preview':
      return inputTokens > 200_000
        ? { inputPerMillionUsd: 4, cachedInputPerMillionUsd: 0.4, outputPerMillionUsd: 18 }
        : { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.2, outputPerMillionUsd: 12 };
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
