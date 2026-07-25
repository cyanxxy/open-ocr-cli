import type {
  ProviderExecutionContext,
  ProviderRuntimeConfig,
} from '../../../src/lib/providers';
import type { ResolvedCliOptions } from './types';

/** Build the provider-facing configuration once for every CLI execution path. */
export function providerRuntimeConfig(
  options: ResolvedCliOptions,
  runtime?: ProviderExecutionContext,
): ProviderRuntimeConfig {
  return {
    provider: options.provider,
    gateway: options.gateway,
    apiKey: options.apiKey,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    baseUrl: options.baseUrl,
    thinkingConfig: {
      level: options.thinking,
      includeThoughts: options.includeThoughts,
    },
    progress: options.progress,
    gatewayToken: options.gatewayToken,
    gatewayTokenEnv: options.gatewayTokenEnv,
    cloudflareAccountId: options.cloudflareAccountId,
    cloudflareGatewayId: options.cloudflareGatewayId,
    cloudflareByok: options.cloudflareByok,
    cloudflareByokAlias: options.cloudflareByokAlias,
    cloudflareProvider: options.cloudflareProvider,
    inputPricePerMillionUsd: options.inputPricePerMillionUsd,
    outputPricePerMillionUsd: options.outputPricePerMillionUsd,
    runtime,
  };
}
