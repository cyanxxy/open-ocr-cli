import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetClient } = vi.hoisted(() => ({ mockGetClient: vi.fn() }));

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, getGenAIClient: mockGetClient };
});

import { extractTextFromFile } from './extraction';
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

  it('G-02: a safety-blocked response throws instead of returning empty', async () => {
    mockGenerate({ text: '', promptFeedback: { blockReason: 'SAFETY' } });
    await expect(extractTextFromFile(FILE_DATA, 'image/png', CLIENT)).rejects.toThrow(/blocked/i);
  });

  it('G-02: an empty response throws', async () => {
    mockGenerate({ text: '', candidates: [{ finishReason: 'STOP' }] });
    await expect(extractTextFromFile(FILE_DATA, 'image/png', CLIENT)).rejects.toThrow(/empty/i);
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
});
