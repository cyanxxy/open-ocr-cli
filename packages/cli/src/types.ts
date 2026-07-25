import type { AgentMemory, AgentStep } from '../../../src/lib/agentTypes';
import type {
  ExtractedContent,
  JsonValue,
  PresetStructuredOutput,
  ThinkingLevel,
} from '../../../src/lib/gemini';
import {
  GEMINI_MODELS,
  type GatewayId,
  type ProviderId,
  type ProviderUsageSnapshot,
} from '../../../src/lib/providers';
import type { OcrErrorPayload } from './errors';

export const CLI_MODES = ['simple', 'template', 'agentic'] as const;
export type CliMode = (typeof CLI_MODES)[number];

export const CLI_FORMATS = ['markdown', 'json', 'csv', 'all'] as const;
export type CliFormat = (typeof CLI_FORMATS)[number];

export const SUPPORTED_MODELS = GEMINI_MODELS;

export interface CliConfigFile {
  provider?: ProviderId;
  gateway?: GatewayId;
  model?: string;
  baseUrl?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  cloudflareTokenEnv?: string;
  cloudflareByok?: boolean;
  cloudflareByokAlias?: string;
  cloudflareProvider?: string;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
  thinking?: ThinkingLevel;
  includeThoughts?: boolean;
  progress?: 'off' | 'standard' | 'detailed';
  mode?: CliMode;
  preset?: string;
  format?: CliFormat;
  output?: string;
  concurrency?: number;
  retries?: number;
  timeoutSeconds?: number;
  maxFiles?: number;
  maxTotalMb?: number;
  resume?: boolean;
  overwrite?: boolean;
  failFast?: boolean;
  hidden?: boolean;
  exclude?: string[];
  instructions?: string[];
  detectImages?: boolean;
  detectMath?: boolean;
  maxTokens?: number;
  maxIterations?: number;
  confidenceThreshold?: number;
  apiKeyEnv?: string;
  schema?: string;
  maxCostUsd?: number;
  requestsPerMinute?: number;
}

export interface ExtractCommandFlags {
  /** String for --config; Commander's negated --no-config form stores `false`. */
  config?: string | false;
  provider?: string;
  gateway?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  cloudflareTokenEnv?: string;
  cloudflareByok?: boolean;
  cloudflareByokAlias?: string;
  cloudflareProvider?: string;
  inputPrice?: string;
  outputPrice?: string;
  mode?: string;
  preset?: string;
  format?: string;
  output?: string;
  model?: string;
  thinking?: string;
  includeThoughts?: boolean;
  progress?: string;
  concurrency?: string;
  retries?: string;
  timeout?: string;
  maxFiles?: string;
  maxTotalMb?: string;
  exclude?: string[];
  instruction?: string[];
  hidden?: boolean;
  resume?: boolean;
  overwrite?: boolean;
  forceUnlock?: boolean;
  failFast?: boolean;
  jsonl?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  stdinName?: string;
  stdinType?: string;
  detectImages?: boolean;
  detectMath?: boolean;
  maxTokens?: string;
  maxIterations?: string;
  confidenceThreshold?: string;
  schema?: string;
  /** Internal machine-adapter signal for an already-validated in-memory schema. */
  customSchema?: boolean;
  maxCost?: string;
  requestsPerMinute?: string;
}

export interface ResolvedCliOptions {
  provider: ProviderId;
  gateway: GatewayId;
  apiKey: string;
  apiKeyEnv: string;
  model: string;
  baseUrl: string;
  gatewayToken?: string;
  gatewayTokenEnv?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  cloudflareByok: boolean;
  cloudflareByokAlias?: string;
  cloudflareProvider?: string;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
  thinking: ThinkingLevel;
  includeThoughts: boolean;
  progress: 'off' | 'standard' | 'detailed';
  mode: CliMode;
  preset?: string;
  format: CliFormat;
  output?: string;
  concurrency: number;
  retries: number;
  timeoutSeconds: number;
  maxFiles: number;
  maxTotalMb: number;
  excludes: string[];
  instructions: string[];
  hidden: boolean;
  resume: boolean;
  overwrite: boolean;
  forceUnlock: boolean;
  failFast: boolean;
  jsonl: boolean;
  dryRun: boolean;
  quiet: boolean;
  verbose: boolean;
  stdinName: string;
  stdinType?: string;
  detectImages: boolean;
  detectMath: boolean;
  maxTokens: number;
  maxIterations: number;
  confidenceThreshold: number;
  schemaPath?: string;
  customSchema?: Record<string, unknown>;
  maxCostUsd?: number;
  requestsPerMinute: number;
  cwd: string;
}

export interface ResolvedInput {
  absolutePath?: string;
  displayPath: string;
  relativePath: string;
  name: string;
  mimeType: string;
  size: number;
  mtimeMs: number;
  stdinBytes?: Uint8Array;
}

export interface OcrArtifacts {
  markdown?: string;
  json?: ExtractedContent | PresetStructuredOutput | AgentMemory | JsonValue;
  csv?: string;
  agentSteps?: AgentStep[];
}

export interface OcrJobResult {
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  input: ResolvedInput;
  mode: CliMode;
  provider?: ProviderId;
  gateway?: GatewayId;
  model: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  artifacts?: OcrArtifacts;
  outputFiles?: string[];
  plannedOutputFiles?: string[];
  skipReason?: 'validated' | 'resumed' | 'cancelled' | 'cost-limit' | 'fail-fast';
  error?: string;
  errorDetails?: OcrErrorPayload;
  attempts: number;
}

export interface BatchSummary {
  version: 1;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  mode: CliMode;
  provider?: ProviderId;
  gateway?: GatewayId;
  model: string;
  usage: ProviderUsageSnapshot;
  costLimitUsd?: number;
  costLimitReached: boolean;
  results: OcrJobResult[];
}

export interface ManifestEntry {
  fingerprint: string;
  status: 'succeeded' | 'partial' | 'failed';
  outputFiles: string[];
  completedAt: string;
  error?: string;
}

export interface CliManifest {
  version: 1;
  entries: Record<string, ManifestEntry>;
}
