import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { GeminiModel, ThinkingLevel } from '../lib/gemini';
import { getExtractionPreset } from '../lib/templates';
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
  | 'model'
  | 'thinking'
  | 'includeThoughts'
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
  model: 'gemini-3.5-flash',
  thinking: 'MEDIUM',
  includeThoughts: false,
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
  stdinName: 'stdin.pdf',
  detectImages: false,
  detectMath: false,
  maxTokens: 32768,
  maxIterations: 5,
  confidenceThreshold: 0.8,
  requestsPerMinute: 0,
};

function pickConfig(value: Record<string, unknown>, label: string): CliConfigFile {
  const stringKeys = ['model', 'thinking', 'mode', 'preset', 'format', 'output', 'apiKeyEnv', 'schema'] as const;
  const numberKeys = ['concurrency', 'retries', 'timeoutSeconds', 'maxFiles', 'maxTotalMb', 'maxTokens', 'maxIterations', 'confidenceThreshold', 'maxCostUsd', 'requestsPerMinute'] as const;
  const booleanKeys = ['includeThoughts', 'resume', 'overwrite', 'failFast', 'hidden', 'detectImages', 'detectMath'] as const;
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

export async function loadCliConfig(cwd: string, explicitPath?: string): Promise<CliConfigFile> {
  const userPath = path.join(homedir(), '.config', 'gemini-ocr', 'config.json');
  const projectPath = path.join(cwd, '.gemini-ocr.json');
  const [user, project] = await Promise.all([
    readConfigFile(userPath, false),
    readConfigFile(projectPath, false),
  ]);
  const explicit = explicitPath
    ? await readConfigFile(path.resolve(cwd, explicitPath), true)
    : {};
  return { ...user, ...project, ...explicit };
}

export function loadLocalEnv(cwd: string): void {
  const envPath = path.join(cwd, '.env');
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}

export function credentialSetupGuidance(apiKeyEnv: string, cwd: string): string {
  return [
    `Set ${apiKeyEnv} before running extraction:`,
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
  const model = oneOf<GeminiModel>(
    flags.model ?? process.env.GEMINI_OCR_MODEL ?? fileConfig.model,
    SUPPORTED_MODELS,
    '--model',
    DEFAULT_CONFIG.model,
  );
  let thinking = oneOf<ThinkingLevel>(
    (flags.thinking ?? process.env.GEMINI_OCR_THINKING ?? fileConfig.thinking)?.toUpperCase(),
    ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
    '--thinking',
    DEFAULT_CONFIG.thinking,
  );
  const schemaPath = flags.schema ?? fileConfig.schema;
  const mode = oneOf<CliMode>(flags.mode ?? fileConfig.mode, CLI_MODES, '--mode', DEFAULT_CONFIG.mode);
  const format = oneOf<CliFormat>(
    flags.format ?? fileConfig.format ?? (schemaPath ? 'json' : undefined),
    CLI_FORMATS,
    '--format',
    DEFAULT_CONFIG.format,
  );
  const preset = flags.preset ?? fileConfig.preset;
  const effectiveMode: CliMode = preset && !flags.mode && !fileConfig.mode ? 'template' : mode;

  if (model === 'gemini-3.1-pro-preview' && thinking === 'MINIMAL') thinking = 'LOW';
  if (effectiveMode === 'agentic' && thinking === 'MINIMAL') thinking = 'MEDIUM';
  if (schemaPath && preset) throw new Error('--schema cannot be combined with --preset');
  if (effectiveMode === 'template' && !preset) throw new Error('--preset is required when --mode template is selected');
  if (preset) getExtractionPreset(preset);
  if (format === 'csv' && effectiveMode !== 'template') throw new Error('--format csv is only available in template mode');
  if (schemaPath && effectiveMode !== 'simple') throw new Error('--schema is only available in simple mode');
  if (schemaPath && format !== 'json') throw new Error('--schema requires --format json');

  const apiKeyEnv = fileConfig.apiKeyEnv || 'GEMINI_API_KEY';
  const apiKey = process.env[apiKeyEnv]?.trim() || '';
  if (!apiKey && !flags.dryRun) {
    throw new Error(`Gemini API key is missing.\n${credentialSetupGuidance(apiKeyEnv, cwd)}`);
  }

  return {
    apiKey,
    model,
    thinking,
    includeThoughts: flags.includeThoughts ?? fileConfig.includeThoughts ?? DEFAULT_CONFIG.includeThoughts,
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
    maxTokens: integer(flags.maxTokens ?? fileConfig.maxTokens, DEFAULT_CONFIG.maxTokens, '--max-tokens', 256, 65536),
    maxIterations: integer(flags.maxIterations ?? fileConfig.maxIterations, DEFAULT_CONFIG.maxIterations, '--max-iterations', 1, 20),
    confidenceThreshold: numberInRange(
      flags.confidenceThreshold ?? fileConfig.confidenceThreshold,
      DEFAULT_CONFIG.confidenceThreshold,
      '--confidence-threshold',
      0,
      1,
    ),
    schemaPath,
    maxCostUsd: optionalNumberInRange(
      flags.maxCost ?? fileConfig.maxCostUsd,
      '--max-cost',
      0.000001,
      1_000_000,
    ),
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
