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
  type ClientCapabilities,
  type InputRequiredResult,
  type RequestStateCodec,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';

import { GATEWAY_IDS, PROVIDER_IDS } from '../../../src/lib/providers';
import errorV2Schema from '../schemas/error-v2.schema.json';
import resultV2Schema from '../schemas/result-v2.schema.json';
import { CliExitError, cliExitCode, cliSignalExitCode, ocrErrorPayload } from './errors';
import { executeOcrJobRequest } from './machine';
import {
  createOcrCapabilities,
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
 * whether an advertised `outputSchema` has an object root — a non-object root
 * makes the 2025-era wire codec wrap `structuredContent` in `{ result: … }`,
 * silently changing the envelope every existing client already reads. Both
 * branches are `type: 'object'`, so the stamp is accurate and the wire shape
 * stays byte-identical.
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

// `server/discover`, `tools/list` and the capabilities document are pure
// functions of the CLI version, so shared caches may hold them. Cache fields are
// only emitted on 2026-07-28 requests; 2025-era responses are never affected.
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

const sharedFields = {
  configPath: z.string().min(1).optional(),
  noConfig: z.boolean().optional(),
  provider: z.enum(PROVIDER_IDS).optional(),
  gateway: z.enum(GATEWAY_IDS).optional(),
  model: z.string().min(1).optional(),
  thinking: z.enum(thinkingLevels).optional(),
  outputDirectory: z.string().min(1).optional(),
  delivery: z.enum(['inline', 'reference']).optional(),
  resume: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  maxCostUsd: z.number().positive().max(1_000_000).optional(),
  requestsPerMinute: z.number().int().min(0).max(60_000).optional(),
  dryRun: z.boolean().optional(),
} as const;

const extractInputSchema = z.object({
  ...sharedFields,
  inputs: z.array(z.string().min(1)).min(1),
  mode: z.enum(['simple', 'template']).optional(),
  preset: z.string().min(1).optional(),
  contentFormat: z.enum(contentFormats).optional(),
  schemaPath: z.string().min(1).optional(),
  instructions: z.array(z.string().min(1)).optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  failFast: z.boolean().optional(),
});

const agenticInputSchema = z.object({
  ...sharedFields,
  inputs: z.array(z.string().min(1)).min(1),
  contentFormat: z.enum(['markdown', 'json', 'all']).optional(),
  instructions: z.array(z.string().min(1)).optional(),
  progress: z.enum(progressLevels).optional(),
  maxIterations: z.number().int().min(1).max(20).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(256).max(1_048_576).optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
});

const webInputSchema = z.object({
  ...sharedFields,
  urls: z.array(z.url()).min(1).max(20),
  analysis: z.enum(['individual', 'combined', 'comparison']).optional(),
  contentFormat: z.enum(['markdown', 'json']).optional(),
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
     * 2026-07-28 request — that era has no handshake, so this is the only place
     * the client's capabilities appear.
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
  return mcpResult(toOcrRunFailure(randomUUID(), ocrErrorPayload(error), 2));
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
 * The two eras keep client capabilities in different places, and reading only
 * one of them silently disables the gate on the other. 2026-07-28 has no
 * handshake, so capabilities ride the per-request envelope and the session
 * accessor stays `undefined`; the 2025 era is the reverse. Verified on a live
 * stdio connection in both directions.
 */
function resolveClientCapabilities(
  context: McpRequestContext,
  sessionCapabilities: () => ClientCapabilities | undefined,
): ClientCapabilities | undefined {
  const fromEnvelope = context.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY];
  if (fromEnvelope !== undefined) return fromEnvelope as ClientCapabilities;
  return sessionCapabilities();
}

function supportsFormElicitation(capabilities: ClientCapabilities): boolean {
  const elicitation = capabilities.elicitation;
  if (elicitation === undefined) return false;
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
  clientCapabilities: ClientCapabilities | undefined,
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
    // Undefined capabilities means the SDK could not tell us — the 2026-07-28
    // era carries them per request rather than on a handshake. Ask anyway and
    // let the client refuse; silently skipping a confirmation the operator
    // switched on is the worse failure.
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

function progressMessage(event: OcrJobEvent): string {
  if (event.message) return event.message;
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

export function mcpResult(result: OcrMachineResult): {
  content: Array<McpTextBlock | McpResourceLinkBlock>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
} {
  return {
    content: [
      { type: 'text', text: JSON.stringify(result) },
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
  if (request.inputs.some((input) => input.type === 'stdin')) {
    const error = new CliExitError('MCP stdio transport cannot also carry document stdin.', 2, {
      code: 'CONFIG_INVALID',
      category: 'configuration',
      retryable: false,
      hint: 'Use path or URL inputs with MCP tools.',
    });
    return mcpResult(toOcrRunFailure(runId, ocrErrorPayload(error), 2));
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
    return mcpResult(toOcrRunFailure(runId, payload, 2));
  } finally {
    context.mcpReq.signal.removeEventListener('abort', relayAbort);
  }
}

async function executeMcpTool(
  buildRequest: () => OcrJobRequest,
  context: McpRequestContext,
  cwd: string,
  sessionCapabilities: () => ClientCapabilities | undefined,
  confirmationGuard: ConfirmationGuard,
): Promise<ReturnType<typeof mcpResult> | InputRequiredResult> {
  try {
    const request = buildRequest();
    const gate = await confirmationGate(
      request,
      context,
      resolveClientCapabilities(context, sessionCapabilities),
      confirmationGuard,
    );
    if (gate) return gate;
    return await executeMcpRequest(request, context, cwd);
  } catch (error) {
    const runId = randomUUID();
    const payload = ocrErrorPayload(error, cliExitCode(error));
    return mcpResult(toOcrRunFailure(runId, payload, 2));
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
      instructions: 'Use dryRun for local validation, prefer reference delivery, and never place credentials in tool arguments.',
      cacheHints: {
        'server/discover': STATIC_CACHE_HINT,
        'tools/list': STATIC_CACHE_HINT,
      },
      requestState: { verify: confirmationGuard.codec.verify },
    },
  );

  // Legacy-era only; the modern era carries capabilities per request.
  const sessionCapabilities = (): ClientCapabilities | undefined => server.server.getClientCapabilities();

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
      sessionCapabilities,
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
      sessionCapabilities,
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
      sessionCapabilities,
      confirmationGuard,
    ),
  );

  return server;
}

/**
 * `serveStdio` owns the era decision for the connection: the opening exchange
 * selects it, one instance from the factory is pinned for the connection, and
 * the same registrations serve both. A hand-wired `server.connect(transport)`
 * is pinned to the 2025 era and answers `server/discover` with -32601, so a
 * 2026-07-28 client can never negotiate. `legacy: 'serve'` (the default) keeps
 * today's clients on the exact path they use now.
 */
export async function runMcpServer(version: string): Promise<void> {
  const handle = serveStdio(() => createOcrMcpServer(version), {
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
