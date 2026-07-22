import type { AgentStep } from '../lib/agentTypes';
import {
  createProviderExecutionContext,
  isProviderCostLimitError,
  type ProviderExecutionContext,
} from '../lib/providers';
import { asCliExitError, CliExitError, ocrErrorPayload } from './errors';
import { inputFingerprint, readAndValidateInput } from './inputs';
import { assertProviderMediaTypeSupported } from './providerInputs';
import {
  assertArtifactFormatAvailable,
  assertArtifactTargetsAvailable,
  assertNoOutputCollisions,
  BatchOutputLock,
  defaultOutputDirectory,
  ManifestStore,
  plannedArtifactTargets,
  writeArtifacts,
  writeBatchSummary,
} from './output';
import {
  agentProtocolStep,
  assertOcrJobEvent,
  errorPayloadForProtocol,
  OCR_PROTOCOL_VERSION,
  ocrDocumentId,
  toOcrRunResult,
  toProtocolDocument,
  type OcrJobEvent,
  type OcrJobEventSink,
  type OcrDeliveryMode,
  type OcrProgressLevel,
  type OcrProtocolVersion,
  type OcrRunResult,
} from './protocol';
import type {
  BatchSummary,
  ManifestEntry,
  OcrArtifacts,
  OcrJobResult,
  ResolvedCliOptions,
  ResolvedInput,
} from './types';

export interface OcrExtractionResult {
  artifacts: OcrArtifacts;
  attempts: number;
}

export type OcrDocumentExtractor = (
  input: ResolvedInput,
  options: ResolvedCliOptions,
  signal: AbortSignal,
  onStep: (step: AgentStep) => void,
  providerRuntime: ProviderExecutionContext,
) => Promise<OcrExtractionResult>;

export interface OcrJobServiceDependencies {
  extractDocument: OcrDocumentExtractor;
  /** Override local-file validation for another logical input source, such as URLs. */
  validateInput?: (input: ResolvedInput, options: ResolvedCliOptions) => Promise<void>;
  /** Override provider media checks for non-file inputs. */
  assertInputSupported?: (input: ResolvedInput, options: ResolvedCliOptions) => void;
}

export interface OcrJobServiceRuntime {
  runId: string;
  abortController: AbortController;
  eventSink?: OcrJobEventSink;
  onDocumentResult?: (index: number, total: number, result: OcrJobResult) => void | Promise<void>;
  onAgentStep?: (input: ResolvedInput, step: AgentStep) => void;
  onWarning?: (message: string) => void;
  /** Persist a manifest for a reference-first, single-document output directory. */
  enableSingleInputResume?: boolean;
  /** Machine protocol negotiated by the request. Direct CLI calls omit it. */
  protocolVersion?: OcrProtocolVersion;
  /** Explicit machine delivery; omitted for the direct CLI's historical behavior. */
  deliveryMode?: OcrDeliveryMode;
  /** Structured agent event detail. */
  progress?: OcrProgressLevel;
}

export interface OcrJobServiceResult {
  runId: string;
  summary: BatchSummary;
  result: OcrRunResult;
}

type EventPayload = Omit<OcrJobEvent, 'protocolVersion' | 'runId' | 'sequence' | 'timestamp'>;

class EventDispatcher {
  private sequence = 0;
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown;

  constructor(
    private readonly runId: string,
    private readonly protocolVersion: OcrProtocolVersion,
    private readonly sink?: OcrJobEventSink,
  ) {}

  emit(payload: EventPayload): Promise<void> {
    if (!this.sink) return Promise.resolve();
    const { step, phase, message, error, ...common } = payload;
    const event: OcrJobEvent = {
      protocolVersion: this.protocolVersion,
      runId: this.runId,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      ...common,
      ...(this.protocolVersion === 1 && payload.type === 'document.progress'
        ? { phase: phase ?? step?.kind ?? 'runtime', message: message ?? step?.text ?? 'Agent progress updated.' }
        : {}),
      ...(this.protocolVersion === 2 && payload.type === 'document.progress' && step ? { step } : {}),
      ...(error ? { error: errorPayloadForProtocol(error, this.protocolVersion) } : {}),
    };
    // Validate before allocating the sequence number so a bad event does not
    // leave a permanent gap or throw after side effects.
    assertOcrJobEvent(event);
    this.sequence += 1;
    const delivery = this.pending.then(async () => this.sink?.(event));
    // Keep later events deliverable after a sink failure, while retaining the
    // first rejection so a later flush cannot race past an async sink error.
    this.pending = delivery.catch((error: unknown) => {
      this.failure ??= error;
    });
    return delivery;
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.failure !== undefined) {
      const failure = this.failure;
      this.failure = undefined;
      throw failure instanceof Error
        ? failure
        : new Error(errorMessage(failure));
    }
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
    traceProgress: options.format === 'all' ? options.progress : undefined,
    traceThoughtSummaries: options.format === 'all' ? options.includeThoughts : undefined,
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function errorAttempts(error: unknown): number {
  if (error instanceof Error && 'attempts' in error && typeof error.attempts === 'number') {
    return error.attempts;
  }
  return 1;
}

function terminalEventType(result: OcrJobResult): OcrJobEvent['type'] {
  if (result.status === 'failed') return 'document.failed';
  if (result.status === 'partial') return 'document.partial';
  if (result.status === 'skipped') return 'document.skipped';
  return 'document.completed';
}

function agentToolLabel(name: string | undefined): string {
  if (name === 'analyze_document_structure') return 'document structure analysis';
  if (name === 'extract_fields_batch') return 'field extraction';
  if (name === 're_ocr_region') return 'region re-OCR';
  return 'an agent tool';
}

const MAX_PROGRESS_MESSAGE_LENGTH = 512;
const ANSI_CONTROL_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'gu',
);

function isSafeProgressCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return false;
  const disallowedControl = codePoint <= 8
    || (codePoint >= 11 && codePoint <= 12)
    || (codePoint >= 14 && codePoint <= 31)
    || (codePoint >= 127 && codePoint <= 159);
  const bidirectionalOverride = (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069);
  return !disallowedControl && !bidirectionalOverride;
}

/**
 * Produce the bounded compatibility message used by human stderr and protocol
 * v1. Protocol v2 additionally carries the lossless typed AgentProtocolStep;
 * modern agent consumers should use that structured field for model output,
 * reasoning summaries, tool calls, and stable streaming step IDs.
 */
export function normalizeAgentProgressText(content: string): string | undefined {
  const withoutAnsi = content.replace(ANSI_CONTROL_SEQUENCE, '');
  const normalized = Array.from(withoutAnsi)
    .filter(isSafeProgressCharacter)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return undefined;

  const characters = Array.from(normalized);
  if (characters.length <= MAX_PROGRESS_MESSAGE_LENGTH) return normalized;
  return `${characters.slice(0, MAX_PROGRESS_MESSAGE_LENGTH - 1).join('').trimEnd()}…`;
}

export function agentProgressMessage(step: AgentStep): string {
  if (step.type === 'thinking') {
    return normalizeAgentProgressText(step.content) ?? 'Agent is analyzing the document.';
  }
  if (step.type === 'function_call') {
    return `Agent requested ${agentToolLabel(step.functionCall?.name)}.`;
  }
  if (step.type === 'error') {
    return normalizeAgentProgressText(step.content) ?? 'An agent step reported an error.';
  }
  if (step.functionCall?.name) {
    return `Agent completed ${agentToolLabel(step.functionCall.name)}.`;
  }
  return normalizeAgentProgressText(step.content) ?? 'Agent processing step completed.';
}

/**
 * Process-independent batch application service. It owns OCR job semantics,
 * persistence, scheduling, and lifecycle events, but never reads or writes
 * process stdio, installs signal handlers, or chooses a process exit code.
 */
export class OcrJobService {
  constructor(private readonly dependencies: OcrJobServiceDependencies) {}

  private validateInput(input: ResolvedInput, options: ResolvedCliOptions): Promise<void> {
    if (this.dependencies.validateInput) return this.dependencies.validateInput(input, options);
    return readAndValidateInput(input).then(() => undefined);
  }

  private assertInputSupported(input: ResolvedInput, options: ResolvedCliOptions): void {
    if (this.dependencies.assertInputSupported) {
      this.dependencies.assertInputSupported(input, options);
      return;
    }
    assertProviderMediaTypeSupported(input.mimeType, options);
  }

  async run(
    inputs: ResolvedInput[],
    options: ResolvedCliOptions,
    runtime: OcrJobServiceRuntime,
  ): Promise<OcrJobServiceResult> {
    const protocolVersion = runtime.protocolVersion ?? OCR_PROTOCOL_VERSION;
    const deliveryMode = runtime.deliveryMode ?? 'reference';
    const events = new EventDispatcher(runtime.runId, protocolVersion, runtime.eventSink);
    const providerRuntime = createProviderExecutionContext({
      requestsPerMinute: options.requestsPerMinute,
      maxCostUsd: options.maxCostUsd,
    });
    let batchLock: BatchOutputLock | undefined;
    let summary: BatchSummary | undefined;
    let failure: unknown;

    await events.emit({
      type: 'run.started',
      total: inputs.length,
      provider: options.provider,
      gateway: options.gateway,
      model: options.model,
      mode: options.mode,
      dryRun: options.dryRun,
    });

    try {
      const needsManifest = runtime.deliveryMode !== 'inline'
        && (inputs.length > 1 || runtime.enableSingleInputResume === true);
      if (needsManifest && !options.dryRun) {
        try {
          batchLock = await BatchOutputLock.acquire(defaultOutputDirectory(options), {
            forceUnlock: options.forceUnlock,
            onWarning: runtime.onWarning,
          });
        } catch (error) {
          throw asCliExitError(error, 2);
        }
      }
      summary = await this.runBatchInternal(inputs, options, runtime, events, providerRuntime);
    } catch (error) {
      failure = error;
    }

    try {
      await batchLock?.release();
    } catch (lockError) {
      failure = failure === undefined
        ? lockError
        : new Error(
            `${errorMessage(failure)}; batch lock cleanup also failed: ${errorMessage(lockError)}`,
            { cause: failure },
          );
    }

    if (failure !== undefined) {
      const typedFailure = failure instanceof CliExitError
        ? failure
        : new CliExitError(errorMessage(failure), 1, {
            cause: failure,
            code: 'INTERNAL',
            category: 'internal',
            retryable: false,
            hint: 'Retry once, then report the failure with non-secret diagnostics if it persists.',
          });
      await events.emit({ type: 'run.failed', error: ocrErrorPayload(typedFailure) });
      await events.flush();
      throw typedFailure;
    }
    if (!summary) throw new Error('Internal error: batch completed without a summary');

    const result = toOcrRunResult(
      runtime.runId,
      summary,
      protocolVersion,
      deliveryMode,
      options.format,
      runtime.progress ?? options.progress,
    );
    await events.emit({ type: 'run.completed', result });
    await events.flush();
    return { runId: runtime.runId, summary, result };
  }

  private async runBatchInternal(
    inputs: ResolvedInput[],
    options: ResolvedCliOptions,
    runtime: OcrJobServiceRuntime,
    events: EventDispatcher,
    providerRuntime: ProviderExecutionContext,
  ): Promise<BatchSummary> {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    const explicitDelivery = runtime.deliveryMode;
    // stdin IDs include a content hash. Compute them once per document so a
    // detailed streaming run does not re-hash tens of megabytes for every
    // model delta.
    const documentIds = inputs.map((input) => ocrDocumentId({ input }));
    const shouldWriteFiles = explicitDelivery === 'reference'
      || (explicitDelivery === undefined && (
        inputs.length > 1 || Boolean(options.output) || options.format === 'all'
      ));
    const needsManifest = shouldWriteFiles
      && (inputs.length > 1 || runtime.enableSingleInputResume === true);
    if (shouldWriteFiles) {
      try {
        await assertNoOutputCollisions(inputs, options, needsManifest);
      } catch (error) {
        throw asCliExitError(error, 2);
      }
    }
    const manifest = needsManifest ? new ManifestStore(defaultOutputDirectory(options)) : undefined;
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
          else if (shouldWriteFiles) await assertArtifactTargetsAvailable(input, options, inputs.length);
        }));
      } catch (error) {
        throw asCliExitError(error, 2);
      }
    }
    const results = new Array<OcrJobResult | undefined>(inputs.length);
    let cursor = 0;
    let completed = 0;
    let failFastTriggered = false;
    let costLimitReached = false;

    const publishResult = async (index: number, result: OcrJobResult): Promise<void> => {
      completed += 1;
      await runtime.onDocumentResult?.(completed, inputs.length, result);
      await events.emit({
        type: terminalEventType(result),
        document: toProtocolDocument(
          result,
          runtime.protocolVersion ?? OCR_PROTOCOL_VERSION,
          runtime.deliveryMode ?? 'reference',
          options.format,
          runtime.progress ?? options.progress,
        ),
      });
      // Large bodies have already been persisted and observed by the adapter.
      results[index] = shouldWriteFiles && inputs.length > 1 && result.artifacts
        ? { ...result, artifacts: undefined }
        : result;
    };

    const worker = async (): Promise<void> => {
      while (!runtime.abortController.signal.aborted && !failFastTriggered && !costLimitReached) {
        const index = cursor;
        if (index >= inputs.length) return;
        if (providerRuntime.hasReachedCostLimit()) {
          costLimitReached = true;
          return;
        }
        cursor += 1;
        const input = inputs[index];
        const jobStart = performance.now();
        const jobStartedAt = new Date().toISOString();
        const key = input.absolutePath ?? '<stdin>';
        const fingerprint = inputFingerprint(input, fingerprintMode);
        await events.emit({
          type: 'document.started',
          documentId: documentIds[index],
          index,
          total: inputs.length,
          source: input.displayPath,
        });

        let result: OcrJobResult;
        const completedEntry = resumableEntries.get(index);
        if (options.dryRun) {
          try {
            this.assertInputSupported(input, options);
            await this.validateInput(input, options);
            const plannedOutputFiles = shouldWriteFiles
              ? await plannedArtifactTargets(input, options, inputs.length)
              : [];
            result = {
              status: 'skipped', input, provider: options.provider, gateway: options.gateway,
              mode: options.mode, model: options.model, startedAt: jobStartedAt,
              completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart,
              attempts: 0, plannedOutputFiles, skipReason: 'validated',
            };
          } catch (error) {
            result = {
              status: 'failed', input, provider: options.provider, gateway: options.gateway,
              mode: options.mode, model: options.model, startedAt: jobStartedAt,
              completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart,
              attempts: 0, error: errorMessage(error), errorDetails: ocrErrorPayload(error),
            };
            if (options.failFast) failFastTriggered = true;
          }
        } else if (completedEntry) {
          result = {
            status: 'skipped', input, provider: options.provider, gateway: options.gateway,
            mode: options.mode, model: options.model, startedAt: jobStartedAt,
            completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart,
            attempts: 0, outputFiles: completedEntry.outputFiles, skipReason: 'resumed',
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
          let progressFailure: unknown;
          try {
            this.assertInputSupported(input, options);
            const { artifacts, attempts } = await this.dependencies.extractDocument(
              input,
              options,
              timeoutController.signal,
              (step) => {
                try {
                  runtime.onAgentStep?.(input, step);
                  const protocolStep = agentProtocolStep(step, runtime.progress ?? options.progress);
                  if (!protocolStep) return;
                  void events.emit({
                    type: 'document.progress',
                    documentId: documentIds[index],
                    index,
                    total: inputs.length,
                    source: input.displayPath,
                    phase: step.type,
                    message: agentProgressMessage(step),
                    step: protocolStep,
                  }).catch((error: unknown) => {
                    progressFailure ??= error;
                  });
                } catch (error) {
                  // agentProtocolStep / assertOcrJobEvent can throw sync; keep
                  // the intentional document-boundary progressFailure path.
                  progressFailure ??= error;
                }
              },
              providerRuntime,
            );
            // Agent runtimes may preserve partial memory by returning normally
            // after their signal fires. The document boundary owns timeout and
            // cancellation semantics, so never accept that return as a normal
            // partial/successful extraction.
            if (timeoutController.signal.aborted) {
              throw timeoutController.signal.reason instanceof Error
                ? timeoutController.signal.reason
                : new DOMException('Operation aborted', 'AbortError');
            }
            await events.flush();
            if (progressFailure !== undefined) {
              throw progressFailure instanceof Error
                ? progressFailure
                : new Error(errorMessage(progressFailure));
            }
            if (explicitDelivery === 'inline') {
              assertArtifactFormatAvailable(artifacts, options.format);
            }
            const outputFiles = shouldWriteFiles
              ? await writeArtifacts(input, artifacts, options, inputs.length)
              : undefined;
            const agentMemory = options.mode === 'agentic' && artifacts.json && typeof artifacts.json === 'object'
              ? artifacts.json as { stopReason?: string }
              : undefined;
            const jobStatus: OcrJobResult['status'] = agentMemory?.stopReason && agentMemory.stopReason !== 'succeeded'
              ? 'partial'
              : 'succeeded';
            if (agentMemory?.stopReason === 'cost_limit_reached') costLimitReached = true;
            result = {
              status: jobStatus, input, provider: options.provider, gateway: options.gateway,
              mode: options.mode, model: options.model, startedAt: jobStartedAt,
              completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart,
              artifacts, outputFiles, attempts,
            };
            await manifest?.update(key, {
              fingerprint,
              status: jobStatus,
              outputFiles: outputFiles ?? [],
              completedAt: result.completedAt,
            });
          } catch (error) {
            if (progressFailure !== undefined && error === progressFailure) throw error;
            const cancelled = runtime.abortController.signal.aborted && !timedOut;
            const message = timedOut
              ? `Timed out after ${options.timeoutSeconds}s`
              : cancelled
                ? errorMessage(runtime.abortController.signal.reason ?? error)
                : errorMessage(error);
            const typedError = timedOut
              ? new CliExitError(message, 1, { code: 'TIMEOUT', category: 'limit', retryable: true })
              : cancelled
                ? new CliExitError(message, 130, { cause: error })
                : error;
            if (isProviderCostLimitError(error)) costLimitReached = true;
            result = {
              status: cancelled ? 'skipped' : 'failed', input, provider: options.provider, gateway: options.gateway,
              mode: options.mode, model: options.model, startedAt: jobStartedAt,
              completedAt: new Date().toISOString(), durationMs: performance.now() - jobStart,
              ...(cancelled ? { skipReason: 'cancelled' as const } : {}),
              error: message, errorDetails: ocrErrorPayload(typedError, 1), attempts: errorAttempts(error),
            };
            // An interrupted document must remain resumable. The manifest has no
            // cancelled state, so persist it as failed while exposing the richer
            // skipped/cancelled status through the machine and batch contracts.
            await manifest?.update(key, {
              fingerprint,
              status: 'failed',
              outputFiles: [],
              completedAt: result.completedAt,
              error: message,
            });
            if (options.failFast && !cancelled) failFastTriggered = true;
          } finally {
            clearTimeout(timeout);
            runtime.abortController.signal.removeEventListener('abort', relayAbort);
          }
        }
        await publishResult(index, result);
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
      const errorDetails = unscheduledSkipReason === 'cancelled'
        ? ocrErrorPayload(new CliExitError(unscheduledReason, 130))
        : unscheduledSkipReason === 'cost-limit'
          ? ocrErrorPayload(new CliExitError(unscheduledReason, 1, {
              code: 'COST_LIMIT', category: 'limit', retryable: false,
            }))
          : ocrErrorPayload(new CliExitError(unscheduledReason, 1, {
              code: 'NOT_RUN', category: 'execution', retryable: true,
              hint: 'Rerun the skipped documents without --fail-fast after addressing the first failure.',
            }));
      // Emit document.started so every documentId appears in the lifecycle
      // stream before its terminal event (including fail-fast/cost/cancel remainders).
      await events.emit({
        type: 'document.started',
        documentId: documentIds[index],
        index,
        total: inputs.length,
        source: inputs[index].displayPath,
      });
      const result: OcrJobResult = {
        status: 'skipped', input: inputs[index], provider: options.provider, gateway: options.gateway,
        mode: options.mode, model: options.model, startedAt: timestamp, completedAt: timestamp,
        durationMs: 0, attempts: 0, skipReason: unscheduledSkipReason,
        error: unscheduledReason, errorDetails,
      };
      await publishResult(index, result);
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
      usage: providerRuntime.getUsage(),
      costLimitUsd: options.maxCostUsd,
      costLimitReached: costLimitReached || providerRuntime.wasCostLimitDenied(),
      results: finishedResults,
    };
    if (shouldWriteFiles && inputs.length > 1 && !options.dryRun) {
      await writeBatchSummary(
        { ...summary, results: summary.results.map((result) => ({ ...result, artifacts: undefined })) },
        defaultOutputDirectory(options),
      );
    }
    return summary;
  }
}
