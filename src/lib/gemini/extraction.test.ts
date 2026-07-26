import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetClient } = vi.hoisted(() => ({ mockGetClient: vi.fn() }));

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, getGenAIClient: mockGetClient };
});

import { extractStructuredDataFromFile, extractTextFromFile } from './extraction';
import { getGeminiUsage, resetGeminiUsage } from './usage';

const FILE_DATA = 'data:image/png;base64,ZmFrZQ==';
const CLIENT = { apiKey: 'k', model: 'gemini-3.5-flash' as const };

function mockGenerate(response: unknown) {
  const generateContent = vi.fn().mockResolvedValue(response);
  mockGetClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

describe('extractTextFromFile — output contract', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    resetGeminiUsage();
  });
  afterEach(() => vi.restoreAllMocks());

  it('H-01: outputFormat=json (without structuredOutput) prompts JSON and requests application/json', async () => {
    const generateContent = mockGenerate({
      text: '{"title":"T","sections":[]}',
      candidates: [{ finishReason: 'STOP' }],
    });

    await extractTextFromFile(FILE_DATA, 'image/png', CLIENT, undefined, { outputFormat: 'json' });

    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.5-flash');
    const promptText = call.contents[0].parts[0].text as string;
    expect(promptText).toMatch(/structured JSON/i);
    expect(promptText).not.toMatch(/clean markdown/i);
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.responseJsonSchema).toEqual(expect.objectContaining({
      type: 'object',
      required: ['sections'],
    }));
  });

  it('H-02: invalid JSON throws when JSON was requested (no silent Markdown downgrade)', async () => {
    mockGenerate({ text: 'this is not json', candidates: [{ finishReason: 'STOP' }] });
    await expect(
      extractTextFromFile(FILE_DATA, 'image/png', CLIENT, undefined, { structuredOutput: true }),
    ).rejects.toThrow(/invalid JSON/i);
  });

  it('parses valid JSON when requested', async () => {
    mockGenerate({
      text: '{"title":"Invoice","sections":[{"heading":"H","content":["line"]}]}',
      candidates: [{ finishReason: 'STOP' }],
    });
    const result = await extractTextFromFile(FILE_DATA, 'image/png', CLIENT, undefined, { structuredOutput: true });
    expect(result.title).toBe('Invoice');
    expect(result.sections[0].content).toEqual(['line']);
  });

  it.each([
    ['a primitive', '42'],
    ['a missing required sections property', '{"title":"Invoice"}'],
    ['a malformed nested section', '{"sections":[{"content":"not-an-array"}]}'],
    ['an undeclared property', '{"sections":[],"surprise":true}'],
  ])('rejects schema-invalid JSON: %s', async (_description, text) => {
    mockGenerate({ text, candidates: [{ finishReason: 'STOP' }] });
    await expect(
      extractTextFromFile(FILE_DATA, 'image/png', CLIENT, undefined, { structuredOutput: true }),
    ).rejects.toThrow(/did not match the OCR schema/i);
  });

  it('extracts JSON with a caller-provided schema', async () => {
    const generateContent = mockGenerate({
      text: '{"invoice_number":"INV-42","total":12.5}',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        totalTokenCount: 120,
      },
    });
    const schema = {
      type: 'object',
      properties: {
        invoice_number: { type: 'string' },
        total: { type: 'number' },
      },
      required: ['invoice_number', 'total'],
    };

    const result = await extractStructuredDataFromFile(FILE_DATA, 'image/png', CLIENT, schema);

    expect(result).toEqual({ invoice_number: 'INV-42', total: 12.5 });
    const call = generateContent.mock.calls[0][0];
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.responseJsonSchema).toEqual(schema);
    expect(getGeminiUsage().estimatedCostUsd).toBeGreaterThan(0);
  });

  describe('extractStructuredDataFromFile — schema rejections', () => {
    /** Live Gemini shape: `ApiError` with numeric `status` and the body as `message`. */
    function mockReject(status: number, body: string) {
      const generateContent = vi.fn().mockRejectedValue(Object.assign(
        new Error(body),
        { name: 'ApiError', status },
      ));
      mockGetClient.mockReturnValue({ models: { generateContent } });
    }

    /** Grammar cost 500 x 4 properties, well over the documented budget. */
    const OVER_BUDGET = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          maxItems: 500,
          items: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' }, d: { type: 'string' } },
            required: ['a', 'b', 'c', 'd'],
            additionalProperties: false,
          },
        },
      },
      required: ['rows'],
      additionalProperties: false,
    };
    const CLEAN_SCHEMA = {
      type: 'object',
      properties: { total: { type: 'number' } },
      required: ['total'],
      additionalProperties: false,
    };
    const BARE_INVALID_ARGUMENT = '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}';

    it('names the offending construct when a bare 400 meets an unsupported schema', async () => {
      // Constrained decoding rejects an over-budget grammar with a body that
      // names nothing, so the static check is the only thing that can say why.
      mockReject(400, BARE_INVALID_ARGUMENT);
      await expect(extractStructuredDataFromFile(FILE_DATA, 'image/png', CLIENT, OVER_BUDGET))
        .rejects.toThrow(/^Invalid JSON Schema for structured output: .*maxItems.*grammar cost of 2000/su);
    });

    it('leaves the rejection unexplained when the schema clears the static check', async () => {
      // No evidence to offer, so the provider's own sentence stands rather than
      // the schema being blamed on suspicion.
      mockReject(400, BARE_INVALID_ARGUMENT);
      await expect(extractStructuredDataFromFile(FILE_DATA, 'image/png', CLIENT, CLEAN_SCHEMA))
        .rejects.toThrow('Request contains an invalid argument. [INVALID_ARGUMENT]');
    });

    it('restates a raw JSON body as prose for direct callers', async () => {
      mockReject(401, '{"error":{"code":401,"message":"API key not valid. Please pass a valid API key.","status":"UNAUTHENTICATED"}}');
      await expect(extractStructuredDataFromFile(FILE_DATA, 'image/png', CLIENT, CLEAN_SCHEMA))
        .rejects.toThrow('API key not valid. Please pass a valid API key. [UNAUTHENTICATED]');
    });

    it('does not blame the schema when the provider blamed the document', async () => {
      mockReject(400, '{"error":{"code":400,"message":"Unable to process input image. Please retry.","status":"INVALID_ARGUMENT"}}');
      await expect(extractStructuredDataFromFile(FILE_DATA, 'image/png', CLIENT, OVER_BUDGET))
        .rejects.toThrow(/Unable to process input image/u);
    });

    it('does not blame the schema for a transient server failure', async () => {
      mockReject(503, '{"error":{"code":503,"message":"The model is overloaded.","status":"UNAVAILABLE"}}');
      await expect(extractStructuredDataFromFile(FILE_DATA, 'image/png', CLIENT, OVER_BUDGET))
        .rejects.toThrow(/overloaded/u);
    });
  });

  it('G-02: a safety-blocked response throws instead of returning empty', async () => {
    mockGenerate({ text: '', promptFeedback: { blockReason: 'SAFETY' } });
    await expect(extractTextFromFile(FILE_DATA, 'image/png', CLIENT)).rejects.toThrow(/blocked/i);
  });

  it('G-02: an empty response throws', async () => {
    mockGenerate({ text: '', candidates: [{ finishReason: 'STOP' }] });
    await expect(extractTextFromFile(FILE_DATA, 'image/png', CLIENT)).rejects.toThrow(/empty/i);
  });

  it('rejects plausible-looking output when generation stops at MAX_TOKENS', async () => {
    mockGenerate({
      text: '# Partial document\nThis looks usable but is truncated.',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });
    await expect(extractTextFromFile(FILE_DATA, 'image/png', CLIENT)).rejects.toThrow(/incomplete output/i);
  });

  it('H-03: with streaming callbacks, a failure rejects AND notifies onError (never empty success)', async () => {
    const generateContentStream = vi.fn().mockRejectedValue(new Error('network down'));
    mockGetClient.mockReturnValue({ models: { generateContentStream } });
    const onError = vi.fn();
    const onComplete = vi.fn();

    await expect(
      extractTextFromFile(FILE_DATA, 'image/png', CLIENT, undefined, undefined, { onError, onComplete }),
    ).rejects.toThrow(/network down/);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('records usage metadata from the final streaming chunk', async () => {
    async function* chunks() {
      await Promise.resolve();
      yield { text: '{"title":"T",' };
      yield {
        text: '"sections":[]}',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };
    }
    const generateContentStream = vi.fn().mockResolvedValue(chunks());
    mockGetClient.mockReturnValue({ models: { generateContentStream } });

    await extractTextFromFile(
      FILE_DATA,
      'image/png',
      CLIENT,
      undefined,
      { structuredOutput: true },
      { onProgress: vi.fn() },
    );

    expect(getGeminiUsage()).toEqual(expect.objectContaining({
      requests: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    }));
  });

  it('rejects a streaming result whose final chunk reports MAX_TOKENS', async () => {
    async function* chunks() {
      yield { text: '# Partial document' };
      yield { text: '\ntruncated', candidates: [{ finishReason: 'MAX_TOKENS' }] };
    }
    mockGetClient.mockReturnValue({
      models: { generateContentStream: vi.fn().mockResolvedValue(chunks()) },
    });

    await expect(extractTextFromFile(
      FILE_DATA,
      'image/png',
      CLIENT,
      undefined,
      undefined,
      { onProgress: vi.fn() },
    )).rejects.toThrow(/incomplete output/i);
  });

  it('rejects a streaming result that ends without a terminal finish reason', async () => {
    async function* chunks() {
      yield { text: '# Possibly truncated', candidates: [{}] };
    }
    mockGetClient.mockReturnValue({
      models: { generateContentStream: vi.fn().mockResolvedValue(chunks()) },
    });

    await expect(extractTextFromFile(
      FILE_DATA,
      'image/png',
      CLIENT,
      undefined,
      undefined,
      { onProgress: vi.fn() },
    )).rejects.toThrow(/without a terminal STOP/i);
  });
});
