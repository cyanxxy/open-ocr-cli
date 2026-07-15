import process from 'node:process';

import { agentLoop } from '../lib/agentLoop';
import type { AgentMemory, AgentStep } from '../lib/agentTypes';
import { isRetryableGeminiError } from '../lib/gemini/client';
import type { ExtractedContent, ExtractionInstruction } from '../lib/gemini/types';
import {
  configureProviderRequestPolicy,
  extractPresetWithProvider,
  extractStructuredWithProvider,
  extractTextWithProvider,
  getProviderUsage,
  isRetryableProviderError,
  providerAgentLoop,
  providerDefaultBaseUrl,
  providerRequestHeaders,
  resetProviderRequestPolicy,
  resetProviderUsage,
  type ProviderRuntimeConfig,
} from '../lib/providers';
import { getExtractionPreset } from '../lib/templates';
import { inputFingerprint, readAndValidateInput } from './inputs';
import { asCliExitError } from './errors';
import { nodeRegionCropper } from './nodeRegionCropper';
import { assertCustomSchemaOutput } from './schema';
import {
  assertArtifactTargetsAvailable,
  assertNoOutputCollisions,
  BatchOutputLock,
  defaultOutputDirectory,
  jsonlResult,
  ManifestStore,
  primaryArtifact,
  plannedArtifactTargets,
  writeArtifacts,
  writeBatchSummary,
} from './output';
import type {
  BatchSummary,
  ManifestEntry,
  OcrArtifacts,
  OcrJobResult,
  ResolvedCliOptions,
  ResolvedInput,
} from './types';

function extractedContentToMarkdown(result: ExtractedContent): string {
  if (result.markdown) return result.markdown;
  const lines: string[] = [];
  if (result.title) lines.push(`# ${result.title}`, '');
  for (const section of result.sections) {
    if (section.heading) lines.push(`## ${section.heading}`, '');
    lines.push(...section.content, '');
  }
  if (lines.length === 0 && result.content) lines.push(result.content);
  return lines.join('\n').trim();
}

function agentMemoryToMarkdown(memory: AgentMemory): string {
  const fields = Object.entries(memory.extractedFields);
  const lines = [
    '# Agentic OCR Extraction',
    '',
    `- Document type: ${memory.documentAnalysis.documentType || 'unknown'}`,
    `- Confidence: ${(memory.confidence * 100).toFixed(0)}%`,
    `- Iterations: ${memory.currentIteration}`,
    `- Stop reason: ${memory.stopReason ?? 'unknown'}`,
    '',
    '## Fields',
    '',
  ];
  if (fields.length === 0) lines.push('- None');
  for (const [name, field] of fields) {
    lines.push(`- **${name}**: ${field.value} (${Math.round(field.confidence * 100)}%)`);
  }
  return lines.join('\n');
}

function providerConfig(options: ResolvedCliOptions): ProviderRuntimeConfig {
  return {
    provider: options.provider,
    gateway: options.gateway,
    apiKey: options.apiKey,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    baseUrl: options.baseUrl,
    thinkingConfig: { level: options.thinking, includeThoughts: options.includeThoughts },
    gatewayToken: options.gatewayToken,
    gatewayTokenEnv: options.gatewayTokenEnv,
    cloudflareAccountId: options.cloudflareAccountId,
    cloudflareGatewayId: options.cloudflareGatewayId,
    cloudflareByok: options.cloudflareByok,
    cloudflareByokAlias: options.cloudflareByokAlias,
    cloudflareProvider: options.cloudflareProvider,
    inputPricePerMillionUsd: options.inputPricePerMillionUsd,
    outputPricePerMillionUsd: options.outputPricePerMillionUsd,
  };
}

async function runAgentic(
  input: ResolvedInput,
  dataUrl: string,
  options: ResolvedCliOptions,
  signal: AbortSignal,
  onStep: (step: AgentStep) => void,
): Promise<OcrArtifacts> {
  const config = providerConfig(options);
  const generator = options.provider === 'gemini' ? agentLoop(
    { name: input.name, type: input.mimeType },
    dataUrl,
    {
      apiKey: options.apiKey || (options.cloudflareByok ? options.gatewayToken || 'cloudflare-byok' : ''),
      model: options.model,
      thinkingConfig: { level: options.thinking, includeThoughts: options.includeThoughts },
      baseUrl: options.gateway === 'cloudflare' || options.baseUrl !== providerDefaultBaseUrl('gemini')
        ? options.baseUrl
        : undefined,
      headers: options.gateway === 'cloudflare' ? providerRequestHeaders(config) : undefined,
      abortSignal: signal,
      regionCropper: nodeRegionCropper,
    },
    {
      maxIterations: options.maxIterations,
      confidenceThreshold: options.confidenceThreshold,
      maxTokens: options.maxTokens,
      maxDurationMs: options.timeoutSeconds * 1000,
    },
  ) : providerAgentLoop(
    { name: input.name, type: input.mimeType },
    dataUrl,
    config,
    {
      maxIterations: options.maxIterations,
      confidenceThreshold: options.confidenceThreshold,
      maxTokens: options.maxTokens,
      maxDurationMs: options.timeoutSeconds * 1000,
    },
    nodeRegionCropper,
    signal,
  );
  const steps: AgentStep[] = [];
  let state = await generator.next();
  while (!state.done) {
    steps.push(state.value);
    onStep(state.value);
    state = await generator.next();
  }
  const memory = state.value;
  if (memory.stopReason === 'failed' || memory.stopReason === 'cancelled') {
    throw new Error(`Agentic OCR ${memory.stopReason}`);
  }
  return {
    markdown: agentMemoryToMarkdown(memory),
    json: memory,
    agentSteps: steps,
  };
}

async function extractOnce(
  input: ResolvedInput,
  options: ResolvedCliOptions,
  signal: AbortSignal,
  onStep: (step: AgentStep) => void,
): Promise<OcrArtifacts> {
  const { dataUrl } = await readAndValidateInput(input);
  const clientConfig = providerConfig(options);

  if (options.mode === 'template') {
    const result = await extractPresetWithProvider(
      dataUrl,
      input.mimeType,
      input.name,
      clientConfig,
      getExtractionPreset(options.preset!),
      signal,
    );
    return { markdown: result.markdown, json: result.json, csv: result.csv };
  }
  if (options.mode === 'agentic') return runAgentic(input, dataUrl, options, signal, onStep);

  const instructions: ExtractionInstruction[] = options.instructions.map((prompt) => ({ prompt }));
  if (options.customSchema) {
    const result = await extractStructuredWithProvider(
      dataUrl,
      input.mimeType,
      input.name,
      clientConfig,
      options.customSchema,
      instructions.length > 0 ? instructions : undefined,
      {
        detectImages: options.detectImages,
        detectMathEquations: options.detectMath,
        maxTokens: options.maxTokens,
        abortSignal: signal,
      },
    );
    assertCustomSchemaOutput(options.customSchema, result);
    return { json: result };
  }
  const result = await extractTextWithProvider(
    dataUrl,
    input.mimeType,
    input.name,
    clientConfig,
    instructions.length > 0 ? instructions : undefined,
    {
      outputFormat: options.format === 'json' ? 'json' : 'markdown',
      structuredOutput: options.format === 'json',
      detectImages: options.detectImages,
      detectMathEquations: options.detectMath,
      maxTokens: options.maxTokens,
      abortSignal: signal,
    },
  );
  return { markdown: extractedContentToMarkdown(result), json: result };
}

async function extractWithRetries(
  input: ResolvedInput,
  options: ResolvedCliOptions,
  signal: AbortSignal,
  onStep: (step: AgentStep) => void,
): Promise<{ artifacts: OcrArtifacts; attempts: number }> {
  const allowedAttempts = options.mode === 'agentic' ? 1 : options.retries + 1;
  for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
    try {
      return { artifacts: await extractOnce(input, options, signal, onStep), attempts: attempt };
    } catch (error) {
      if (
        signal.aborted
        || attempt === allowedAttempts
        || !(options.provider === 'gemini' ? isRetryableGeminiError(error) : isRetryableProviderError(error))
      ) {
        throw new ExtractionAttemptsError(error, attempt);
      }
      const delayMs = 750 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, delayMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new DOMException('Operation aborted', 'AbortError'));
          }, { once: true });
        });
      } catch (waitError) {
        throw new ExtractionAttemptsError(waitError, attempt);
      }
    }
  }
  throw new ExtractionAttemptsError(new Error('Extraction exhausted its retry budget'), allowedAttempts);
}

class ExtractionAttemptsError extends Error {
  constructor(error: unknown, readonly attempts: number) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'ExtractionAttemptsError';
  }
}

export function modeFingerprint(options: ResolvedCliOptions): string {
  return JSON.stringify({
    provider: options.provider,
    gateway: options.gateway,
    baseUrl: options.baseUrl,
    cloudflareProvider: options.cloudflareProvider,
    cloudflareByok: options.cloudflareByok,
    cloudflareByokAlias: options.cloudflareByokAlias,
    mode: options.mode,
    preset: options.preset,
    model: options.model,
    thinking: options.thinking,
    format: options.format,
    instructions: options.instructions,
    detectImages: options.detectImages,
    detectMath: options.detectMath,
    maxTokens: options.maxTokens,
    maxIterations: options.maxIterations,
    confidenceThreshold: options.confidenceThreshold,
    customSchema: options.customSchema,
  });
}

function statusLine(index: number, total: number, result: OcrJobResult): string {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const icon = result.status === 'succeeded' ? '✓' : result.status === 'partial' ? '~' : result.status === 'skipped' ? '↷' : '✗';
  const destinations = result.outputFiles ?? result.plannedOutputFiles;
  const destination = destinations?.length
    ? ` → ${destinations.join(', ')}`
    : result.skipReason === 'validated' ? ' → stdout' : '';
  const reason = result.skipReason === 'validated'
    ? ' — validated (dry run)'
    : result.skipReason === 'resumed' ? ' — unchanged (resume)' : '';
  const error = result.error ? ` — ${result.error}` : '';
  return `[${index}/${total}] ${icon} ${result.input.displayPath}${destination} (${seconds}s)${reason}${error}`;
}

interface BatchRuntime {
  abortController: AbortController;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

async function runBatchInternal(
  inputs: ResolvedInput[],
  options: ResolvedCliOptions,
  runtime: BatchRuntime,
): Promise<BatchSummary> {
  const writeStdout = runtime.writeStdout ?? ((text: string) => process.stdout.write(text));
  const writeStderr = runtime.writeStderr ?? ((text: string) => process.stderr.write(text));
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const shouldWriteFiles = inputs.length > 1 || Boolean(options.output) || options.format === 'all';
  try {
    await assertNoOutputCollisions(inputs, options);
  } catch (error) {
    throw asCliExitError(error, 2);
  }
  const manifest = inputs.length > 1 ? new ManifestStore(defaultOutputDirectory(options)) : undefined;
  try {
    await manifest?.load();
  } catch (error) {
    throw asCliExitError(error, 2);
  }
  const fingerprintMode = modeFingerprint(options);
  const resumableEntries = new Map<number, ManifestEntry>();
  if (!options.dryRun && !options.overwrite) {
    try {
      await Promise.all(inputs.map(async (input, index) => {
        const key = input.absolutePath ?? '<stdin>';
        const fingerprint = inputFingerprint(input, fingerprintMode);
        const completedEntry = options.resume && manifest
          ? await manifest.completedEntry(key, fingerprint)
          : undefined;
        if (completedEntry) resumableEntries.set(index, completedEntry);
        else await assertArtifactTargetsAvailable(input, options, inputs.length);
      }));
    } catch (error) {
      throw asCliExitError(error, 2);
    }
  }
  resetProviderUsage();

  const results = new Array<OcrJobResult | undefined>(inputs.length);
  let cursor = 0;
  let completed = 0;
  let failFastTriggered = false;
  let costLimitReached = false;

  const worker = async (): Promise<void> => {
    while (!runtime.abortController.signal.aborted && !failFastTriggered && !costLimitReached) {
      if (
        options.maxCostUsd !== undefined
        && getProviderUsage().estimatedCostUsd >= options.maxCostUsd
      ) {
        costLimitReached = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= inputs.length) return;
      const input = inputs[index];
      const jobStart = performance.now();
      const jobStartedAt = new Date().toISOString();
      const key = input.absolutePath ?? '<stdin>';
      const fingerprint = inputFingerprint(input, fingerprintMode);

      let result: OcrJobResult;
      const completedEntry = resumableEntries.get(index);
      if (options.dryRun) {
        try {
          await readAndValidateInput(input);
          const plannedOutputFiles = await plannedArtifactTargets(input, options, inputs.length);
          result = {
            status: 'skipped', input, provider: options.provider, gateway: options.gateway, mode: options.mode, model: options.model,
            startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart, attempts: 0,
            plannedOutputFiles,
            skipReason: 'validated',
          };
        } catch (error) {
          result = {
            status: 'failed', input, provider: options.provider, gateway: options.gateway, mode: options.mode, model: options.model,
            startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart, attempts: 0,
            error: error instanceof Error ? error.message : String(error),
          };
          if (options.failFast) failFastTriggered = true;
        }
      } else if (completedEntry) {
        result = {
          status: 'skipped', input, provider: options.provider, gateway: options.gateway, mode: options.mode, model: options.model,
          startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart, attempts: 0,
          outputFiles: completedEntry.outputFiles,
          skipReason: 'resumed',
        };
      } else {
        const timeoutController = new AbortController();
        const relayAbort = (): void => timeoutController.abort(runtime.abortController.signal.reason);
        runtime.abortController.signal.addEventListener('abort', relayAbort, { once: true });
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          timeoutController.abort(new Error(`Timed out after ${options.timeoutSeconds}s`));
        }, options.timeoutSeconds * 1000);
        try {
          const { artifacts, attempts } = await extractWithRetries(
            input,
            options,
            timeoutController.signal,
            (step) => {
              if (options.verbose && !options.quiet) writeStderr(`  ${input.displayPath}: ${step.type}: ${step.content}\n`);
            },
          );
          const outputFiles = shouldWriteFiles
            ? await writeArtifacts(input, artifacts, options, inputs.length)
            : undefined;
          const agentMemory = options.mode === 'agentic' ? artifacts.json as AgentMemory | undefined : undefined;
          const jobStatus: OcrJobResult['status'] = agentMemory?.stopReason && agentMemory.stopReason !== 'succeeded'
            ? 'partial'
            : 'succeeded';
          result = {
            status: jobStatus, input, provider: options.provider, gateway: options.gateway, mode: options.mode, model: options.model,
            startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart,
            artifacts, outputFiles, attempts,
          };
          await manifest?.update(key, {
            fingerprint,
            status: jobStatus,
            outputFiles: outputFiles ?? [],
            completedAt: result.completedAt,
          });
        } catch (error) {
          const message = timedOut
            ? `Timed out after ${options.timeoutSeconds}s`
            : error instanceof Error ? error.message : String(error);
          result = {
            status: 'failed', input, provider: options.provider, gateway: options.gateway, mode: options.mode, model: options.model,
            startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart,
            error: message,
            attempts: error instanceof ExtractionAttemptsError ? error.attempts : 1,
          };
          await manifest?.update(key, {
            fingerprint,
            status: 'failed',
            outputFiles: [],
            completedAt: result.completedAt,
            error: message,
          });
          if (options.failFast) failFastTriggered = true;
        } finally {
          clearTimeout(timeout);
          runtime.abortController.signal.removeEventListener('abort', relayAbort);
        }
      }

      completed += 1;
      if (options.jsonl) writeStdout(`${jsonlResult(result)}\n`);
      if (!options.quiet) writeStderr(`${statusLine(completed, inputs.length, result)}\n`);
      // Batch artifacts are already on disk (and optionally emitted as JSONL).
      // Do not retain every document body until the batch ends: memory should
      // scale with concurrency, not with the number or size of documents.
      results[index] = inputs.length > 1 && result.artifacts
        ? { ...result, artifacts: undefined }
        : result;
      if (
        options.maxCostUsd !== undefined
        && getProviderUsage().estimatedCostUsd >= options.maxCostUsd
      ) costLimitReached = true;
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.concurrency, inputs.length) }, () => worker()));
  const unscheduledReason = runtime.abortController.signal.aborted
    ? 'Not started because the batch was cancelled'
    : costLimitReached
      ? `Not started because the estimated cost reached --max-cost $${options.maxCostUsd?.toFixed(4)}`
    : 'Not started because --fail-fast stopped the batch';
  const unscheduledSkipReason: OcrJobResult['skipReason'] = runtime.abortController.signal.aborted
    ? 'cancelled'
    : costLimitReached ? 'cost-limit' : 'fail-fast';
  for (let index = 0; index < inputs.length; index += 1) {
    if (results[index]) continue;
    const timestamp = new Date().toISOString();
    const result: OcrJobResult = {
      status: 'skipped',
      input: inputs[index],
      provider: options.provider,
      gateway: options.gateway,
      mode: options.mode,
      model: options.model,
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 0,
      attempts: 0,
      skipReason: unscheduledSkipReason,
      error: unscheduledReason,
    };
    results[index] = result;
    completed += 1;
    if (options.jsonl) writeStdout(`${jsonlResult(result)}\n`);
    if (!options.quiet) writeStderr(`${statusLine(completed, inputs.length, result)}\n`);
  }
  const finishedResults = results.map((result, index): OcrJobResult => {
    if (!result) throw new Error(`Internal error: missing result for input ${index + 1}`);
    return result;
  });
  const completedAt = new Date().toISOString();
  const summary: BatchSummary = {
    version: 1,
    startedAt,
    completedAt,
    durationMs: performance.now() - started,
    total: inputs.length,
    succeeded: finishedResults.filter((result) => result.status === 'succeeded').length,
    partial: finishedResults.filter((result) => result.status === 'partial').length,
    failed: finishedResults.filter((result) => result.status === 'failed').length,
    skipped: finishedResults.filter((result) => result.status === 'skipped').length,
    mode: options.mode,
    provider: options.provider,
    gateway: options.gateway,
    model: options.model,
    usage: getProviderUsage(),
    costLimitUsd: options.maxCostUsd,
    costLimitReached,
    results: finishedResults,
  };

  if (inputs.length > 1 && !options.dryRun) {
    await writeBatchSummary(
      { ...summary, results: summary.results.map((result) => ({ ...result, artifacts: undefined })) },
      defaultOutputDirectory(options),
    );
  }
  if (inputs.length === 1 && !shouldWriteFiles && !options.jsonl && summary.results[0]?.artifacts) {
    writeStdout(primaryArtifact(summary.results[0].artifacts, options.format));
  }
  if (options.jsonl) {
    writeStdout(`${JSON.stringify({ type: 'summary', ...summary, results: undefined })}\n`);
  }
  return summary;
}

export async function runBatch(
  inputs: ResolvedInput[],
  options: ResolvedCliOptions,
  runtime: BatchRuntime,
): Promise<BatchSummary> {
  let batchLock: BatchOutputLock | undefined;
  if (inputs.length > 1 && !options.dryRun) {
    try {
      const writeStderr = runtime.writeStderr ?? ((text: string) => process.stderr.write(text));
      batchLock = await BatchOutputLock.acquire(defaultOutputDirectory(options), {
        forceUnlock: options.forceUnlock,
        onWarning: (message) => writeStderr(`${message}\n`),
      });
    } catch (error) {
      throw asCliExitError(error, 2);
    }
  }
  let summary: BatchSummary | undefined;
  let primaryFailure: unknown;
  let batchFailed = false;
  try {
    configureProviderRequestPolicy({
      requestsPerMinute: options.requestsPerMinute,
      maxCostUsd: options.maxCostUsd,
    });
    summary = await runBatchInternal(inputs, options, runtime);
  } catch (error) {
    batchFailed = true;
    primaryFailure = error;
  }
  resetProviderRequestPolicy();

  let lockFailure: unknown;
  try {
    await batchLock?.release();
  } catch (error) {
    lockFailure = error;
  }
  if (batchFailed && lockFailure !== undefined) {
    const primaryMessage = errorMessage(primaryFailure);
    const lockMessage = errorMessage(lockFailure);
    throw new Error(`${primaryMessage}; batch lock cleanup also failed: ${lockMessage}`, {
      cause: primaryFailure,
    });
  }
  if (batchFailed) {
    throw primaryFailure instanceof Error ? primaryFailure : new Error(String(primaryFailure));
  }
  if (lockFailure !== undefined) {
    throw lockFailure instanceof Error ? lockFailure : new Error(errorMessage(lockFailure));
  }
  if (!summary) throw new Error('Internal error: batch completed without a summary');
  return summary;
}
