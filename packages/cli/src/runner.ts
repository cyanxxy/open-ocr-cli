import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import process from 'node:process';

import { agentLoop } from '../../../src/lib/agentLoop';
import type { AgentMemory, AgentStep } from '../../../src/lib/agentTypes';
import type { ExtractedContent, ExtractionInstruction } from '../../../src/lib/gemini/types';
import {
  extractPresetWithProvider,
  extractStructuredWithProvider,
  extractTextWithProvider,
  providerAgentLoop,
  providerDefaultBaseUrl,
  providerRequestHeaders,
  type ProviderExecutionContext,
} from '../../../src/lib/providers';
import { getExtractionPreset } from '../../../src/lib/templates';
import { readAndValidateInput, type InputDiscoverySkips } from './inputs';
import { nodeRegionCropper } from './nodeRegionCropper';
import { agentProgressMessage, OcrJobService, modeFingerprint } from './ocrJobService';
import { assertCustomSchemaOutput } from './schema';
import { jsonlResult, primaryArtifact } from './output';
import { providerRuntimeConfig } from './providerRuntime';
import { runWithProviderRetries } from './providerRetries';
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

function appendAgentTrace(steps: AgentStep[], step: AgentStep): void {
  const previous = steps.at(-1);
  if (
    step.delta
    && previous?.delta
    && previous.type === step.type
    && previous.source === step.source
    && previous.id === step.id
    && !previous.functionCall
    && !step.functionCall
  ) {
    previous.content += step.content;
    return;
  }
  steps.push({ ...step });
}

function finalizeAgentTrace(steps: AgentStep[]): AgentStep[] {
  for (const step of steps) {
    // Deltas are coalesced while the run is live. Once the document is
    // terminal, the retained artifact contains completed text steps rather
    // than an orphaned `in_progress` stream with no future event to close it.
    if (step.delta) delete step.delta;
  }
  return steps;
}

async function runAgentic(
  input: ResolvedInput,
  dataUrl: string,
  options: ResolvedCliOptions,
  signal: AbortSignal,
  onStep: (step: AgentStep) => void,
  runtime: ProviderExecutionContext,
): Promise<OcrArtifacts> {
  const config = providerRuntimeConfig(options, runtime);
  const generator = options.provider === 'gemini' ? agentLoop(
    { name: input.name, type: input.mimeType },
    dataUrl,
    {
      apiKey: options.apiKey || (options.cloudflareByok ? options.gatewayToken || 'cloudflare-byok' : ''),
      model: options.model,
      thinkingConfig: { level: options.thinking, includeThoughts: options.includeThoughts },
      progress: options.progress,
      baseUrl: options.gateway === 'cloudflare' || options.baseUrl !== providerDefaultBaseUrl('gemini')
        ? options.baseUrl
        : undefined,
      headers: options.gateway === 'cloudflare' ? providerRequestHeaders(config) : undefined,
      abortSignal: signal,
      regionCropper: nodeRegionCropper,
      runtime,
    },
    {
      maxIterations: options.maxIterations,
      confidenceThreshold: options.confidenceThreshold,
      maxTokens: options.maxTokens,
      maxDurationMs: options.timeoutSeconds * 1000,
      throwOnFailure: true,
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
      throwOnFailure: true,
    },
    nodeRegionCropper,
    signal,
  );
  // Live deltas belong to the event stream. Retain a compact, lossless trace
  // only when the caller explicitly requested the `all` artifact set.
  const steps: AgentStep[] | undefined = options.format === 'all' ? [] : undefined;
  let state = await generator.next();
  while (!state.done) {
    if (steps) appendAgentTrace(steps, state.value);
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
    ...(steps ? { agentSteps: finalizeAgentTrace(steps) } : {}),
  };
}

async function extractOnce(
  input: ResolvedInput,
  options: ResolvedCliOptions,
  signal: AbortSignal,
  onStep: (step: AgentStep) => void,
  runtime: ProviderExecutionContext,
): Promise<OcrArtifacts> {
  const { dataUrl } = await readAndValidateInput(input);
  const clientConfig = providerRuntimeConfig(options, runtime);

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
  if (options.mode === 'agentic') return runAgentic(input, dataUrl, options, signal, onStep, runtime);

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
  runtime: ProviderExecutionContext,
): Promise<{ artifacts: OcrArtifacts; attempts: number }> {
  const result = await runWithProviderRetries(
    options,
    signal,
    () => extractOnce(input, options, signal, onStep, runtime),
  );
  return { artifacts: result.value, attempts: result.attempts };
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
  /**
   * What discovery dropped before these inputs were resolved. The summary's
   * `skipped` counts documents that entered the pipeline, so without this the
   * record would assert that nothing was passed over.
   */
  discovery?: InputDiscoverySkips;
  /**
   * Called once the terminal `--jsonl` summary record has been written. The
   * stream carries exactly one terminal record, so a caller that also owns a
   * `run.failed` emitter must fall silent after this fires.
   */
  onTerminalRecord?: () => void;
  writeStdout?: (text: string) => void | Promise<void>;
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
  const rawWriteStdout = runtime.writeStdout ?? (async (text: string): Promise<void> => {
    if (process.stdout.write(text)) return;
    await once(process.stdout, 'drain');
  });
  // Documents can finish concurrently. Serialize result records so one slow
  // pipe applies real backpressure instead of allowing every worker to keep
  // buffering behind a full stdout stream.
  let stdoutQueue: Promise<void> = Promise.resolve();
  const writeStdout = (text: string): Promise<void> => {
    const delivery = stdoutQueue.then(() => rawWriteStdout(text));
    stdoutQueue = delivery;
    return delivery;
  };
  const writeStderr = runtime.writeStderr ?? ((text: string) => process.stderr.write(text));
  const service = createOcrJobService();
  const { summary } = await service.run(inputs, options, {
    runId: randomUUID(),
    abortController: runtime.abortController,
    onWarning: (message) => writeStderr(`${message}\n`),
    onAgentStep: (input, step) => {
      if (options.verbose && !options.quiet) {
        writeStderr(`  ${input.displayPath}: ${step.type}: ${agentProgressMessage(step)}\n`);
      }
    },
    onDocumentResult: async (index, total, result): Promise<void> => {
      if (options.jsonl) await writeStdout(`${jsonlResult(result)}\n`);
      if (!options.quiet) writeStderr(`${statusLine(index, total, result)}\n`);
    },
  });
  const shouldWriteFiles = inputs.length > 1 || Boolean(options.output) || options.format === 'all';
  if (inputs.length === 1 && !shouldWriteFiles && !options.jsonl && summary.results[0]?.artifacts) {
    await writeStdout(primaryArtifact(summary.results[0].artifacts, options.format));
  }
  if (options.jsonl) {
    await writeStdout(`${JSON.stringify({
      type: 'summary',
      ...summary,
      results: undefined,
      // Always present so a consumer can rely on the field rather than infer
      // silence. Counts only: a scan may pass over thousands of entries, and
      // this record has to stay a bounded single line. `defaultExcluded` counts
      // pruned directories, not the files inside them — the subtree is never
      // walked, which is the point of pruning it.
      discovery: {
        unsupported: runtime.discovery?.unsupported.count ?? 0,
        defaultExcluded: runtime.discovery?.defaultExcluded.count ?? 0,
      },
    })}\n`);
    // A cancelled batch still returns a summary, so this is the terminal record
    // even when the run was interrupted. Report it so the caller does not add a
    // second one.
    runtime.onTerminalRecord?.();
  }
  return summary;
}
