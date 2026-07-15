import { providerRequestHeaders } from './registry';
import { waitForProviderRequestSlot } from './requestPolicy';
import type { ProviderRuntimeConfig } from './types';
import { recordProviderUsage } from './usage';

export interface OpenAITextPart {
  type: 'text';
  text: string;
}

export interface OpenAIImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface OpenAIFilePart {
  type: 'file';
  file: { filename: string; file_data: string };
}

export type OpenAIContentPart = OpenAITextPart | OpenAIImagePart | OpenAIFilePart;

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
  reasoning?: string;
  reasoning_content?: string;
  reasoning_details?: unknown[];
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ChatCompletionRequest {
  messages: OpenAIMessage[];
  maxTokens: number;
  responseSchema?: Record<string, unknown>;
  schemaName?: string;
  tools?: OpenAITool[];
  toolChoice?: 'auto' | 'required' | 'none';
  signal?: AbortSignal;
  extraBody?: Record<string, unknown>;
}

export interface ChatCompletionResult {
  text: string;
  message: OpenAIMessage;
  finishReason?: string;
  raw: Record<string, unknown>;
}

export class ProviderApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ProviderApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function requestHeaders(config: ProviderRuntimeConfig, json = true): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...providerRequestHeaders(config),
  };
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey && !config.cloudflareByok) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

async function responseError(response: Response): Promise<ProviderApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const message = typeof error?.message === 'string'
    ? error.message
    : `Provider request failed with HTTP ${response.status}`;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  return new ProviderApiError(message, response.status, code);
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderApiError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || Boolean(error.status && error.status >= 500);
  }
  if (error instanceof TypeError) return true;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN';
}

function reasoningBody(config: ProviderRuntimeConfig): Record<string, unknown> {
  const level = config.thinkingConfig?.level ?? 'MEDIUM';
  const include = config.thinkingConfig?.includeThoughts ?? false;
  if (config.provider === 'kimi') {
    return level === 'MINIMAL'
      ? { thinking: { type: 'disabled' } }
      : { thinking: { type: 'enabled', keep: 'all' } };
  }
  if (config.provider === 'openrouter') {
    return {
      reasoning: { effort: level.toLowerCase(), exclude: !include },
    };
  }
  if (config.provider === 'muse') {
    // Meta's Chat Completions API accepts low, medium, or high.
    return { reasoning_effort: level === 'MINIMAL' ? 'low' : level.toLowerCase() };
  }
  return {};
}

/**
 * Kimi strict mode uses Moonshot Flavoured JSON Schema, which supports optional
 * properties. Other compatible routes commonly enforce OpenAI's narrower
 * strict subset, while our public schemas intentionally contain optional
 * fields. Keep those schemas as non-strict hints and validate returned custom
 * schema data locally instead of sending a request that the route rejects.
 */
function usesOptionalPropertyStrictDialect(config: ProviderRuntimeConfig): boolean {
  return config.provider === 'kimi';
}

function compatibleTools(config: ProviderRuntimeConfig, tools: OpenAITool[]): OpenAITool[] {
  const strict = usesOptionalPropertyStrictDialect(config);
  return tools.map((tool) => ({
    ...tool,
    function: { ...tool.function, strict },
  }));
}

function parseContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (!isRecord(part)) return '';
    if (typeof part.text === 'string') return part.text;
    return '';
  }).join('');
}

export async function createChatCompletion(
  config: ProviderRuntimeConfig,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  await waitForProviderRequestSlot(request.signal);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: request.messages,
    max_tokens: request.maxTokens,
    stream: false,
    ...reasoningBody(config),
    ...(request.responseSchema ? {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName ?? 'ocr_result',
          strict: usesOptionalPropertyStrictDialect(config),
          schema: request.responseSchema,
        },
      },
    } : {}),
    ...(request.tools?.length ? {
      tools: compatibleTools(config, request.tools),
      tool_choice: request.toolChoice ?? 'auto',
      parallel_tool_calls: false,
    } : {}),
    ...(request.extraBody ?? {}),
  };
  const response = await fetch(endpoint(config.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: requestHeaders(config),
    body: JSON.stringify(body),
    signal: request.signal,
  });
  if (!response.ok) throw await responseError(response);
  const parsed = await response.json() as unknown;
  if (!isRecord(parsed)) throw new ProviderApiError('Provider returned a non-object response');
  recordProviderUsage(parsed, config);
  const choices: unknown[] = Array.isArray(parsed.choices) ? parsed.choices : [];
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new ProviderApiError('Provider returned no assistant message');
  }
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    throw new ProviderApiError('Provider response reached the output token limit and is incomplete');
  }
  if (finishReason === 'content_filter') {
    throw new ProviderApiError('Provider response was blocked by a content filter');
  }
  const rawMessage = choice.message;
  const toolCalls = Array.isArray(rawMessage.tool_calls)
    ? rawMessage.tool_calls.filter(isRecord).map((entry): OpenAIToolCall => {
        const functionValue = isRecord(entry.function) ? entry.function : {};
        return {
          id: typeof entry.id === 'string'
            ? entry.id
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
          type: 'function',
          function: {
            name: typeof functionValue.name === 'string' ? functionValue.name : '',
            arguments: typeof functionValue.arguments === 'string' ? functionValue.arguments : '{}',
          },
        };
      }).filter((entry) => Boolean(entry.function.name))
    : undefined;
  const text = parseContent(rawMessage.content);
  const message: OpenAIMessage = {
    role: 'assistant',
    content: text || null,
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    ...(typeof rawMessage.reasoning_content === 'string'
      ? { reasoning_content: rawMessage.reasoning_content }
      : {}),
    ...(typeof rawMessage.reasoning === 'string' ? { reasoning: rawMessage.reasoning } : {}),
    ...(Array.isArray(rawMessage.reasoning_details)
      ? { reasoning_details: rawMessage.reasoning_details }
      : {}),
  };
  if (!text && !toolCalls?.length) throw new ProviderApiError('Provider returned an empty response');
  return { text, message, finishReason, raw: parsed };
}

async function parseFileContentResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return response.text();
  const value = await response.json() as unknown;
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    for (const key of ['content', 'text', 'file_content']) {
      if (typeof value[key] === 'string') return value[key];
    }
  }
  throw new ProviderApiError('Kimi file extraction returned no text content');
}

/** Upload a PDF through Kimi's file-extract API and return its extracted text. */
export async function extractKimiFileContent(
  config: ProviderRuntimeConfig,
  dataUrl: string,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  const form = new FormData();
  form.append('purpose', 'file-extract');
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  await waitForProviderRequestSlot(signal);
  const upload = await fetch(endpoint(config.baseUrl, 'files'), {
    method: 'POST',
    headers: requestHeaders(config, false),
    body: form,
    signal,
  });
  if (!upload.ok) throw await responseError(upload);
  const uploaded = await upload.json() as unknown;
  if (!isRecord(uploaded) || typeof uploaded.id !== 'string') {
    throw new ProviderApiError('Kimi file upload returned no file ID');
  }
  const fileId = uploaded.id;
  try {
    await waitForProviderRequestSlot(signal);
    const content = await fetch(endpoint(config.baseUrl, `files/${encodeURIComponent(fileId)}/content`), {
      headers: requestHeaders(config, false),
      signal,
    });
    if (!content.ok) throw await responseError(content);
    return await parseFileContentResponse(content);
  } finally {
    try {
      await waitForProviderRequestSlot(signal);
      await fetch(endpoint(config.baseUrl, `files/${encodeURIComponent(fileId)}`), {
        method: 'DELETE',
        headers: requestHeaders(config, false),
        signal,
      });
    } catch {
      // The extraction result is still useful if best-effort remote cleanup fails.
    }
  }
}

export async function documentContentParts(
  config: ProviderRuntimeConfig,
  dataUrl: string,
  mimeType: string,
  filename: string,
  signal?: AbortSignal,
): Promise<OpenAIContentPart[]> {
  if (mimeType.startsWith('image/')) {
    return [{ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }];
  }
  if (mimeType === 'application/pdf') {
    if (config.provider === 'kimi') {
      const text = await extractKimiFileContent(config, dataUrl, filename, signal);
      return [{ type: 'text', text: `Extracted PDF content:\n\n${text}` }];
    }
    if (config.provider === 'openai-compatible') {
      throw new ProviderApiError(
        'This generic OpenAI-compatible profile cannot assume PDF support; use an image, OpenRouter, Kimi, Muse, or Gemini',
      );
    }
    return [{ type: 'file', file: { filename, file_data: dataUrl } }];
  }
  throw new ProviderApiError(`Unsupported document MIME type for ${config.provider}: ${mimeType}`);
}
