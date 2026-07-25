import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  defaultThinkingLevelForModel,
  type GeminiModel,
  type ThinkingLevel,
} from '../../../src/lib/gemini';
import {
  GATEWAY_IDS,
  GEMINI_MODELS,
  PROVIDER_IDS,
  isKimiK3Route,
  isLocalBaseUrl,
  providerDefaultApiKeyEnv,
  providerDefaultModel,
  providerTokenPrice,
  resolveProviderBaseUrl,
  type GatewayId,
  type ProviderId,
} from '../../../src/lib/providers';
import { getExtractionPreset } from '../../../src/lib/templates';
import { asRecord } from './jsonValidation';
import {
  CLI_FORMATS,
  CLI_MODES,
  SUPPORTED_MODELS,
  type CliConfigFile,
  type CliFormat,
  type CliMode,
  type ExtractCommandFlags,
  type ResolvedCliOptions,
} from './types';

const DEFAULT_CONFIG: Required<Pick<
  ResolvedCliOptions,
  | 'provider'
  | 'gateway'
  | 'model'
  | 'thinking'
  | 'includeThoughts'
  | 'progress'
  | 'mode'
  | 'format'
  | 'concurrency'
  | 'retries'
  | 'timeoutSeconds'
  | 'maxFiles'
  | 'maxTotalMb'
  | 'hidden'
  | 'resume'
  | 'overwrite'
  | 'failFast'
  | 'jsonl'
  | 'dryRun'
  | 'quiet'
  | 'verbose'
  | 'stdinName'
  | 'detectImages'
  | 'detectMath'
  | 'maxTokens'
  | 'maxIterations'
  | 'confidenceThreshold'
  | 'requestsPerMinute'
>> = {
  provider: 'gemini',
  gateway: 'direct',
  model: 'gemini-3.5-flash',
  thinking: 'MEDIUM',
  includeThoughts: false,
  progress: 'standard',
  mode: 'simple',
  format: 'markdown',
  concurrency: 2,
  retries: 3,
  timeoutSeconds: 120,
  maxFiles: 1000,
  maxTotalMb: 5120,
  hidden: false,
  resume: true,
  overwrite: false,
  failFast: false,
  jsonl: false,
  dryRun: false,
  quiet: false,
  verbose: false,
  stdinName: 'stdin',
  detectImages: false,
  detectMath: false,
  maxTokens: 32768,
  maxIterations: 5,
  confidenceThreshold: 0.8,
  requestsPerMinute: 0,
};

function pickConfig(value: Record<string, unknown>, label: string): CliConfigFile {
  const stringKeys = [
    'provider', 'gateway', 'model', 'baseUrl', 'thinking', 'progress', 'mode', 'preset', 'format', 'output',
    'apiKeyEnv', 'schema', 'cloudflareAccountId', 'cloudflareGatewayId', 'cloudflareTokenEnv',
    'cloudflareByokAlias', 'cloudflareProvider',
  ] as const;
  const numberKeys = [
    'concurrency', 'retries', 'timeoutSeconds', 'maxFiles', 'maxTotalMb', 'maxTokens',
    'maxIterations', 'confidenceThreshold', 'maxCostUsd', 'requestsPerMinute',
    'inputPricePerMillionUsd', 'outputPricePerMillionUsd',
  ] as const;
  const booleanKeys = [
    'includeThoughts', 'resume', 'overwrite', 'failFast', 'hidden', 'detectImages',
    'detectMath', 'cloudflareByok',
  ] as const;
  const arrayKeys = ['exclude', 'instructions'] as const;
  const knownKeys = new Set<string>([...stringKeys, ...numberKeys, ...booleanKeys, ...arrayKeys]);

  for (const key of stringKeys) {
    const entry = value[key];
    if (entry !== undefined && typeof entry !== 'string') throw new Error(`${label}: "${key}" must be a string`);
  }
  for (const key of numberKeys) {
    const entry = value[key];
    if (entry !== undefined && (typeof entry !== 'number' || !Number.isFinite(entry))) {
      throw new Error(`${label}: "${key}" must be a finite number`);
    }
  }
  for (const key of booleanKeys) {
    const entry = value[key];
    if (entry !== undefined && typeof entry !== 'boolean') throw new Error(`${label}: "${key}" must be a boolean`);
  }

  for (const key of arrayKeys) {
    const entry = value[key];
    if (entry !== undefined && (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string'))) {
      throw new Error(`${label}: "${key}" must be an array of strings`);
    }
  }

  const unknownKeys = Object.keys(value).filter((key) => !knownKeys.has(key));
  if (unknownKeys.length > 0) {
    process.stderr.write(`${label}: ignoring unknown configuration key(s): ${unknownKeys.join(', ')}\n`);
  }
  const allowlisted = Object.fromEntries(
    Object.entries(value).filter(([key]) => knownKeys.has(key)),
  );
  return allowlisted as CliConfigFile;
}

async function readConfigFile(filePath: string, required: boolean): Promise<CliConfigFile> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return pickConfig(asRecord(JSON.parse(raw) as unknown, filePath), filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!required && code === 'ENOENT') return {};
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    throw error;
  }
}

export function environmentDisablesConfig(): boolean {
  const value = process.env.OPEN_OCR_NO_CONFIG?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function cliConfigDisabled(value?: string | false, disabled = false): boolean {
  // Explicit --no-config / request.noConfig always wins. An explicit config path
  // still allows loading that one file under hermetic ambient mode (see
  // loadCliConfig), but does not re-enable user/project merges or .env.
  return disabled || value === false || (value === undefined && environmentDisablesConfig());
}

export function defaultCliThinkingLevel(provider: ProviderId, model: string): ThinkingLevel {
  if (isKimiK3Route(provider, model)) return 'MAX';
  if (provider === 'kimi' && (/^kimi-k2\.7-code/u.test(model) || model === 'kimi-k2.6')) return 'HIGH';
  if (provider === 'gemini') return defaultThinkingLevelForModel(model as GeminiModel);
  return DEFAULT_CONFIG.thinking;
}

export function cliThinkingLevels(provider: ProviderId, model: string): readonly ThinkingLevel[] {
  if (isKimiK3Route(provider, model)) return ['LOW', 'HIGH', 'MAX'];
  if (provider === 'kimi' && /^kimi-k2\.7-code/u.test(model)) return ['HIGH'];
  if (provider === 'kimi' && model === 'kimi-k2.6') return ['MINIMAL', 'HIGH'];
  if (provider === 'openrouter') return ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'];
  if (provider === 'muse') return ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH'];
  if (provider === 'gemini' && model === 'gemini-3.1-pro-preview') return ['LOW', 'MEDIUM', 'HIGH'];
  return ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
}

export async function loadCliConfig(
  cwd: string,
  explicitPath?: string,
  disabled = false,
): Promise<CliConfigFile> {
  const hermetic = disabled || environmentDisablesConfig();
  if (hermetic && !explicitPath) return {};
  const explicit = explicitPath
    ? await readConfigFile(path.resolve(cwd, explicitPath), true)
    : {};
  // Hermetic mode may still load one explicit config file, but never ambient
  // user/project files that could reintroduce baseUrl or credential env names.
  if (hermetic) return explicit;

  const legacyUserPath = path.join(homedir(), '.config', 'gemini-ocr', 'config.json');
  const userPath = path.join(homedir(), '.config', 'open-ocr-cli', 'config.json');
  const legacyProjectPath = path.join(cwd, '.gemini-ocr.json');
  const projectPath = path.join(cwd, '.open-ocr-cli.json');
  const [legacyUser, user, legacyProject, project] = await Promise.all([
    readConfigFile(legacyUserPath, false),
    readConfigFile(userPath, false),
    readConfigFile(legacyProjectPath, false),
    readConfigFile(projectPath, false),
  ]);
  return { ...legacyUser, ...user, ...legacyProject, ...project, ...explicit };
}

export function loadLocalEnv(cwd: string, disabled = false): void {
  // Ambient OPEN_OCR_NO_CONFIG always blocks project .env, even when a caller
  // passes an explicit config path for option resolution.
  if (disabled || environmentDisablesConfig()) return;
  const envPath = path.join(cwd, '.env');
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}

export function credentialSetupGuidance(apiKeyEnv: string, cwd: string, provider = 'provider'): string {
  return [
    `Set ${apiKeyEnv} with your ${provider} API key before running extraction:`,
    `  macOS/Linux: export ${apiKeyEnv}="your-key"`,
    `  PowerShell:   $env:${apiKeyEnv}="your-key"`,
    `  Project:      add ${apiKeyEnv}=your-key to ${path.join(cwd, '.env')} (keep it out of version control)`,
    'Then run: open-ocr-cli doctor',
  ].join('\n');
}

function integer(value: string | number | undefined, fallback: number, label: string, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function numberInRange(value: string | number | undefined, fallback: number, label: string, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return parsed;
}

function optionalNumberInRange(
  value: string | number | undefined,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  return numberInRange(value, min, label, min, max);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], label: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

export function resolveCliOptions(
  flags: ExtractCommandFlags,
  fileConfig: CliConfigFile,
  cwd: string,
): ResolvedCliOptions {
  const configuredProvider = fileConfig.provider ?? DEFAULT_CONFIG.provider;
  const selectedProvider = flags.provider ?? process.env.OPEN_OCR_PROVIDER;
  const provider = oneOf<ProviderId>(
    selectedProvider ?? configuredProvider,
    PROVIDER_IDS,
    '--provider',
    DEFAULT_CONFIG.provider,
  );
  const providerContextMatches = selectedProvider === undefined || selectedProvider === configuredProvider;
  const configuredGateway = fileConfig.gateway ?? DEFAULT_CONFIG.gateway;
  const selectedGateway = flags.gateway ?? process.env.OPEN_OCR_GATEWAY;
  const gateway = oneOf<GatewayId>(
    selectedGateway ?? configuredGateway,
    GATEWAY_IDS,
    '--gateway',
    DEFAULT_CONFIG.gateway,
  );
  const gatewayContextMatches = selectedGateway === undefined || selectedGateway === configuredGateway;
  const selectedModel = flags.model
    ?? process.env.OPEN_OCR_MODEL
    ?? (provider === 'gemini' ? process.env.GEMINI_OCR_MODEL : undefined);
  const configuredModel = providerContextMatches
    ? fileConfig.model ?? providerDefaultModel(provider)
    : providerDefaultModel(provider);
  const model = selectedModel
    ?? configuredModel
    ?? providerDefaultModel(provider);
  if (!model) throw new Error('--model is required for the openai-compatible provider');
  if (provider === 'gemini' && !GEMINI_MODELS.includes(model as (typeof GEMINI_MODELS)[number])) {
    throw new Error(`--model must be one of: ${SUPPORTED_MODELS.join(', ')}`);
  }
  const modelContextMatches = providerContextMatches
    && (selectedModel === undefined || selectedModel === configuredModel);
  const configuredThinking = flags.thinking
    ?? process.env.OPEN_OCR_THINKING
    ?? (provider === 'gemini' ? process.env.GEMINI_OCR_THINKING : undefined)
    ?? (modelContextMatches ? fileConfig.thinking : undefined);
  const isKimiK3 = isKimiK3Route(provider, model);
  let thinking = oneOf<ThinkingLevel>(
    configuredThinking?.toUpperCase(),
    ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'],
    '--thinking',
    defaultCliThinkingLevel(provider, model),
  );
  const schemaPath = flags.schema ?? fileConfig.schema;
  const hasCustomSchema = flags.customSchema ?? false;
  const hasSchema = hasCustomSchema || Boolean(schemaPath);
  const mode = oneOf<CliMode>(flags.mode ?? fileConfig.mode, CLI_MODES, '--mode', DEFAULT_CONFIG.mode);
  const format = oneOf<CliFormat>(
    flags.format ?? fileConfig.format ?? (hasSchema ? 'json' : undefined),
    CLI_FORMATS,
    '--format',
    DEFAULT_CONFIG.format,
  );
  const preset = flags.preset ?? fileConfig.preset;
  const effectiveMode: CliMode = preset && !flags.mode && !fileConfig.mode ? 'template' : mode;
  const progress = oneOf<ResolvedCliOptions['progress']>(
    flags.progress
      ?? fileConfig.progress
      // Legacy --include-thoughts requested thought summaries only; map to
      // standard progress so tool argument/result payloads stay opt-in via
      // explicit --progress detailed / extraction.progress.
      ?? (flags.includeThoughts || fileConfig.includeThoughts ? 'standard' : undefined),
    ['off', 'standard', 'detailed'],
    '--progress',
    DEFAULT_CONFIG.progress,
  );

  if (!isKimiK3 && provider !== 'openrouter' && thinking === 'MAX') {
    throw new Error('--thinking max is supported by Kimi K3 and model-dependent OpenRouter routes');
  }
  if (provider !== 'openrouter' && provider !== 'muse' && thinking === 'XHIGH') {
    throw new Error('--thinking xhigh is supported by Muse and model-dependent OpenRouter routes');
  }
  if (provider === 'gemini' && model === 'gemini-3.1-pro-preview' && thinking === 'MINIMAL') {
    throw new Error('Gemini 3.1 Pro supports --thinking low, medium, or high; minimal is not supported');
  }
  if (isKimiK3 && thinking === 'MEDIUM') {
    throw new Error('Kimi K3 supports --thinking low, high, or max; medium would be an ambiguous silent upgrade');
  }
  if (isKimiK3 && thinking === 'XHIGH') {
    throw new Error('Kimi K3 supports --thinking low, high, or max; xhigh is not a Kimi K3 effort');
  }
  if (isKimiK3 && thinking === 'MINIMAL') {
    thinking = 'LOW';
  }
  if (provider === 'kimi' && /^kimi-k2\.7-code/u.test(model) && thinking !== 'HIGH') {
    throw new Error('Kimi K2.7 Code always thinks and does not expose configurable reasoning effort; use --thinking high');
  }
  if (provider === 'kimi' && model === 'kimi-k2.6' && thinking !== 'MINIMAL' && thinking !== 'HIGH') {
    throw new Error('Direct Kimi K2.6 supports only instant mode (--thinking minimal) or thinking mode (--thinking high)');
  }
  if (hasSchema && preset) throw new Error('--schema cannot be combined with --preset');
  if (effectiveMode === 'template' && !preset) throw new Error('--preset is required when --mode template is selected');
  if (preset) getExtractionPreset(preset);
  if (format === 'csv' && effectiveMode !== 'template') throw new Error('--format csv is only available in template mode');
  if (hasSchema && effectiveMode !== 'simple') throw new Error('--schema is only available in simple mode');
  if (hasSchema && format !== 'json') throw new Error('--schema requires --format json');
  const defaultMaxTokens = isKimiK3
    // Agentic K3 can issue many continuations; keep a safer default budget
    // unless the operator opts into the full protocol ceiling.
    ? (effectiveMode === 'agentic' ? 32_768 : 131_072)
    : DEFAULT_CONFIG.maxTokens;
  const maxTokens = integer(
    flags.maxTokens ?? (modelContextMatches ? fileConfig.maxTokens : undefined),
    defaultMaxTokens,
    '--max-tokens',
    256,
    provider === 'gemini' ? 65536 : 1048576,
  );
  if (
    effectiveMode === 'agentic'
    && thinking !== 'MINIMAL'
    && model.includes('kimi-k2.6')
    && maxTokens < 16_000
  ) {
    throw new Error('--max-tokens must be at least 16000 for Kimi K2.6 agentic tool use with thinking enabled');
  }

  const cloudflareAccountId = flags.cloudflareAccountId
    ?? process.env.CLOUDFLARE_ACCOUNT_ID
    ?? fileConfig.cloudflareAccountId;
  const cloudflareGatewayId = flags.cloudflareGatewayId
    ?? process.env.CLOUDFLARE_AI_GATEWAY_ID
    ?? fileConfig.cloudflareGatewayId;
  const cloudflareProvider = flags.cloudflareProvider
    ?? (providerContextMatches ? fileConfig.cloudflareProvider : undefined);
  const baseUrl = resolveProviderBaseUrl({
    provider,
    gateway,
    baseUrl: flags.baseUrl
      ?? (providerContextMatches && gatewayContextMatches ? fileConfig.baseUrl : undefined),
    cloudflareAccountId,
    cloudflareGatewayId,
    cloudflareProvider,
  });
  const apiKeyEnv = flags.apiKeyEnv
    ?? (providerContextMatches ? fileConfig.apiKeyEnv : undefined)
    ?? providerDefaultApiKeyEnv(provider);
  const apiKey = process.env[apiKeyEnv]?.trim() || '';
  const cloudflareByok = flags.cloudflareByok
    ?? (providerContextMatches && gatewayContextMatches ? fileConfig.cloudflareByok : undefined)
    ?? false;
  const cloudflareByokAlias = flags.cloudflareByokAlias
    ?? (providerContextMatches && gatewayContextMatches ? fileConfig.cloudflareByokAlias : undefined);
  if (cloudflareByok && gateway !== 'cloudflare') {
    throw new Error('--cloudflare-byok requires --gateway cloudflare');
  }
  if (cloudflareByokAlias && !cloudflareByok) {
    throw new Error('--cloudflare-byok-alias requires --cloudflare-byok');
  }
  const permitsMissingKey = cloudflareByok || (provider === 'openai-compatible' && isLocalBaseUrl(baseUrl));
  if (!apiKey && !permitsMissingKey && !flags.dryRun) {
    const providerLabel = provider === 'gemini' ? 'Gemini' : provider === 'kimi' ? 'Kimi' : provider === 'muse' ? 'Muse' : provider;
    throw new Error(`${providerLabel} API key is missing.\n${credentialSetupGuidance(apiKeyEnv, cwd, providerLabel)}`);
  }
  const gatewayTokenEnv = flags.cloudflareTokenEnv
    ?? fileConfig.cloudflareTokenEnv
    ?? 'CLOUDFLARE_AI_GATEWAY_TOKEN';
  const gatewayToken = gateway === 'cloudflare' ? process.env[gatewayTokenEnv]?.trim() : undefined;
  if (gateway === 'cloudflare' && cloudflareByok && !gatewayToken && !flags.dryRun) {
    throw new Error(`Cloudflare BYOK requires ${gatewayTokenEnv} for gateway authentication`);
  }
  const hasFlagPrice = flags.inputPrice !== undefined || flags.outputPrice !== undefined;
  const inputPricePerMillionUsd = optionalNumberInRange(
    hasFlagPrice
      ? flags.inputPrice
      : modelContextMatches ? fileConfig.inputPricePerMillionUsd : undefined,
    '--input-price',
    0,
    1_000_000,
  );
  const outputPricePerMillionUsd = optionalNumberInRange(
    hasFlagPrice
      ? flags.outputPrice
      : modelContextMatches ? fileConfig.outputPricePerMillionUsd : undefined,
    '--output-price',
    0,
    1_000_000,
  );
  if ((inputPricePerMillionUsd === undefined) !== (outputPricePerMillionUsd === undefined)) {
    throw new Error('--input-price and --output-price must be supplied together');
  }
  const maxCostUsd = optionalNumberInRange(
    flags.maxCost ?? fileConfig.maxCostUsd,
    '--max-cost',
    0.000001,
    1_000_000,
  );
  const canAccountCost = provider === 'openrouter' || providerTokenPrice({
    provider,
    model,
    inputPricePerMillionUsd,
    outputPricePerMillionUsd,
  }, 0) !== undefined;
  if (maxCostUsd !== undefined && !canAccountCost) {
    throw new Error(
      `--max-cost for ${provider}/${model} requires both --input-price and --output-price because the API does not report a portable cost`,
    );
  }

  return {
    provider,
    gateway,
    apiKey,
    apiKeyEnv,
    model,
    baseUrl,
    gatewayToken,
    gatewayTokenEnv,
    cloudflareAccountId,
    cloudflareGatewayId,
    cloudflareByok,
    cloudflareByokAlias,
    cloudflareProvider,
    inputPricePerMillionUsd,
    outputPricePerMillionUsd,
    thinking,
    // Thought summaries are an agent progress surface. Simple/template/web
    // extraction has no consumer for them, so requesting hidden summaries
    // would only spend output tokens without changing the returned artifact.
    includeThoughts: effectiveMode === 'agentic' && progress !== 'off',
    progress,
    mode: effectiveMode,
    preset,
    format,
    output: flags.output ?? fileConfig.output,
    concurrency: integer(flags.concurrency ?? fileConfig.concurrency, DEFAULT_CONFIG.concurrency, '--concurrency', 1, 16),
    retries: integer(flags.retries ?? fileConfig.retries, DEFAULT_CONFIG.retries, '--retries', 0, 10),
    timeoutSeconds: integer(flags.timeout ?? fileConfig.timeoutSeconds, DEFAULT_CONFIG.timeoutSeconds, '--timeout', 1, 3600),
    maxFiles: integer(flags.maxFiles ?? fileConfig.maxFiles, DEFAULT_CONFIG.maxFiles, '--max-files', 1, 100000),
    maxTotalMb: numberInRange(flags.maxTotalMb ?? fileConfig.maxTotalMb, DEFAULT_CONFIG.maxTotalMb, '--max-total-mb', 1, 1048576),
    excludes: [...(fileConfig.exclude ?? []), ...(flags.exclude ?? [])],
    instructions: [...(fileConfig.instructions ?? []), ...(flags.instruction ?? [])],
    hidden: flags.hidden ?? fileConfig.hidden ?? DEFAULT_CONFIG.hidden,
    resume: flags.resume ?? fileConfig.resume ?? DEFAULT_CONFIG.resume,
    overwrite: flags.overwrite ?? fileConfig.overwrite ?? DEFAULT_CONFIG.overwrite,
    forceUnlock: flags.forceUnlock ?? false,
    failFast: flags.failFast ?? fileConfig.failFast ?? DEFAULT_CONFIG.failFast,
    jsonl: flags.jsonl ?? DEFAULT_CONFIG.jsonl,
    dryRun: flags.dryRun ?? DEFAULT_CONFIG.dryRun,
    quiet: flags.quiet ?? DEFAULT_CONFIG.quiet,
    verbose: flags.verbose ?? DEFAULT_CONFIG.verbose,
    stdinName: flags.stdinName ?? DEFAULT_CONFIG.stdinName,
    stdinType: flags.stdinType,
    detectImages: flags.detectImages ?? fileConfig.detectImages ?? DEFAULT_CONFIG.detectImages,
    detectMath: flags.detectMath ?? fileConfig.detectMath ?? DEFAULT_CONFIG.detectMath,
    maxTokens,
    maxIterations: integer(flags.maxIterations ?? fileConfig.maxIterations, DEFAULT_CONFIG.maxIterations, '--max-iterations', 1, 20),
    confidenceThreshold: numberInRange(
      flags.confidenceThreshold ?? fileConfig.confidenceThreshold,
      DEFAULT_CONFIG.confidenceThreshold,
      '--confidence-threshold',
      0,
      1,
    ),
    schemaPath,
    maxCostUsd,
    requestsPerMinute: integer(
      flags.requestsPerMinute ?? fileConfig.requestsPerMinute,
      DEFAULT_CONFIG.requestsPerMinute,
      '--requests-per-minute',
      0,
      60_000,
    ),
    cwd,
  };
}
