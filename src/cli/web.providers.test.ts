import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedCliOptions } from './types';

const mocks = vi.hoisted(() => ({ secureFetch: vi.fn() }));

vi.mock('./secureFetch', () => ({ secureFetchPublicUrl: mocks.secureFetch }));

import { runWebExtraction } from './web';

function options(): ResolvedCliOptions {
  return {
    provider: 'openrouter',
    gateway: 'direct',
    apiKey: 'secret',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    model: 'moonshotai/kimi-k2.6',
    baseUrl: 'https://openrouter.ai/api/v1',
    cloudflareByok: false,
    thinking: 'MEDIUM',
    includeThoughts: false,
    mode: 'simple',
    format: 'markdown',
    concurrency: 2,
    retries: 0,
    timeoutSeconds: 120,
    maxFiles: 20,
    maxTotalMb: 100,
    excludes: [],
    instructions: [],
    hidden: false,
    resume: true,
    overwrite: false,
    forceUnlock: false,
    failFast: false,
    jsonl: false,
    dryRun: false,
    quiet: false,
    verbose: false,
    stdinName: 'stdin',
    detectImages: false,
    detectMath: false,
    maxTokens: 32768,
    maxIterations: 5,
    confidenceThreshold: 0.85,
    requestsPerMinute: 0,
    cwd: '/workspace',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.secureFetch.mockReset();
});

describe('compatible-provider Web OCR', () => {
  it('combines HTML, image, and PDF sources in one grounded provider request', async () => {
    const urls = [
      'https://example.com/article',
      'https://example.com/chart.png',
      'https://example.com/report.pdf',
    ];
    mocks.secureFetch
      .mockResolvedValueOnce({
        url: urls[0],
        contentType: 'text/html',
        bytes: new TextEncoder().encode('<main><h1>Market &amp; Sales</h1><p>Revenue: 42</p></main>'),
      })
      .mockResolvedValueOnce({
        url: urls[1],
        contentType: 'image/png',
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      })
      .mockResolvedValueOnce({
        url: urls[2],
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.7'),
      });
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ results: urls.map((url) => ({ url, type: 'unknown', content: 'ok' })) }) },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runWebExtraction(urls, 'individual', options(), new AbortController().signal);

    expect(result.results).toHaveLength(3);
    const init = fetchMock.mock.calls[0]?.[1];
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('MARKET & SALES');
    expect(serialized).toContain('image_url');
    expect(serialized).toContain('file_data');
    expect(body.plugins).toEqual([{ id: 'file-parser' }]);
  });
});
