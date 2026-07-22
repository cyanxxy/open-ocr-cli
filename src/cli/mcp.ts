import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';

import { GATEWAY_IDS, PROVIDER_IDS } from '../lib/providers';
import { CliExitError, cliExitCode, ocrErrorPayload } from './errors';
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

function progressMessage(event: OcrJobEvent): string {
  if (event.message) return event.message;
  if (event.source) return `${event.type}: ${event.source}`;
  return event.type;
}

function mcpResult(result: OcrMachineResult): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
    ...(result.status === 'failed' ? { isError: true } : {}),
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
): Promise<ReturnType<typeof mcpResult>> {
  try {
    return await executeMcpRequest(buildRequest(), context, cwd);
  } catch (error) {
    const runId = randomUUID();
    const payload = ocrErrorPayload(error, cliExitCode(error));
    return mcpResult(toOcrRunFailure(runId, payload, 2));
  }
}

export function createOcrMcpServer(version: string, cwd = process.cwd()): McpServer {
  const server = new McpServer(
    { name: 'open-ocr-cli', version },
    {
      instructions: 'Use dryRun for local validation, prefer reference delivery, and never place credentials in tool arguments.',
    },
  );

  server.registerResource(
    'open-ocr-capabilities',
    'open-ocr://capabilities',
    {
      title: 'Open OCR capabilities',
      description: 'Versioned providers, modes, formats, limits, schemas, and error codes.',
      mimeType: 'application/json',
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
      annotations,
    },
    async (input, context) => executeMcpTool(() => buildExtractMcpRequest(input), context, cwd),
  );

  server.registerTool(
    'ocr_run_agentic',
    {
      title: 'Run agentic OCR',
      description: 'Run iterative agentic OCR for difficult local images or PDFs.',
      inputSchema: agenticInputSchema,
      annotations,
    },
    async (input, context) => executeMcpTool(() => buildAgenticMcpRequest(input), context, cwd),
  );

  server.registerTool(
    'ocr_web',
    {
      title: 'Extract public URLs',
      description: 'Extract, combine, or compare up to 20 public HTTP(S) URLs through the shared OCR job service.',
      inputSchema: webInputSchema,
      annotations,
    },
    async (input, context) => executeMcpTool(() => buildWebMcpRequest(input), context, cwd),
  );

  return server;
}

export async function runMcpServer(version: string): Promise<void> {
  const server = createOcrMcpServer(version);
  await server.connect(new StdioServerTransport());
}
