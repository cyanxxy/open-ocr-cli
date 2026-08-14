import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  createRequestStateCodec,
  fromJsonSchema,
  inputRequired,
  inputResponse,
  type CacheHint,
  type InputRequiredResult,
  type RequestStateCodec,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';

import { GATEWAY_IDS, PROVIDER_IDS } from '@open-ocr/engine/providers';
import errorV2Schema from '../schemas/error-v2.schema.json';
import resultV2Schema from '../schemas/result-v2.schema.json';
import { CliExitError, cliExitCode, cliSignalExitCode, ocrErrorPayload } from './errors';
import { isRecord } from './jsonValidation';
import { executeOcrJobRequest } from './machine';
import { normalizeAgentProgressText } from './ocrJobService';
import {
  createOcrCapabilities,
  isStdinRequestInput,
  parseOcrJobRequest,
  toOcrRunFailure,
  type OcrJobEvent,
  type OcrJobRequest,
  type OcrMachineResult,
} from './protocol';

const thinkingLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const contentFormats = ['markdown', 'json', 'csv', 'all'] as const;
const progressLevels = ['off', 'standard', 'detailed'] as const;

const EXTERNAL_ERROR_REF = 'error-v2.schema.json';
const INLINED_ERROR_REF = '#/$defs/errorPayload';

function rewriteExternalErrorRef(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteExternalErrorRef);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [
    key,
    key === '$ref' && value === EXTERNAL_ERROR_REF ? INLINED_ERROR_REF : rewriteExternalErrorRef(value),
  ]));
}

/**
 * The advertised output schema has to stand alone: the protocol's own Ajv
 * instance registers every schema file so `result-v2` can reference
 * `error-v2` across files, but the SDK compiles whatever it is handed in
 * isolation. So the error definition is inlined and the single cross-file
 * `$ref` repointed at it.
 *
 * `type: 'object'` is stamped at the root deliberately. The root is a `oneOf`
 * over two `$ref` branches, and the SDK does not follow `$ref` when deciding
 * whether an advertised `outputSchema` has an object root. Both branches are
 * objects, so the stamp accurately describes the result.
 */
function selfContainedResultSchema(): Record<string, unknown> {
  const { $id: _errorId, $schema: _errorSchema, ...errorPayload } = errorV2Schema as Record<string, unknown>;
  const rewritten = rewriteExternalErrorRef(resultV2Schema) as Record<string, unknown>;
  return {
    ...rewritten,
    type: 'object',
    $defs: { ...(rewritten.$defs as Record<string, unknown>), errorPayload },
  };
}

const ocrResultOutputSchema = fromJsonSchema<OcrMachineResult>(selfContainedResultSchema());

// Every catalogue this server publishes — discovery, the tool list, the
// resource list, and the capabilities document itself — is a pure function of
// the CLI version, so shared caches may hold all of them.
//
// This has to be declared on each cacheable method: SEP-2549 requires `ttlMs`
// and `cacheScope` on every list result, and the SDK supplies `ttlMs: 0,
// cacheScope: 'private'` for any method left out. That default is not "no
// opinion", it is an explicit instruction never to cache — which is the wrong
// answer for a catalogue that cannot change until the binary does.
const STATIC_CACHE_HINT: CacheHint = { ttlMs: 3_600_000, cacheScope: 'public' };

// Elicited confirmation before a billed run. Opt-in through the environment
// rather than a tool argument: a safety gate the model can switch off by
// omitting a field is not a safety gate.
const CONFIRM_ENV = 'OPEN_OCR_MCP_CONFIRM';
const CONFIRM_KEY = 'proceed';
const CONFIRM_TTL_MS = 600_000;

interface ConfirmationState {
  nonce: string;
  requestHash: string;
}

interface ConfirmationGuard {
  codec: RequestStateCodec<ConfirmationState>;
  consumed: Map<string, number>;
}

/**
 * A local document path.
 *
 * `-` is rejected in the advertised schema rather than only at execution time,
 * so `tools/list` states the restriction and a client that sends it gets a
 * validation error instead of a hung call: under `mcp`, stdin is the JSON-RPC
 * channel, and a document read from it never terminates.
 */
const documentPath = z.string().min(1)
  .regex(/^(?!-$).+$/u, 'stdin ("-") is unavailable over MCP; pass a file path');

const inputsField = z.array(documentPath).min(1)
  .describe('Files, directories, or globs, resolved against the server working directory. Directories are scanned recursively, skipping hidden entries and node_modules, dist, build, vendor, and target.');

const sharedFields = {
  configPath: z.string().min(1).optional()
    .describe('Explicit CLI configuration file, resolved against the server working directory.'),
  noConfig: z.boolean().optional()
    .describe('Ignore user and project configuration files and the project .env for a hermetic run.'),
  provider: z.enum(PROVIDER_IDS).optional()
    .describe('Model provider. Defaults to the configured provider, otherwise gemini.'),
  gateway: z.enum(GATEWAY_IDS).optional()
    .describe('API route: direct, or through Cloudflare AI Gateway.'),
  model: z.string().min(1).optional()
    .describe('Provider model ID. Gemini IDs are validated against the supported list; other profiles accept upstream IDs.'),
  thinking: z.enum(thinkingLevels).optional()
    .describe('Reasoning effort. Supported levels are provider- and model-specific; read them from open-ocr://capabilities.'),
  outputDirectory: z.string().min(1).optional()
    .describe('Where reference artifacts are written. Defaults to .open-ocr-results/<runId>. Reference delivery only.'),
  delivery: z.enum(['inline', 'reference']).optional()
    .describe('reference (default) writes artifact files and returns their paths; inline returns content in the response and writes nothing.'),
  resume: z.boolean().optional()
    .describe('Skip unchanged documents recorded in the output directory manifest. Only meaningful with an explicit outputDirectory, since the default one is per-run.'),
  timeoutSeconds: z.number().int().min(1).max(3600).optional()
    .describe('Per-document time limit.'),
  maxFiles: z.number().int().min(1).max(100_000).optional()
    .describe('Refuse the run before any provider call if discovery matches more than this many documents.'),
  maxTotalMb: z.number().min(1).max(1_048_576).optional()
    .describe('Refuse the run before any provider call if the matched documents exceed this combined size in MB.'),
  maxCostUsd: z.number().positive().max(1_000_000).optional()
    .describe('Stop scheduling new requests once estimated paid-tier cost reaches this value.'),
  requestsPerMinute: z.number().int().min(0).max(60_000).optional()
    .describe('Cap provider request starts per minute; 0 disables the limit.'),
  dryRun: z.boolean().optional()
    .describe('Validate inputs, schemas, limits, and planned artifacts without credentials, provider calls, or writes.'),
} as const;

// Strict objects, so a misspelled or unsupported argument is refused by name
// instead of silently stripped. A dropped `maxCostUsd` or `dryRun` is the
// difference between a bounded validation pass and an unbounded billed run.
const extractInputSchema = z.strictObject({
  ...sharedFields,
  inputs: inputsField,
  mode: z.enum(['simple', 'template']).optional()
    .describe('simple for transcription or a custom schema; template for a preset. Defaults to template when preset is set, otherwise simple.'),
  preset: z.string().min(1).optional()
    .describe('Structured extraction preset ID. Read the supported IDs from open-ocr://capabilities; setting this implies template mode.'),
  contentFormat: z.enum(contentFormats).optional()
    .describe('Artifact format. csv requires template mode and a table-shaped preset.'),
  schemaPath: z.string().min(1).optional()
    .describe('JSON Schema file for custom structured extraction. Requires simple mode and json contentFormat, and cannot be combined with preset.'),
  instructions: z.array(z.string().min(1)).optional()
    .describe('Extra extraction instructions. Simple mode only.'),
  concurrency: z.number().int().min(1).max(16).optional()
    .describe('Documents processed in parallel.'),
  retries: z.number().int().min(0).max(10).optional()
    .describe('Transient retries per document.'),
  failFast: z.boolean().optional()
    .describe('Stop scheduling new documents after the first failure.'),
});

const agenticInputSchema = z.strictObject({
  ...sharedFields,
  inputs: inputsField,
  contentFormat: z.enum(['markdown', 'json', 'all']).optional()
    .describe('Artifact format. all additionally writes the agent step trace.'),
  instructions: z.array(z.string().min(1)).optional()
    .describe('Extra extraction instructions. Agentic mode does not read them; they are reported as an ignored option.'),
  progress: z.enum(progressLevels).optional()
    .describe('Step detail relayed as MCP progress notifications. detailed also exposes provider reasoning and tool payloads, which can contain document contents.'),
  maxIterations: z.number().int().min(1).max(20).optional()
    .describe('Maximum outer agent iterations per document.'),
  confidenceThreshold: z.number().min(0).max(1).optional()
    .describe('Completion confidence at which the agent stops.'),
  maxTokens: z.number().int().min(256).max(1_048_576).optional()
    .describe('Maximum generated tokens per model response; the selected model may enforce a lower ceiling.'),
  concurrency: z.number().int().min(1).max(16).optional()
    .describe('Documents processed in parallel.'),
});

const webInputSchema = z.strictObject({
  ...sharedFields,
  urls: z.array(z.url()).min(1).max(20)
    .describe('Public HTTP(S) URLs. Loopback, private, and tunnelling hosts are refused.'),
  analysis: z.enum(['individual', 'combined', 'comparison']).optional()
    .describe('individual (default) returns one result per URL; combined merges them into one document; comparison contrasts them.'),
  contentFormat: z.enum(['markdown', 'json']).optional().describe('Output format.'),
});

type ExtractMcpInput = z.infer<typeof extractInputSchema>;
type AgenticMcpInput = z.infer<typeof agenticInputSchema>;
type WebMcpInput = z.infer<typeof webInputSchema>;
type SharedMcpInput = Pick<
  ExtractMcpInput,
  | 'configPath'
  | 'noConfig'
  | 'provider'
  | 'gateway'
  | 'model'
  | 'thinking'
  | 'outputDirectory'
  | 'delivery'
  | 'resume'
  | 'timeoutSeconds'
  | 'maxFiles'
  | 'maxTotalMb'
  | 'maxCostUsd'
  | 'requestsPerMinute'
  | 'dryRun'
>;

function providerRequest(input: SharedMcpInput): OcrJobRequest['provider'] | undefined {
  if (!input.provider && !input.gateway && !input.model) return undefined;
  return {
    ...(input.provider ? { id: input.provider } : {}),
    ...(input.gateway ? { gateway: input.gateway } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
}

function executionRequest(
  input: SharedMcpInput & {
    concurrency?: number;
    retries?: number;
    failFast?: boolean;
  },
): OcrJobRequest['execution'] | undefined {
  const execution: NonNullable<OcrJobRequest['execution']> = {
    ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
    ...(input.retries !== undefined ? { retries: input.retries } : {}),
    ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {}),
    ...(input.maxFiles !== undefined ? { maxFiles: input.maxFiles } : {}),
    ...(input.maxTotalMb !== undefined ? { maxTotalMb: input.maxTotalMb } : {}),
    ...(input.maxCostUsd !== undefined ? { maxCostUsd: input.maxCostUsd } : {}),
    ...(input.requestsPerMinute !== undefined
      ? { requestsPerMinute: input.requestsPerMinute }
      : {}),
    ...(input.failFast !== undefined ? { failFast: input.failFast } : {}),
  };
  return Object.keys(execution).length > 0 ? execution : undefined;
}

function deliveryRequest(input: SharedMcpInput): OcrJobRequest['delivery'] {
  const mode = input.delivery ?? 'reference';
  return {
    mode,
    ...(input.outputDirectory ? { outputDirectory: input.outputDirectory } : {}),
    ...(input.resume !== undefined ? { resume: input.resume } : {}),
  };
}

function requestBase(input: SharedMcpInput): Pick<
  OcrJobRequest,
  'protocolVersion' | 'operation' | 'configPath' | 'noConfig' | 'provider' | 'delivery' | 'dryRun'
> {
  const provider = providerRequest(input);
  return {
    protocolVersion: 2,
    operation: 'extract',
    ...(input.configPath ? { configPath: input.configPath } : {}),
    ...(input.noConfig !== undefined ? { noConfig: input.noConfig } : {}),
    ...(provider ? { provider } : {}),
    delivery: deliveryRequest(input),
    ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
  };
}

export function buildExtractMcpRequest(input: ExtractMcpInput): OcrJobRequest {
  const execution = executionRequest(input);
  return parseOcrJobRequest({
    ...requestBase(input),
    inputs: input.inputs.map((inputPath) => ({ type: 'path' as const, path: inputPath })),
    extraction: {
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.preset ? { preset: input.preset } : {}),
      ...(input.contentFormat ? { contentFormat: input.contentFormat } : {}),
      ...(input.schemaPath ? { schemaPath: input.schemaPath } : {}),
      ...(input.instructions ? { instructions: input.instructions } : {}),
      ...(input.thinking ? { thinking: input.thinking } : {}),
    },
    ...(execution ? { execution } : {}),
  });
}

export function buildAgenticMcpRequest(input: AgenticMcpInput): OcrJobRequest {
  const execution = executionRequest(input);
  return parseOcrJobRequest({
    ...requestBase(input),
    inputs: input.inputs.map((inputPath) => ({ type: 'path' as const, path: inputPath })),
    extraction: {
      mode: 'agentic',
      ...(input.contentFormat ? { contentFormat: input.contentFormat } : {}),
      ...(input.instructions ? { instructions: input.instructions } : {}),
      ...(input.thinking ? { thinking: input.thinking } : {}),
      ...(input.progress ? { progress: input.progress } : {}),
      ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
      ...(input.confidenceThreshold !== undefined
        ? { confidenceThreshold: input.confidenceThreshold }
        : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    },
    ...(execution ? { execution } : {}),
  });
}

export function buildWebMcpRequest(input: WebMcpInput): OcrJobRequest {
  const execution = executionRequest(input);
  return parseOcrJobRequest({
    ...requestBase(input),
    inputs: input.urls.map((url) => ({ type: 'url' as const, url })),
    extraction: {
      mode: 'simple',
      ...(input.contentFormat ? { contentFormat: input.contentFormat } : {}),
      ...(input.thinking ? { thinking: input.thinking } : {}),
    },
    web: { analysis: input.analysis ?? 'individual' },
    ...(execution ? { execution } : {}),
  });
}

interface McpRequestContext {
  mcpReq: {
    signal: AbortSignal;
    _meta?: { progressToken?: string | number };
    /**
     * The per-request `io.modelcontextprotocol/*` envelope. Present only on a
     * 2026-07-28 request. This revision has no handshake, so this is the only
     * place the client's capabilities appear.
     */
    envelope?: Readonly<Record<string, unknown>>;
    /** Populated only on a request the client retried with elicited answers. */
    inputResponses?: Record<string, unknown>;
    /**
     * Keys the SDK discarded because the client sent something that was not a
     * bare response object. The answer is gone, so re-asking for the same key
     * would loop until the round limit.
     */
    droppedInputResponseKeys?: string[];
    requestState: <T = unknown>() => T | undefined;
    notify: (notification: {
      method: 'notifications/progress';
      params: {
        progressToken: string | number;
        progress: number;
        message?: string;
      };
    }) => Promise<void>;
  };
}

function ocrFailure(message: string, code: 'CONFIG_INVALID' | 'CANCELLED', hint: string): ReturnType<typeof mcpResult> {
  const error = new CliExitError(message, 2, {
    code,
    category: code === 'CANCELLED' ? 'cancelled' : 'configuration',
    retryable: false,
    hint,
  });
  return mcpResult(toOcrRunFailure(randomUUID(), ocrErrorPayload(error)));
}

function confirmationMessage(request: OcrJobRequest): string {
  const documents = request.inputs.length;
  const noun = documents === 1 ? 'document' : 'documents';
  const target = request.provider?.model ?? request.provider?.id ?? 'the configured provider';
  const ceiling = request.execution?.maxCostUsd === undefined
    ? 'no cost ceiling'
    : `a $${request.execution.maxCostUsd} ceiling`;
  // Deliberately not "this calls a paid API": free tiers, local
  // OpenAI-compatible endpoints and preflight failures all exist, and a prompt
  // that overstates what it knows trains people to click through it.
  return `Run OCR on ${documents} ${noun} with ${target} (${ceiling})? This sends them to the provider and may incur charges.`;
}

/**
 * Takes `unknown` because that is the envelope's declared value type.
 *
 * On 2026-07-28 there is no handshake, so client capabilities arrive inside the
 * per-request `_meta` envelope. The transport validates that envelope against
 * its schema and answers a malformed one with -32602 before any handler runs, so
 * this is defence in depth rather than the only check — but the value is still
 * `unknown` here, and asserting the declared type onto it would be unverified.
 * Anything that is not the shape this reads counts as "cannot prompt", which
 * fails closed: the run is refused rather than billed without a prompt.
 */
function supportsFormElicitation(capabilities: unknown): boolean {
  if (!isRecord(capabilities)) return false;
  const elicitation = capabilities.elicitation;
  if (!isRecord(elicitation)) return false;
  return elicitation.form !== undefined || elicitation.url === undefined;
}

function confirmationRequestHash(request: OcrJobRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('base64url');
}

/**
 * Billed, effectively irreversible work behind an operator-controlled prompt.
 * Returns `undefined` to proceed, an `InputRequiredResult` to ask, or a typed
 * failure when the answer was no.
 */
async function confirmationGate(
  request: OcrJobRequest,
  context: McpRequestContext,
  clientCapabilities: unknown,
  guard: ConfirmationGuard,
): Promise<InputRequiredResult | ReturnType<typeof mcpResult> | undefined> {
  // A dry run neither bills nor writes, so there is nothing to confirm.
  if (request.dryRun) return undefined;
  if (process.env[CONFIRM_ENV] !== '1') return undefined;

  // The client answered but the SDK could not read the answer. Asking again
  // would produce the same unreadable reply every round until the shim gives
  // up, so this refuses once instead of looping.
  if (context.mcpReq.droppedInputResponseKeys?.includes(CONFIRM_KEY)) {
    return ocrFailure(
      'The confirmation answer could not be read.',
      'CANCELLED',
      'The client returned a malformed elicitation result; re-run and confirm again.',
    );
  }

  const answer = inputResponse(context.mcpReq.inputResponses, CONFIRM_KEY);
  if (answer.kind === 'missing') {
    if (clientCapabilities !== undefined && !supportsFormElicitation(clientCapabilities)) {
      return ocrFailure(
        `${CONFIRM_ENV} is set but this MCP client cannot prompt for confirmation.`,
        'CONFIG_INVALID',
        `Unset ${CONFIRM_ENV}, or connect a client that supports elicitation.`,
      );
    }
    return inputRequired({
      inputRequests: {
        [CONFIRM_KEY]: inputRequired.elicit({
          message: confirmationMessage(request),
          requestedSchema: {
            type: 'object',
            properties: {
              [CONFIRM_KEY]: {
                type: 'boolean',
                title: 'Run the OCR job',
                description: 'Confirm the paid extraction run.',
              },
            },
            required: [CONFIRM_KEY],
          },
        }),
      },
      requestState: await guard.codec.mint({
        nonce: randomUUID(),
        requestHash: confirmationRequestHash(request),
      }),
    });
  }

  const state = context.mcpReq.requestState<ConfirmationState>();
  const now = Date.now();
  for (const [nonce, expiresAt] of guard.consumed) {
    if (expiresAt <= now) guard.consumed.delete(nonce);
  }
  if (
    state === undefined
    || state.requestHash !== confirmationRequestHash(request)
    || guard.consumed.has(state.nonce)
  ) {
    return ocrFailure(
      'The confirmation could not be verified.',
      'CANCELLED',
      'Re-run the tool and confirm this exact OCR request again.',
    );
  }
  guard.consumed.set(state.nonce, now + CONFIRM_TTL_MS);

  const accepted = answer.kind === 'elicit'
    && answer.action === 'accept'
    && answer.content?.[CONFIRM_KEY] === true;
  if (accepted) return undefined;
  return ocrFailure(
    'The OCR run was not confirmed.',
    'CANCELLED',
    'Re-run the tool and accept the confirmation prompt to proceed.',
  );
}

/**
 * A progress line for the MCP client.
 *
 * Step text is model- and document-derived, so it goes through the same
 * bounding and control-character stripping the direct CLI applies before
 * writing agent progress to a terminal: unbounded raw text here means every
 * notification can carry a document-sized payload with ANSI escapes and
 * bidirectional overrides in it, rendered by whatever UI the host has.
 */
function progressMessage(event: OcrJobEvent): string {
  const text = event.step?.text ? normalizeAgentProgressText(event.step.text) : undefined;
  if (text) return text;
  if (event.step?.name) return `${event.type}: ${event.step.name}`;
  if (event.source) return `${event.type}: ${event.source}`;
  return event.type;
}

interface McpTextBlock {
  type: 'text';
  text: string;
}

interface McpResourceLinkBlock {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType: string;
  description: string;
}

/**
 * Reference-first artifacts are already `{ path, mediaType, kind }`, which is
 * exactly what an MCP resource link carries. Emitting them as `resource_link`
 * blocks lets a client resolve them natively instead of parsing absolute paths
 * out of the JSON body. Only artifacts that were actually written are linked:
 * `plannedArtifacts` from a dry run name files that do not exist yet.
 */
function artifactResourceLinks(result: OcrMachineResult): McpResourceLinkBlock[] {
  if (!('documents' in result)) return [];
  return result.documents.flatMap((document) => document.artifacts.map((artifact) => ({
    type: 'resource_link' as const,
    uri: pathToFileURL(artifact.path).href,
    name: path.basename(artifact.path),
    mimeType: artifact.mediaType,
    description: `${artifact.kind} output for ${document.source}`,
  })));
}

/**
 * The text block that mirrors `structuredContent` for hosts that render content
 * only.
 *
 * Normally that is the envelope itself: for reference delivery it is a few
 * hundred bytes of metadata and paths. Inline delivery is the exception — the
 * envelope then carries every extracted document body, and mirroring it verbatim
 * sends the whole corpus twice in one response. There the mirror collapses to a
 * summary, and the bodies travel once, in `structuredContent`.
 */
function resultTextBlock(result: OcrMachineResult): McpTextBlock {
  const inline = 'documents' in result && result.documents.some((document) => document.content !== undefined);
  if (!inline) return { type: 'text', text: JSON.stringify(result) };
  const summary = `${result.status} run ${result.runId}: `
    + `${result.succeeded} succeeded, ${result.partial} partial, ${result.failed} failed, ${result.skipped} skipped `
    + `of ${result.total}. Document bodies are in structuredContent.documents[].content.`;
  return { type: 'text', text: summary };
}

export function mcpResult(result: OcrMachineResult): {
  content: Array<McpTextBlock | McpResourceLinkBlock>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
} {
  return {
    content: [
      resultTextBlock(result),
      ...artifactResourceLinks(result),
    ],
    structuredContent: result as unknown as Record<string, unknown>,
    // Track `ok` rather than the `failed` status alone. `partial`, `cancelled`
    // and `cost_limited` all hand the caller less than it asked for — a
    // document failed, the run stopped early, or the budget cut it short — so
    // reporting the tool call as successful while `structuredContent.ok` is
    // false lets a client act on results it never received.
    ...(result.ok ? {} : { isError: true }),
  };
}

async function executeMcpRequest(
  request: OcrJobRequest,
  context: McpRequestContext,
  cwd: string,
): Promise<ReturnType<typeof mcpResult>> {
  const runId = randomUUID();
  // Both spellings of "read the document from stdin" have to be refused here.
  // `-` as a path is the one the tools can actually produce — their `inputs` are
  // plain strings mapped to `{ type: 'path' }` — and the job service maps that
  // back to a stdin read. Under `mcp`, stdin is the JSON-RPC channel, so the
  // read never ends: the tool call hung forever with no response and swallowed
  // the client's subsequent requests.
  if (request.inputs.some(isStdinRequestInput)) {
    const error = new CliExitError('MCP stdio transport cannot also carry document stdin.', 2, {
      code: 'CONFIG_INVALID',
      category: 'configuration',
      retryable: false,
      hint: 'Use a file path or a URL; "-" reads stdin, which the MCP transport owns.',
    });
    return mcpResult(toOcrRunFailure(runId, ocrErrorPayload(error)));
  }

  const abortController = new AbortController();
  const relayAbort = (): void => abortController.abort(
    context.mcpReq.signal.reason instanceof Error
      ? context.mcpReq.signal.reason
      : new DOMException('MCP tool call cancelled', 'AbortError'),
  );
  if (context.mcpReq.signal.aborted) relayAbort();
  else context.mcpReq.signal.addEventListener('abort', relayAbort, { once: true });
  const progressToken = context.mcpReq._meta?.progressToken;

  try {
    const execution = await executeOcrJobRequest(request, {
      cwd,
      runId,
      abortController,
      eventSink: progressToken === undefined
        ? undefined
        : async (event) => context.mcpReq.notify({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: event.sequence + 1,
              message: progressMessage(event),
            },
          }),
      // stdout is the JSON-RPC channel, so diagnostics go to stderr; without
      // this the ignored-option warning would be dropped on the MCP surface.
      onWarning: (message) => process.stderr.write(`${message}\n`),
      noConfig: request.noConfig,
    });
    return mcpResult(execution.result);
  } catch (error) {
    const payload = ocrErrorPayload(error, cliExitCode(error));
    return mcpResult(toOcrRunFailure(runId, payload));
  } finally {
    context.mcpReq.signal.removeEventListener('abort', relayAbort);
  }
}

async function executeMcpTool(
  buildRequest: () => OcrJobRequest,
  context: McpRequestContext,
  cwd: string,
  confirmationGuard: ConfirmationGuard,
): Promise<ReturnType<typeof mcpResult> | InputRequiredResult> {
  try {
    const request = buildRequest();
    const gate = await confirmationGate(
      request,
      context,
      context.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY],
      confirmationGuard,
    );
    if (gate) return gate;
    return await executeMcpRequest(request, context, cwd);
  } catch (error) {
    const runId = randomUUID();
    const payload = ocrErrorPayload(error, cliExitCode(error));
    return mcpResult(toOcrRunFailure(runId, payload));
  }
}

export function createOcrMcpServer(version: string, cwd = process.cwd()): McpServer {
  const confirmationGuard: ConfirmationGuard = {
    codec: createRequestStateCodec<ConfirmationState>({
      key: randomBytes(32),
      ttlSeconds: CONFIRM_TTL_MS / 1000,
    }),
    consumed: new Map<string, number>(),
  };
  const server = new McpServer(
    { name: 'open-ocr-cli', version },
    {
      supportedProtocolVersions: ['2026-07-28'],
      instructions: 'Use dryRun for local validation, prefer reference delivery, and never place credentials in tool arguments.',
      cacheHints: {
        'server/discover': STATIC_CACHE_HINT,
        'tools/list': STATIC_CACHE_HINT,
        'resources/list': STATIC_CACHE_HINT,
        // Always empty — no templates are registered — but an empty list is
        // still a list, and leaving it out marks it uncacheable for no reason.
        'resources/templates/list': STATIC_CACHE_HINT,
      },
      inputRequired: { legacyShim: false },
      requestState: {
        verify: (state, context) => confirmationGuard.codec.verify(state, context),
      },
    },
  );
  server.server.removeRequestHandler('initialize');
  server.server.removeNotificationHandler('notifications/initialized');

  server.registerResource(
    'open-ocr-capabilities',
    'open-ocr://capabilities',
    {
      title: 'Open OCR capabilities',
      description: 'Versioned providers, modes, formats, limits, schemas, and error codes.',
      mimeType: 'application/json',
      cacheHint: STATIC_CACHE_HINT,
    },
    (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(createOcrCapabilities(version)),
      }],
    }),
  );

  const annotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  server.registerTool(
    'ocr_extract',
    {
      title: 'Extract documents',
      description: 'Extract local images or PDFs in simple or template mode. Defaults to reference delivery.',
      inputSchema: extractInputSchema,
      outputSchema: ocrResultOutputSchema,
      annotations,
    },
    async (input, context) => executeMcpTool(
      () => buildExtractMcpRequest(input),
      context,
      cwd,
      confirmationGuard,
    ),
  );

  server.registerTool(
    'ocr_run_agentic',
    {
      title: 'Run agentic OCR',
      description: 'Run iterative agentic OCR for difficult local images or PDFs.',
      inputSchema: agenticInputSchema,
      outputSchema: ocrResultOutputSchema,
      annotations,
    },
    async (input, context) => executeMcpTool(
      () => buildAgenticMcpRequest(input),
      context,
      cwd,
      confirmationGuard,
    ),
  );

  server.registerTool(
    'ocr_web',
    {
      title: 'Extract public URLs',
      description: 'Extract, combine, or compare up to 20 public HTTP(S) URLs through the shared OCR job service.',
      inputSchema: webInputSchema,
      outputSchema: ocrResultOutputSchema,
      annotations,
    },
    async (input, context) => executeMcpTool(
      () => buildWebMcpRequest(input),
      context,
      cwd,
      confirmationGuard,
    ),
  );

  return server;
}

export async function runMcpServer(version: string): Promise<void> {
  const handle = serveStdio(() => createOcrMcpServer(version), {
    legacy: 'reject',
    // stdout is the JSON-RPC channel; out-of-band errors belong on stderr.
    onerror: (error) => process.stderr.write(`${error.message}\n`),
  });

  // `serveStdio` returns as soon as the transport is listening, so without this
  // the command action would fall through and the process would survive only
  // because stdin happens to be open — with the handle dropped and no way to
  // close the pinned instance. Owning the wait keeps shutdown explicit: a
  // signal, or the host closing the pipe, tears the connection down.
  await new Promise<void>((resolve) => {
    let settled = false;
    const cleanup = (): void => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.stdin.removeListener('end', onStdinClose);
      process.stdin.removeListener('close', onStdinClose);
    };
    const shutdown = (signal?: 'SIGINT' | 'SIGTERM'): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal) process.exitCode = cliSignalExitCode(signal);
      void handle.close().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }).finally(resolve);
    };
    const onSigint = (): void => shutdown('SIGINT');
    const onSigterm = (): void => shutdown('SIGTERM');
    const onStdinClose = (): void => shutdown();
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    process.stdin.once('end', onStdinClose);
    process.stdin.once('close', onStdinClose);
  });
}
