import { createHash } from 'node:crypto';
import path from 'node:path';

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { FILE_CONSTRAINTS } from '../constants';
import { PROVIDER_PROFILES, type GatewayId, type ProviderId, type ProviderUsageSnapshot } from '../lib/providers';
import { listExtractionPresets } from '../lib/templates';
import capabilitiesSchema from '../../packages/cli/schemas/capabilities-v1.schema.json';
import errorSchema from '../../packages/cli/schemas/error-v1.schema.json';
import eventSchema from '../../packages/cli/schemas/event-v1.schema.json';
import requestSchema from '../../packages/cli/schemas/request-v1.schema.json';
import resultSchema from '../../packages/cli/schemas/result-v1.schema.json';
import { CliExitError, OCR_ERROR_CODES, type OcrErrorCode, type OcrErrorPayload } from './errors';
import type { BatchSummary, CliFormat, CliMode, OcrJobResult } from './types';

export const OCR_PROTOCOL_VERSION = 1 as const;
export const OCR_PROTOCOL_SCHEMA_IDS = {
  request: requestSchema.$id,
  result: resultSchema.$id,
  event: eventSchema.$id,
  error: errorSchema.$id,
  capabilities: capabilitiesSchema.$id,
} as const;

export const OCR_PROTOCOL_SCHEMAS = {
  request: requestSchema,
  result: resultSchema,
  event: eventSchema,
  error: errorSchema,
  capabilities: capabilitiesSchema,
} as const;

export interface OcrJobRequestInput {
  type: 'path';
  path: string;
}

export interface OcrJobRequest {
  protocolVersion: 1;
  operation: 'extract';
  inputs: OcrJobRequestInput[];
  configPath?: string;
  provider?: {
    id?: ProviderId;
    gateway?: GatewayId;
    model?: string;
  };
  extraction?: {
    mode?: CliMode;
    preset?: string;
    contentFormat?: CliFormat;
    schema?: Record<string, unknown>;
    schemaPath?: string;
    instructions?: string[];
    thinking?: 'minimal' | 'low' | 'medium' | 'high';
    detectImages?: boolean;
    detectMath?: boolean;
    maxTokens?: number;
    maxIterations?: number;
    confidenceThreshold?: number;
  };
  execution?: {
    concurrency?: number;
    retries?: number;
    timeoutSeconds?: number;
    maxFiles?: number;
    maxTotalMb?: number;
    maxCostUsd?: number;
    requestsPerMinute?: number;
    failFast?: boolean;
  };
  discovery?: {
    hidden?: boolean;
    exclude?: string[];
  };
  delivery?: {
    mode?: 'reference';
    outputDirectory?: string;
    resume?: boolean;
  };
  dryRun?: boolean;
}

export interface OcrArtifactReference {
  path: string;
  mediaType: string;
  kind: 'markdown' | 'json' | 'csv' | 'agent-steps';
}

export interface OcrProtocolDocument {
  documentId: string;
  source: string;
  status: OcrJobResult['status'];
  mode: CliMode;
  provider: ProviderId;
  gateway: GatewayId;
  model: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  attempts: number;
  skipReason?: OcrJobResult['skipReason'];
  artifacts: OcrArtifactReference[];
  plannedArtifacts: OcrArtifactReference[];
  error?: OcrErrorPayload;
}

export interface OcrRunResult {
  protocolVersion: 1;
  type: 'run.result';
  ok: boolean;
  runId: string;
  status: 'succeeded' | 'partial' | 'failed' | 'validated' | 'cancelled' | 'cost_limited';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  mode: CliMode;
  provider: ProviderId;
  gateway: GatewayId;
  model: string;
  usage: ProviderUsageSnapshot;
  costLimitUsd?: number;
  costLimitReached: boolean;
  documents: OcrProtocolDocument[];
}

export interface OcrRunFailure {
  protocolVersion: 1;
  type: 'run.result';
  ok: false;
  runId: string;
  status: 'failed';
  error: OcrErrorPayload;
}

export type OcrMachineResult = OcrRunResult | OcrRunFailure;

export type OcrEventType =
  | 'run.started'
  | 'document.started'
  | 'document.progress'
  | 'document.completed'
  | 'document.partial'
  | 'document.failed'
  | 'document.skipped'
  | 'run.completed'
  | 'run.failed';

export interface OcrJobEvent {
  protocolVersion: 1;
  type: OcrEventType;
  runId: string;
  sequence: number;
  timestamp: string;
  total?: number;
  provider?: ProviderId;
  gateway?: GatewayId;
  model?: string;
  mode?: CliMode;
  dryRun?: boolean;
  documentId?: string;
  index?: number;
  source?: string;
  phase?: string;
  message?: string;
  document?: OcrProtocolDocument;
  result?: OcrMachineResult;
  error?: OcrErrorPayload;
}

export type OcrJobEventSink = (event: OcrJobEvent) => void | Promise<void>;

export interface OcrCapabilities {
  protocolVersion: 1;
  cliVersion: string;
  operations: ['extract'];
  inputKinds: ['path'];
  modes: CliMode[];
  contentFormats: CliFormat[];
  responseFormats: ['json', 'jsonl'];
  deliveryModes: ['reference'];
  features: string[];
  errorCodes: OcrErrorCode[];
  exitCodes: {
    success: 0;
    incomplete: 1;
    invalid: 2;
    interrupted: 130;
    terminated: 143;
  };
  providers: Array<Record<string, unknown>>;
  presets: Array<Record<string, unknown>>;
  limits: Record<string, unknown>;
  schemas: typeof OCR_PROTOCOL_SCHEMA_IDS;
  schemaAccess: {
    command: 'open-ocr-cli schema <name>';
    packageDirectory: 'schemas';
    networkFetch: false;
  };
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
ajv.addSchema(errorSchema);
ajv.addSchema(resultSchema);
function requireValidator<T>(validator: ValidateFunction<T> | undefined, label: string): ValidateFunction<T> {
  if (!validator) throw new Error(`Could not compile the ${label} schema`);
  return validator;
}
const requestValidator: ValidateFunction<OcrJobRequest> = ajv.compile(requestSchema);
const resultValidator = requireValidator(ajv.getSchema<OcrMachineResult>(resultSchema.$id), 'OCR result');
const eventValidator: ValidateFunction<OcrJobEvent> = ajv.compile(eventSchema);
const capabilitiesValidator: ValidateFunction<OcrCapabilities> = ajv.compile(capabilitiesSchema);

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
}

function assertValid<T>(
  validator: ValidateFunction<T>,
  value: unknown,
  label: string,
  requestPayload = false,
): asserts value is T {
  if (validator(value)) return;
  throw new CliExitError(`${label}: ${validationMessage(validator.errors)}`, 2, {
    code: requestPayload ? 'CONFIG_INVALID' : 'SCHEMA_INVALID',
    category: requestPayload ? 'configuration' : 'schema',
    retryable: false,
    hint: requestPayload
      ? 'Compare the request with protocol v1 using open-ocr-cli schema request.'
      : `Compare the payload with ${label.toLowerCase()} schema v1.`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestSemanticError(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.extraction)) return undefined;
  const extraction = value.extraction;
  const hasSchema = isRecord(extraction.schema) || typeof extraction.schemaPath === 'string';
  const hasPreset = typeof extraction.preset === 'string';
  const mode = typeof extraction.mode === 'string' ? extraction.mode : undefined;
  const format = typeof extraction.contentFormat === 'string' ? extraction.contentFormat : undefined;
  if (isRecord(extraction.schema) && typeof extraction.schemaPath === 'string') {
    return 'OCR request extraction.schema and extraction.schemaPath are mutually exclusive.';
  }
  if (hasPreset && hasSchema) {
    return 'OCR request extraction.preset cannot be combined with extraction.schema or extraction.schemaPath.';
  }
  if (mode === 'template' && !hasPreset) {
    return 'OCR request extraction.preset is required when extraction.mode is template.';
  }
  if (hasPreset && mode !== undefined && mode !== 'template') {
    return 'OCR request extraction.preset requires extraction.mode to be template or omitted.';
  }
  if (hasSchema && mode !== undefined && mode !== 'simple') {
    return 'OCR request custom schemas require extraction.mode to be simple or omitted.';
  }
  if (hasSchema && format !== undefined && format !== 'json') {
    return 'OCR request custom schemas require extraction.contentFormat to be json or omitted.';
  }
  if (format === 'csv' && mode !== 'template' && !(mode === undefined && hasPreset)) {
    return 'OCR request extraction.contentFormat csv requires template mode and a preset.';
  }
  return undefined;
}

export function parseOcrJobRequest(value: unknown): OcrJobRequest {
  const semanticError = requestSemanticError(value);
  if (semanticError) {
    throw new CliExitError(semanticError, 2, {
      code: 'CONFIG_INVALID',
      category: 'configuration',
      retryable: false,
      hint: 'Adjust the extraction fields and validate the request again before running OCR.',
    });
  }
  assertValid(requestValidator, value, 'Invalid OCR request', true);
  return value;
}

export function assertOcrMachineResult(value: unknown): asserts value is OcrMachineResult {
  assertValid(resultValidator, value, 'Invalid OCR result');
}

export function assertOcrJobEvent(value: unknown): asserts value is OcrJobEvent {
  assertValid(eventValidator, value, 'Invalid OCR event');
}

export function assertOcrCapabilities(value: unknown): asserts value is OcrCapabilities {
  assertValid(capabilitiesValidator, value, 'Invalid OCR capabilities');
}

function artifactReference(filePath: string): OcrArtifactReference {
  if (filePath.endsWith('.steps.json')) return { path: filePath, mediaType: 'application/json', kind: 'agent-steps' };
  if (filePath.endsWith('.json')) return { path: filePath, mediaType: 'application/json', kind: 'json' };
  if (filePath.endsWith('.csv')) return { path: filePath, mediaType: 'text/csv', kind: 'csv' };
  return { path: filePath, mediaType: 'text/markdown', kind: 'markdown' };
}

export function ocrDocumentId(result: Pick<OcrJobResult, 'input'>): string {
  const identity = result.input.absolutePath ?? `${result.input.displayPath}:${result.input.size}:${result.input.mtimeMs}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

export function toProtocolDocument(result: OcrJobResult): OcrProtocolDocument {
  if (!result.provider || !result.gateway) throw new Error('Protocol documents require provider and gateway metadata');
  return {
    documentId: ocrDocumentId(result),
    source: result.input.displayPath,
    status: result.status,
    mode: result.mode,
    provider: result.provider,
    gateway: result.gateway,
    model: result.model,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    attempts: result.attempts,
    ...(result.skipReason ? { skipReason: result.skipReason } : {}),
    artifacts: (result.outputFiles ?? []).map(artifactReference),
    plannedArtifacts: (result.plannedOutputFiles ?? []).map(artifactReference),
    ...(result.errorDetails ? { error: result.errorDetails } : {}),
  };
}

function runStatus(summary: BatchSummary): OcrRunResult['status'] {
  if (summary.costLimitReached) return 'cost_limited';
  if (summary.results.some((result) => result.skipReason === 'cancelled')) return 'cancelled';
  if (summary.results.every((result) => result.skipReason === 'validated')) return 'validated';
  if (summary.failed > 0) return summary.succeeded > 0 || summary.partial > 0 ? 'partial' : 'failed';
  if (summary.partial > 0) return 'partial';
  return 'succeeded';
}

export function toOcrRunResult(runId: string, summary: BatchSummary): OcrRunResult {
  if (!summary.provider || !summary.gateway) throw new Error('Protocol results require provider and gateway metadata');
  const status = runStatus(summary);
  const result: OcrRunResult = {
    protocolVersion: OCR_PROTOCOL_VERSION,
    type: 'run.result',
    ok: status === 'succeeded' || status === 'validated',
    runId,
    status,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
    durationMs: summary.durationMs,
    total: summary.total,
    succeeded: summary.succeeded,
    partial: summary.partial,
    failed: summary.failed,
    skipped: summary.skipped,
    mode: summary.mode,
    provider: summary.provider,
    gateway: summary.gateway,
    model: summary.model,
    usage: summary.usage,
    ...(summary.costLimitUsd !== undefined ? { costLimitUsd: summary.costLimitUsd } : {}),
    costLimitReached: summary.costLimitReached,
    documents: summary.results.map(toProtocolDocument),
  };
  assertOcrMachineResult(result);
  return result;
}

export function toOcrRunFailure(runId: string, error: OcrErrorPayload): OcrRunFailure {
  const result: OcrRunFailure = {
    protocolVersion: OCR_PROTOCOL_VERSION,
    type: 'run.result',
    ok: false,
    runId,
    status: 'failed',
    error,
  };
  assertOcrMachineResult(result);
  return result;
}

export function createOcrCapabilities(cliVersion: string): OcrCapabilities {
  const capabilities: OcrCapabilities = {
    protocolVersion: OCR_PROTOCOL_VERSION,
    cliVersion,
    operations: ['extract'],
    inputKinds: ['path'],
    modes: ['simple', 'template', 'agentic'],
    contentFormats: ['markdown', 'json', 'csv', 'all'],
    responseFormats: ['json', 'jsonl'],
    deliveryModes: ['reference'],
    features: [
      'custom-json-schema',
      'credential-free-dry-run',
      'ordered-jsonl-events',
      'reference-first-artifacts',
      'resume',
      'request-rate-limit',
      'cost-limit',
      'typed-errors',
    ],
    errorCodes: [...OCR_ERROR_CODES],
    exitCodes: {
      success: 0,
      incomplete: 1,
      invalid: 2,
      interrupted: 130,
      terminated: 143,
    },
    providers: Object.values(PROVIDER_PROFILES).map((profile) => ({
      id: profile.id,
      label: profile.label,
      defaultModel: profile.defaultModel ?? null,
      models: [...profile.models],
      capabilities: profile.capabilities,
    })),
    presets: listExtractionPresets().map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      outputShape: preset.outputShape,
    })),
    limits: {
      imageBytes: FILE_CONSTRAINTS.MAX_IMAGE_SIZE,
      pdfBytes: FILE_CONSTRAINTS.MAX_PDF_SIZE,
      pdfPages: FILE_CONSTRAINTS.MAX_PDF_PAGES,
      batchFiles: 100_000,
      concurrency: 16,
      customSchemaBytes: 1024 * 1024,
      customSchemaDepth: 32,
    },
    schemas: OCR_PROTOCOL_SCHEMA_IDS,
    schemaAccess: {
      command: 'open-ocr-cli schema <name>',
      packageDirectory: 'schemas',
      networkFetch: false,
    },
  };
  assertOcrCapabilities(capabilities);
  return capabilities;
}

export function defaultAgentOutputDirectory(cwd: string, runId: string): string {
  return path.join(cwd, '.open-ocr-results', runId);
}
