import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { agentLoop } from '../lib/agentLoop';
import type { AgentMemory, AgentStep } from '../lib/agentTypes';
import { isRetryableGeminiError } from '../lib/gemini/client';
import type { ExtractedContent, ExtractionInstruction } from '../lib/gemini/types';
import {
  extractPresetWithProvider,
  extractStructuredWithProvider,
  extractTextWithProvider,
  isRetryableProviderError,
  providerAgentLoop,
  providerDefaultBaseUrl,
  providerRequestHeaders,
  type ProviderRuntimeConfig,
} from '../lib/providers';
import { getExtractionPreset } from '../lib/templates';
import { readAndValidateInput } from './inputs';
import { nodeRegionCropper } from './nodeRegionCropper';
import { OcrJobService, modeFingerprint } from './ocrJobService';
import { assertCustomSchemaOutput } from './schema';
import { jsonlResult, primaryArtifact } from './output';
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

export { modeFingerprint };

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

export function createOcrJobService(): OcrJobService {
  return new OcrJobService({ extractDocument: extractWithRetries });
}

export async function runBatch(
  inputs: ResolvedInput[],
  options: ResolvedCliOptions,
  runtime: BatchRuntime,
): Promise<BatchSummary> {
  const writeStdout = runtime.writeStdout ?? ((text: string) => process.stdout.write(text));
  const writeStderr = runtime.writeStderr ?? ((text: string) => process.stderr.write(text));
  const service = createOcrJobService();
  const { summary } = await service.run(inputs, options, {
    runId: randomUUID(),
    abortController: runtime.abortController,
    onWarning: (message) => writeStderr(`${message}\n`),
    onAgentStep: (input, step) => {
      if (options.verbose && !options.quiet) {
        writeStderr(`  ${input.displayPath}: ${step.type}: ${step.content}\n`);
      }
    },
    onDocumentResult: (index, total, result) => {
      if (options.jsonl) writeStdout(`${jsonlResult(result)}\n`);
      if (!options.quiet) writeStderr(`${statusLine(index, total, result)}\n`);
    },
  });
  const shouldWriteFiles = inputs.length > 1 || Boolean(options.output) || options.format === 'all';
  if (inputs.length === 1 && !shouldWriteFiles && !options.jsonl && summary.results[0]?.artifacts) {
    writeStdout(primaryArtifact(summary.results[0].artifacts, options.format));
  }
  if (options.jsonl) writeStdout(`${JSON.stringify({ type: 'summary', ...summary, results: undefined })}\n`);
  return summary;
}
