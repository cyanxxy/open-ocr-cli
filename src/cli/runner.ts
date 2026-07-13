import process from 'node:process';

import { agentLoop } from '../lib/agentLoop';
import type { AgentMemory, AgentStep } from '../lib/agentTypes';
import { isRetryableGeminiError } from '../lib/gemini/client';
import { extractTextFromFile } from '../lib/gemini/extraction';
import { getGeminiUsage, resetGeminiUsage } from '../lib/gemini/usage';
import type { ExtractedContent, ExtractionInstruction, GeminiClientConfig } from '../lib/gemini/types';
import { getExtractionPreset, runExtractionPreset } from '../lib/templates';
import { inputFingerprint, readAndValidateInput } from './inputs';
import { nodeRegionCropper } from './nodeRegionCropper';
import {
  defaultOutputDirectory,
  jsonlResult,
  ManifestStore,
  primaryArtifact,
  writeArtifacts,
  writeBatchSummary,
} from './output';
import type {
  BatchSummary,
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

async function runAgentic(
  input: ResolvedInput,
  dataUrl: string,
  options: ResolvedCliOptions,
  signal: AbortSignal,
  onStep: (step: AgentStep) => void,
): Promise<OcrArtifacts> {
  const generator = agentLoop(
    { name: input.name, type: input.mimeType },
    dataUrl,
    {
      apiKey: options.apiKey,
      model: options.model,
      thinkingConfig: { level: options.thinking, includeThoughts: options.includeThoughts },
      abortSignal: signal,
      regionCropper: nodeRegionCropper,
    },
    {
      maxIterations: options.maxIterations,
      confidenceThreshold: options.confidenceThreshold,
      maxTokens: options.maxTokens,
      maxDurationMs: options.timeoutSeconds * 1000,
    },
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
  const clientConfig: GeminiClientConfig = {
    apiKey: options.apiKey,
    model: options.model,
    thinkingConfig: { level: options.thinking, includeThoughts: options.includeThoughts },
  };

  if (options.mode === 'template') {
    const result = await runExtractionPreset(
      dataUrl,
      input.mimeType,
      clientConfig,
      getExtractionPreset(options.preset!),
      { abortSignal: signal },
    );
    return { markdown: result.markdown, json: result.json, csv: result.csv };
  }
  if (options.mode === 'agentic') return runAgentic(input, dataUrl, options, signal, onStep);

  const instructions: ExtractionInstruction[] = options.instructions.map((prompt) => ({ prompt }));
  const result = await extractTextFromFile(
    dataUrl,
    input.mimeType,
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
      if (signal.aborted || attempt === allowedAttempts || !isRetryableGeminiError(error)) {
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

function modeFingerprint(options: ResolvedCliOptions): string {
  return JSON.stringify({
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
  });
}

function statusLine(index: number, total: number, result: OcrJobResult): string {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const icon = result.status === 'succeeded' ? '✓' : result.status === 'partial' ? '~' : result.status === 'skipped' ? '↷' : '✗';
  const destination = result.outputFiles?.length ? ` → ${result.outputFiles.join(', ')}` : '';
  const error = result.error ? ` — ${result.error}` : '';
  return `[${index}/${total}] ${icon} ${result.input.displayPath}${destination} (${seconds}s)${error}`;
}

interface BatchRuntime {
  abortController: AbortController;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
}

export async function runBatch(
  inputs: ResolvedInput[],
  options: ResolvedCliOptions,
  runtime: BatchRuntime,
): Promise<BatchSummary> {
  const writeStdout = runtime.writeStdout ?? ((text: string) => process.stdout.write(text));
  const writeStderr = runtime.writeStderr ?? ((text: string) => process.stderr.write(text));
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const shouldWriteFiles = inputs.length > 1 || Boolean(options.output) || options.format === 'all';
  const manifest = inputs.length > 1 ? new ManifestStore(defaultOutputDirectory(options)) : undefined;
  await manifest?.load();
  resetGeminiUsage();

  const results = new Array<OcrJobResult | undefined>(inputs.length);
  let cursor = 0;
  let completed = 0;
  let failFastTriggered = false;
  const fingerprintMode = modeFingerprint(options);

  const worker = async (): Promise<void> => {
    while (!runtime.abortController.signal.aborted && !failFastTriggered) {
      const index = cursor;
      cursor += 1;
      if (index >= inputs.length) return;
      const input = inputs[index];
      const jobStart = performance.now();
      const jobStartedAt = new Date().toISOString();
      const key = input.absolutePath ?? '<stdin>';
      const fingerprint = inputFingerprint(input, fingerprintMode);

      let result: OcrJobResult;
      if (options.dryRun) {
        try {
          await readAndValidateInput(input);
          result = {
            status: 'skipped', input, mode: options.mode, model: options.model,
            startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart, attempts: 0,
          };
        } catch (error) {
          result = {
            status: 'failed', input, mode: options.mode, model: options.model,
            startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart, attempts: 0,
            error: error instanceof Error ? error.message : String(error),
          };
          if (options.failFast) failFastTriggered = true;
        }
      } else if (options.resume && !options.overwrite && manifest && await manifest.completed(key, fingerprint)) {
        result = {
          status: 'skipped', input, mode: options.mode, model: options.model,
          startedAt: jobStartedAt, completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart, attempts: 0,
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
            status: jobStatus, input, mode: options.mode, model: options.model,
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
            status: 'failed', input, mode: options.mode, model: options.model,
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
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.concurrency, inputs.length) }, () => worker()));
  const unscheduledReason = runtime.abortController.signal.aborted
    ? 'Not started because the batch was cancelled'
    : 'Not started because --fail-fast stopped the batch';
  for (let index = 0; index < inputs.length; index += 1) {
    if (results[index]) continue;
    const timestamp = new Date().toISOString();
    const result: OcrJobResult = {
      status: 'skipped',
      input: inputs[index],
      mode: options.mode,
      model: options.model,
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 0,
      attempts: 0,
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
    model: options.model,
    usage: getGeminiUsage(),
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
