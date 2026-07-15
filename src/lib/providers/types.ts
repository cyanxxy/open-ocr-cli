import type { ThinkingConfig } from '../gemini/types';

export const PROVIDER_IDS = [
  'gemini',
  'kimi',
  'muse',
  'openrouter',
  'openai-compatible',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const GATEWAY_IDS = ['direct', 'cloudflare'] as const;
export type GatewayId = (typeof GATEWAY_IDS)[number];

export interface ProviderCapabilities {
  images: boolean;
  pdfs: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  webUrls: boolean;
}

export interface ProviderTokenPrice {
  inputPerMillionUsd: number;
  /** Optional discounted rate for cached input tokens, which are a subset of input tokens. */
  cachedInputPerMillionUsd?: number;
  outputPerMillionUsd: number;
}

export interface ProviderRuntimeConfig {
  provider: ProviderId;
  gateway: GatewayId;
  apiKey: string;
  apiKeyEnv: string;
  model: string;
  baseUrl: string;
  thinkingConfig?: ThinkingConfig;
  gatewayToken?: string;
  gatewayTokenEnv?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  cloudflareByok?: boolean;
  cloudflareByokAlias?: string;
  cloudflareProvider?: string;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
}

export interface ProviderProfile {
  id: ProviderId;
  label: string;
  defaultModel?: string;
  defaultBaseUrl: string;
  defaultApiKeyEnv: string;
  models: readonly string[];
  capabilities: ProviderCapabilities;
}

export interface ProviderUsageSnapshot {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}
