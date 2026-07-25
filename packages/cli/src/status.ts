import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { GATEWAY_IDS, GEMINI_MODELS, PROVIDER_IDS } from '../../../src/lib/providers';
import { asRecord, isIsoTimestamp, parseBatchLockOwner } from './jsonValidation';
import { parseCliManifest } from './manifest';
import {
  CLI_MODES,
  type BatchSummary,
  type ManifestEntry,
  type OcrJobResult,
} from './types';

export interface BatchStatusEntry {
  source: string;
  status: ManifestEntry['status'];
  completedAt: string;
  outputFiles: string[];
  missingOutputFiles: string[];
  sourceExists: boolean;
  error?: string;
}

export interface BatchStatusLock {
  path: string;
  ownerValid: boolean;
  pid?: number;
  hostname?: string;
  startedAt?: string;
}

export interface BatchStatusReport {
  outputDirectory: string;
  manifestPath: string;
  summaryPath: string;
  lockPath: string;
  manifestPresent: boolean;
  summaryPresent: boolean;
  activeLock?: BatchStatusLock;
  lastRun?: Pick<
    BatchSummary,
    | 'startedAt'
    | 'completedAt'
    | 'durationMs'
    | 'mode'
    | 'provider'
    | 'gateway'
    | 'model'
    | 'usage'
    | 'costLimitReached'
  > & {
    incomplete: boolean;
  };
  counts: {
    total: number;
    succeeded: number;
    partial: number;
    failed: number;
    skipped: number;
    missingArtifacts: number;
    missingSources: number;
  };
  sourceDrift: boolean;
  healthy: boolean;
  entries: BatchStatusEntry[];
}

interface ParsedSummary {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  mode: BatchSummary['mode'];
  provider: NonNullable<BatchSummary['provider']>;
  gateway: NonNullable<BatchSummary['gateway']>;
  model: BatchSummary['model'];
  usage: BatchSummary['usage'];
  costLimitReached: boolean;
  results: Array<Pick<OcrJobResult, 'status' | 'skipReason'>>;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    throw error;
  }
}

async function readBatchLockIfPresent(lockPath: string): Promise<BatchStatusLock | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(lockPath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) return { path: lockPath, ownerValid: false };
    throw error;
  }
  const owner = parseBatchLockOwner(value);
  if (!owner) return { path: lockPath, ownerValid: false };
  return {
    path: lockPath,
    ownerValid: true,
    pid: owner.pid,
    hostname: owner.hostname,
    startedAt: owner.startedAt,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function parseSummaryResult(value: unknown, label: string): Pick<OcrJobResult, 'status' | 'skipReason'> {
  const record = asRecord(value, label);
  if (
    record.status !== 'succeeded'
    && record.status !== 'partial'
    && record.status !== 'failed'
    && record.status !== 'skipped'
  ) {
    throw new Error(`${label} has an invalid status`);
  }
  const allowedSkipReasons: ReadonlyArray<OcrJobResult['skipReason']> = [
    undefined,
    'validated',
    'resumed',
    'cancelled',
    'cost-limit',
    'fail-fast',
  ];
  if (!allowedSkipReasons.includes(record.skipReason as OcrJobResult['skipReason'])) {
    throw new Error(`${label} has an invalid skipReason`);
  }
  if (record.status !== 'skipped' && record.skipReason !== undefined) {
    throw new Error(`${label} has a skipReason but is not skipped`);
  }
  return {
    status: record.status,
    ...(record.skipReason ? { skipReason: record.skipReason as NonNullable<OcrJobResult['skipReason']> } : {}),
  };
}

function parseSummary(value: unknown, summaryPath: string): ParsedSummary | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, summaryPath);
  const countKeys = ['total', 'succeeded', 'partial', 'failed', 'skipped'] as const;
  const usage = asRecord(record.usage, `${summaryPath}: usage`);
  const usageIntegerKeys = [
    'requests',
    'inputTokens',
    'outputTokens',
    'thoughtTokens',
    'toolTokens',
    'cachedTokens',
    'totalTokens',
  ] as const;
  const provider = record.provider;
  const gateway = record.gateway;
  const hasValidProviderMetadata = provider === undefined && gateway === undefined
    ? GEMINI_MODELS.includes(record.model as (typeof GEMINI_MODELS)[number])
    : PROVIDER_IDS.includes(provider as (typeof PROVIDER_IDS)[number])
      && GATEWAY_IDS.includes(gateway as (typeof GATEWAY_IDS)[number])
      && (provider !== 'gemini' || GEMINI_MODELS.includes(record.model as (typeof GEMINI_MODELS)[number]));
  if (
    record.version !== 1
    || !isIsoTimestamp(record.startedAt)
    || !isIsoTimestamp(record.completedAt)
    || Date.parse(record.completedAt) < Date.parse(record.startedAt)
    || !CLI_MODES.includes(record.mode as BatchSummary['mode'])
    || typeof record.model !== 'string'
    || record.model.trim().length === 0
    || !hasValidProviderMetadata
    || !isNonNegativeNumber(record.durationMs)
    || countKeys.some((key) => !isNonNegativeInteger(record[key]))
    || usageIntegerKeys.some((key) => !isNonNegativeInteger(usage[key]))
    || !isNonNegativeNumber(usage.estimatedCostUsd)
    || typeof record.costLimitReached !== 'boolean'
    || !Array.isArray(record.results)
  ) {
    throw new Error(`Invalid batch summary in ${summaryPath}`);
  }
  const total = record.total as number;
  const succeeded = record.succeeded as number;
  const partial = record.partial as number;
  const failed = record.failed as number;
  const skipped = record.skipped as number;
  const results = (record.results as unknown[]).map((result, index) => (
    parseSummaryResult(result, `${summaryPath}: result ${index + 1}`)
  ));
  if (
    results.length !== total
    || succeeded + partial + failed + skipped !== total
    || results.filter((result) => result.status === 'succeeded').length !== succeeded
    || results.filter((result) => result.status === 'partial').length !== partial
    || results.filter((result) => result.status === 'failed').length !== failed
    || results.filter((result) => result.status === 'skipped').length !== skipped
  ) {
    throw new Error(`Invalid batch summary counts in ${summaryPath}`);
  }
  return {
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    total,
    succeeded,
    partial,
    failed,
    skipped,
    mode: record.mode as BatchSummary['mode'],
    provider: (provider ?? 'gemini') as NonNullable<BatchSummary['provider']>,
    gateway: (gateway ?? 'direct') as NonNullable<BatchSummary['gateway']>,
    model: record.model,
    usage: {
      requests: usage.requests as number,
      inputTokens: usage.inputTokens as number,
      outputTokens: usage.outputTokens as number,
      thoughtTokens: usage.thoughtTokens as number,
      toolTokens: usage.toolTokens as number,
      cachedTokens: usage.cachedTokens as number,
      totalTokens: usage.totalTokens as number,
      estimatedCostUsd: usage.estimatedCostUsd,
    },
    costLimitReached: record.costLimitReached,
    results,
  };
}

export async function inspectBatchStatus(
  output: string,
  cwd: string,
): Promise<BatchStatusReport> {
  const outputDirectory = path.resolve(cwd, output);
  const manifestPath = path.join(outputDirectory, '.gemini-ocr-manifest.json');
  const summaryPath = path.join(outputDirectory, 'batch-summary.json');
  const lockPath = path.join(outputDirectory, '.gemini-ocr.lock');
  const [manifestValue, summaryValue, activeLock] = await Promise.all([
    readJsonIfPresent(manifestPath),
    readJsonIfPresent(summaryPath),
    readBatchLockIfPresent(lockPath),
  ]);
  if (manifestValue === undefined && summaryValue === undefined && activeLock === undefined) {
    throw new Error(`No Open OCR batch metadata found in ${outputDirectory}`);
  }
  const manifest = manifestValue === undefined
    ? undefined
    : parseCliManifest(manifestValue, manifestPath);
  const summary = parseSummary(summaryValue, summaryPath);
  const entries = await Promise.all(Object.entries(manifest?.entries ?? {}).map(async ([source, entry]) => {
    const missingOutputFiles = (await Promise.all(entry.outputFiles.map(async (file) => ({
      file,
      exists: await pathExists(file),
    })))).filter(({ exists }) => !exists).map(({ file }) => file);
    return {
      source,
      status: entry.status,
      completedAt: entry.completedAt,
      outputFiles: entry.outputFiles,
      missingOutputFiles,
      sourceExists: await pathExists(source),
      error: entry.error,
    } satisfies BatchStatusEntry;
  }));
  const summaryCounts = summary
    ? {
        total: summary.total,
        succeeded: summary.succeeded,
        partial: summary.partial,
        failed: summary.failed,
        skipped: summary.skipped,
      }
    : undefined;
  const counts = {
    total: summaryCounts?.total ?? entries.length,
    succeeded: summaryCounts?.succeeded ?? entries.filter((entry) => entry.status === 'succeeded').length,
    partial: summaryCounts?.partial ?? entries.filter((entry) => entry.status === 'partial').length,
    failed: summaryCounts?.failed ?? entries.filter((entry) => entry.status === 'failed').length,
    skipped: summaryCounts?.skipped ?? 0,
    missingArtifacts: entries.reduce((sum, entry) => sum + entry.missingOutputFiles.length, 0),
    missingSources: entries.filter((entry) => !entry.sourceExists).length,
  };
  const lastRunIncomplete = summary?.results.some((result) => (
    result.status === 'skipped'
    && result.skipReason !== 'resumed'
    && result.skipReason !== 'validated'
  )) ?? false;
  const manifestHasProblems = entries.some((entry) => (
    entry.status !== 'succeeded'
    || entry.missingOutputFiles.length > 0
  ));
  const lastRunHasProblems = summary !== undefined && (
    summary.failed > 0
    || summary.partial > 0
    || summary.costLimitReached
    || lastRunIncomplete
  );
  return {
    outputDirectory,
    manifestPath,
    summaryPath,
    lockPath,
    manifestPresent: manifest !== undefined,
    summaryPresent: summary !== undefined,
    ...(activeLock ? { activeLock } : {}),
    ...(summary ? {
      lastRun: {
        startedAt: summary.startedAt,
        completedAt: summary.completedAt,
        durationMs: summary.durationMs,
        mode: summary.mode,
        provider: summary.provider,
        gateway: summary.gateway,
        model: summary.model,
        usage: summary.usage,
        costLimitReached: summary.costLimitReached,
        incomplete: lastRunIncomplete,
      },
    } : {}),
    counts,
    sourceDrift: counts.missingSources > 0,
    healthy: activeLock === undefined && !manifestHasProblems && !lastRunHasProblems,
    entries,
  };
}

export function renderBatchStatus(report: BatchStatusReport): string {
  const lines = [
    `Batch: ${report.outputDirectory}`,
    `${report.lastRun ? 'Last run documents' : 'Documents'}: ${report.counts.total} total, ${report.counts.succeeded} succeeded, ${report.counts.partial} partial, ${report.counts.failed} failed, ${report.counts.skipped} skipped`,
    `Artifacts: ${report.counts.missingArtifacts === 0 ? 'all present' : `${report.counts.missingArtifacts} missing`}`,
    `Sources: ${report.counts.missingSources === 0 ? 'all present' : `${report.counts.missingSources} missing or moved`}`,
  ];
  if (report.activeLock) {
    const owner = report.activeLock.ownerValid
      ? `PID ${report.activeLock.pid} on ${report.activeLock.hostname}, started ${report.activeLock.startedAt}`
      : 'owner details are invalid or unavailable';
    lines.push(`Batch lock: present (${owner})`);
  }
  if (report.lastRun) {
    lines.push(
      `Last run: ${report.lastRun.completedAt} with ${report.lastRun.provider}/${report.lastRun.model} via ${report.lastRun.gateway} in ${report.lastRun.mode} mode`,
      `Usage: ${report.lastRun.usage.totalTokens} tokens, ${report.lastRun.usage.requests} requests, estimated $${report.lastRun.usage.estimatedCostUsd.toFixed(6)}`,
    );
    if (report.lastRun.costLimitReached) lines.push('Last run stopped at its estimated cost limit.');
    else if (report.lastRun.incomplete) lines.push('Last run did not schedule or complete every document.');
  }
  const issues = report.entries.filter((entry) => (
    entry.status !== 'succeeded' || entry.missingOutputFiles.length > 0
  ));
  if (issues.length > 0) {
    lines.push('', 'Needs attention:');
    for (const entry of issues.slice(0, 20)) {
      const details = [
        entry.status,
        entry.error,
        entry.missingOutputFiles.length > 0 ? `${entry.missingOutputFiles.length} missing artifact(s)` : undefined,
      ].filter(Boolean).join('; ');
      lines.push(`  - ${entry.source}: ${details}`);
    }
    if (issues.length > 20) lines.push(`  - …and ${issues.length - 20} more`);
  }
  const sourceWarnings = report.entries.filter((entry) => !entry.sourceExists);
  if (sourceWarnings.length > 0) {
    lines.push('', 'Source drift (artifacts remain auditable):');
    for (const entry of sourceWarnings.slice(0, 20)) lines.push(`  - ${entry.source}: missing or moved`);
    if (sourceWarnings.length > 20) lines.push(`  - …and ${sourceWarnings.length - 20} more`);
  }
  const status = report.activeLock
    ? 'Status: batch in progress or stale lock'
    : report.healthy ? 'Status: healthy' : 'Status: attention required';
  lines.push('', status);
  return `${lines.join('\n')}\n`;
}
