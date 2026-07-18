import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadCliConfig, loadLocalEnv, resolveCliOptions } from './config';
import { CliExitError } from './errors';
import { discoverInputs } from './inputs';
import { createOcrJobService } from './runner';
import type { OcrJobServiceResult } from './ocrJobService';
import { loadCustomSchema, validateCustomSchema } from './schema';
import {
  defaultAgentOutputDirectory,
  parseOcrJobRequest,
  type OcrJobEventSink,
  type OcrJobRequest,
} from './protocol';
import type { CliConfigFile, ExtractCommandFlags } from './types';

export interface ExecuteOcrJobOptions {
  cwd: string;
  runId: string;
  abortController: AbortController;
  eventSink?: OcrJobEventSink;
  onWarning?: (message: string) => void;
}

async function readStandardInput(): Promise<string> {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

export async function readOcrJobRequest(requestPath: string, cwd: string): Promise<OcrJobRequest> {
  const raw = requestPath === '-'
    ? await readStandardInput()
    : await readFile(path.resolve(cwd, requestPath), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new CliExitError(
      `OCR request JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      2,
      {
        cause: error,
        code: 'CONFIG_INVALID',
        category: 'configuration',
        retryable: false,
        hint: 'Fix the request JSON syntax, then validate it again.',
      },
    );
  }
  return parseOcrJobRequest(parsed);
}

function requestFlags(request: OcrJobRequest, outputDirectory: string): ExtractCommandFlags {
  return {
    config: request.configPath,
    provider: request.provider?.id,
    gateway: request.provider?.gateway,
    model: request.provider?.model,
    mode: request.extraction?.mode,
    preset: request.extraction?.preset,
    format: request.extraction?.schema || request.extraction?.schemaPath
      ? 'json'
      : request.extraction?.contentFormat,
    schema: request.extraction?.schemaPath,
    customSchema: request.extraction?.schema !== undefined,
    instruction: request.extraction?.instructions,
    thinking: request.extraction?.thinking,
    detectImages: request.extraction?.detectImages,
    detectMath: request.extraction?.detectMath,
    maxTokens: request.extraction?.maxTokens?.toString(),
    maxIterations: request.extraction?.maxIterations?.toString(),
    confidenceThreshold: request.extraction?.confidenceThreshold?.toString(),
    concurrency: request.execution?.concurrency?.toString(),
    retries: request.execution?.retries?.toString(),
    timeout: request.execution?.timeoutSeconds?.toString(),
    maxFiles: request.execution?.maxFiles?.toString(),
    maxTotalMb: request.execution?.maxTotalMb?.toString(),
    maxCost: request.execution?.maxCostUsd?.toString(),
    requestsPerMinute: request.execution?.requestsPerMinute?.toString(),
    failFast: request.execution?.failFast,
    hidden: request.discovery?.hidden,
    exclude: request.discovery?.exclude,
    output: outputDirectory,
    resume: request.delivery?.resume ?? true,
    overwrite: false,
    includeThoughts: false,
    jsonl: false,
    quiet: true,
    verbose: false,
    dryRun: request.dryRun,
  };
}

function machineConfigurationError(request: OcrJobRequest, fileConfig: CliConfigFile): string | undefined {
  const requestExtraction = request.extraction;
  const requestHasSchema = requestExtraction?.schema !== undefined || requestExtraction?.schemaPath !== undefined;
  const hasSchema = requestHasSchema || fileConfig.schema !== undefined;
  const preset = requestExtraction?.preset ?? fileConfig.preset;
  const configuredMode = requestExtraction?.mode ?? fileConfig.mode;
  const mode = configuredMode ?? (preset ? 'template' : 'simple');
  const format = requestExtraction?.contentFormat ?? fileConfig.format ?? (hasSchema ? 'json' : 'markdown');
  if (hasSchema && preset) {
    return 'OCR request custom schemas cannot be combined with an extraction preset from the request or configuration.';
  }
  if (mode === 'template' && !preset) {
    return 'OCR request template mode requires an extraction preset in the request or configuration.';
  }
  if (preset && mode !== 'template') {
    return 'OCR request extraction presets require template mode.';
  }
  if (hasSchema && mode !== 'simple') {
    return 'OCR request custom schemas require simple mode.';
  }
  if (hasSchema && format !== 'json') {
    return 'OCR request custom schemas require JSON content format.';
  }
  if (format === 'csv' && mode !== 'template') {
    return 'OCR request CSV content format requires template mode and a preset.';
  }
  return undefined;
}

function configurationError(message: string): CliExitError {
  return new CliExitError(message, 2, {
    code: 'CONFIG_INVALID',
    category: 'configuration',
    retryable: false,
    hint: 'Adjust the request or referenced configuration, then run a dry-run validation.',
  });
}

function schemaError(error: unknown): CliExitError {
  return new CliExitError(error instanceof Error ? error.message : String(error), 2, {
    cause: error,
    code: 'SCHEMA_INVALID',
    category: 'schema',
    retryable: false,
    hint: 'Validate the custom schema against the supported structured-output subset.',
  });
}

export async function executeOcrJobRequest(
  request: OcrJobRequest,
  execution: ExecuteOcrJobOptions,
): Promise<OcrJobServiceResult> {
  if (request.inputs.some((input) => input.path === '-')) {
    throw configurationError(
      'OCR requests accept file, directory, and glob paths; stdin document input is not supported.',
    );
  }
  loadLocalEnv(execution.cwd);
  const fileConfig = await loadCliConfig(execution.cwd, request.configPath);
  const invalidConfiguration = machineConfigurationError(request, fileConfig);
  if (invalidConfiguration) throw configurationError(invalidConfiguration);

  // Validate schema content before option resolution can require credentials.
  let customSchema: Record<string, unknown> | undefined;
  try {
    customSchema = request.extraction?.schema
      ? validateCustomSchema(request.extraction.schema)
      : request.extraction?.schemaPath
        ? await loadCustomSchema(request.extraction.schemaPath, execution.cwd)
        : fileConfig.schema
          ? await loadCustomSchema(fileConfig.schema, execution.cwd)
          : undefined;
  } catch (error) {
    throw schemaError(error);
  }
  const outputDirectory = request.delivery?.outputDirectory
    ? path.resolve(execution.cwd, request.delivery.outputDirectory)
    : defaultAgentOutputDirectory(execution.cwd, execution.runId);
  const effectiveFileConfig = request.extraction?.schema !== undefined
    ? { ...fileConfig, schema: undefined }
    : fileConfig;
  const options = {
    ...resolveCliOptions(requestFlags(request, outputDirectory), effectiveFileConfig, execution.cwd),
    customSchema,
  };
  const inputs = await discoverInputs(request.inputs.map((input) => input.path), options);
  return createOcrJobService().run(inputs, options, {
    runId: execution.runId,
    abortController: execution.abortController,
    eventSink: execution.eventSink,
    onWarning: execution.onWarning,
    enableSingleInputResume: true,
  });
}
