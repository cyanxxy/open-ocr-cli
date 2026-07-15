import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetProviderRequestPolicy } from './requestPolicy';
import { createChatCompletion } from './openaiCompatible';
import type { ProviderRuntimeConfig } from './types';
import { getProviderUsage, resetProviderUsage } from './usage';

function config(overrides: Partial<ProviderRuntimeConfig> = {}): ProviderRuntimeConfig {
  return {
    provider: 'kimi',
    gateway: 'direct',
    apiKey: 'secret',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    model: 'kimi-k2.6',
    baseUrl: 'https://api.moonshot.ai/v1',
    thinkingConfig: { level: 'HIGH', includeThoughts: true },
    ...overrides,
  };
}

beforeEach(() => {
  resetProviderUsage();
  resetProviderRequestPolicy();
});

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible transport', () => {
  it('preserves Kimi reasoning content and records OpenAI usage', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'done', reasoning_content: 'checked the fields' },
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createChatCompletion(config(), {
      messages: [{ role: 'user', content: 'Extract this' }],
      maxTokens: 1000,
    });

    expect(result.message.reasoning_content).toBe('checked the fields');
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer secret');
    if (typeof request.body !== 'string') throw new Error('Expected a string request body');
    expect(JSON.parse(request.body) as unknown).toMatchObject({
      model: 'kimi-k2.6',
      thinking: { type: 'enabled', keep: 'all' },
    });
    expect(getProviderUsage()).toMatchObject({
      requests: 1,
      inputTokens: 100,
      outputTokens: 20,
      thoughtTokens: 5,
      totalTokens: 120,
    });
  });

  it('uses Cloudflare gateway authentication and omits provider auth in BYOK mode', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);

    await createChatCompletion(config({
      provider: 'openrouter',
      gateway: 'cloudflare',
      model: 'moonshotai/kimi-k2.6',
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/a/g/openrouter',
      gatewayToken: 'gateway-secret',
      cloudflareByok: true,
      cloudflareByokAlias: 'router-key',
    }), {
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 8,
    });

    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cf-aig-authorization')).toBe('Bearer gateway-secret');
    expect(headers.get('cf-aig-byok-alias')).toBe('router-key');
  });

  it('uses the current OpenRouter reasoning shape and preserves reasoning details', async () => {
    const reasoningDetails = [{ type: 'reasoning.text', text: 'inspect totals', id: 'reason-1' }];
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          reasoning: 'inspect totals',
          reasoning_details: reasoningDetails,
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'extract_fields_batch', arguments: '{"fields":[]}' },
          }],
        },
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createChatCompletion(config({
      provider: 'openrouter',
      model: 'moonshotai/kimi-k2.6',
      baseUrl: 'https://openrouter.ai/api/v1',
      thinkingConfig: { level: 'HIGH', includeThoughts: true },
    }), {
      messages: [{ role: 'user', content: 'Extract this' }],
      maxTokens: 1000,
    });

    expect(result.message).toMatchObject({
      reasoning: 'inspect totals',
      reasoning_details: reasoningDetails,
    });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    if (typeof request.body !== 'string') throw new Error('Expected a string request body');
    expect(JSON.parse(request.body) as unknown).toMatchObject({
      reasoning: { effort: 'high', exclude: false },
    });
    expect(new Headers(request.headers).get('http-referer')).toBe('https://github.com/cyanxxy/gemini-ocr');
    expect(getProviderUsage().estimatedCostUsd).toBe(0);
  });

  it('uses non-strict schema hints on OpenAI-style routes that reject optional strict properties', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
      const body = JSON.parse(init.body) as {
        response_format?: { json_schema?: { strict?: boolean } };
        tools?: Array<{ function?: { strict?: boolean } }>;
      };
      const invalidStrictRequest = body.response_format?.json_schema?.strict === true
        || body.tools?.some((tool) => tool.function?.strict === true);
      if (invalidStrictRequest) {
        return Promise.resolve(new Response(JSON.stringify({
          error: { message: 'Invalid schema for strict response format: optional properties are unsupported' },
        }), { status: 400, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"value":"ok"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(createChatCompletion(config({
      provider: 'openrouter',
      model: 'vendor/strict-validator',
      baseUrl: 'https://openrouter.ai/api/v1',
    }), {
      messages: [{ role: 'user', content: 'Extract this' }],
      maxTokens: 100,
      responseSchema: {
        type: 'object',
        properties: { value: { type: 'string' }, optional_note: { type: 'string' } },
        required: ['value'],
      },
      tools: [{
        type: 'function',
        function: {
          name: 'inspect',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' }, optional_note: { type: 'string' } },
            required: ['value'],
          },
        },
      }],
    })).resolves.toMatchObject({ text: '{"value":"ok"}' });

    const init = fetchMock.mock.calls[0]?.[1];
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(init.body) as unknown).toMatchObject({
      response_format: { json_schema: { strict: false } },
      tools: [{ function: { strict: false } }],
    });
  });

  it('keeps Kimi MFJS schemas strict while wiring Muse reasoning effort', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);

    await createChatCompletion(config(), {
      messages: [{ role: 'user', content: 'Extract' }],
      maxTokens: 100,
      responseSchema: { type: 'object', properties: { optional_note: { type: 'string' } } },
    });
    await createChatCompletion(config({
      provider: 'muse',
      apiKeyEnv: 'META_API_KEY',
      model: 'muse-spark-1.1',
      baseUrl: 'https://api.meta.ai/v1',
      thinkingConfig: { level: 'HIGH', includeThoughts: true },
    }), {
      messages: [{ role: 'user', content: 'Extract' }],
      maxTokens: 100,
    });

    const kimiInit = fetchMock.mock.calls[0]?.[1];
    const museInit = fetchMock.mock.calls[1]?.[1];
    if (typeof kimiInit?.body !== 'string' || typeof museInit?.body !== 'string') {
      throw new Error('Expected JSON request bodies');
    }
    expect(JSON.parse(kimiInit.body) as unknown).toMatchObject({
      response_format: { json_schema: { strict: true } },
    });
    expect(JSON.parse(museInit.body) as unknown).toMatchObject({ reasoning_effort: 'high' });
  });
});
