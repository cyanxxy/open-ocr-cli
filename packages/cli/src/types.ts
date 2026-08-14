import type { AgentMemory, AgentStep } from '@open-ocr/engine/agentTypes';
import type {
  ExtractedContent,
  JsonValue,
  PresetStructuredOutput,
  ThinkingLevel,
} from '@open-ocr/engine/gemini';
import {
  GEMINI_MODELS,
  type GatewayId,
  type ProviderId,
  type ProviderUsageSnapshot,
} from '@open-ocr/engine/providers';
import type { OcrErrorPayload } from './errors';
import type { ArtifactTarget } from './output';

export const CLI_MODES = ['simple', 'template', 'agentic'] as const;
export type CliMode = (typeof CLI_MODES)[number];
export type OutputPathKind = 'auto' | 'file' | 'directory';

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
  /** Prune node_modules, dist, build, vendor, and target from directory scans. */
  defaultExcludes?: boolean;
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
  /**
   * How to interpret `output`. Human `extract -o` uses `auto`, Web OCR names a
   * file, and machine `delivery.outputDirectory` names a directory.
   */
  outputPathKind?: OutputPathKind;
  model?: string;
  thinking?: string;
  progress?: string;
  concurrency?: string;
  retries?: string;
  timeout?: string;
  maxFiles?: string;
  maxTotalMb?: string;
  exclude?: string[];
  instruction?: string[];
  hidden?: boolean;
  defaultExcludes?: boolean;
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
  /** See {@link ExtractCommandFlags.outputPathKind}. */
  outputPathKind: OutputPathKind;
  concurrency: number;
  retries: number;
  timeoutSeconds: number;
  maxFiles: number;
  maxTotalMb: number;
  excludes: string[];
  instructions: string[];
  hidden: boolean;
  /** Whether directory scans prune well-known dependency and build-output trees. */
  defaultExcludes: boolean;
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
  /**
   * The same destinations as {@link outputFiles}, each paired with the artifact
   * key that produced it. The protocol reads `kind`/`mediaType` from here rather
   * than guessing them from the filename, which is wrong whenever `--output`
   * names a file whose extension disagrees with `--format`. The plain path lists
   * stay because the manifest, resume, JSONL, and status surfaces consume them.
   */
  outputArtifacts?: ArtifactTarget[];
  plannedOutputArtifacts?: ArtifactTarget[];
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
