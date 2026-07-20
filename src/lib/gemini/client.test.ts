import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent, mockGenerateContentStream } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateContentStream: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  ThinkingLevel: {
    MINIMAL: 'MINIMAL',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
  },
  GoogleGenAI: vi.fn(function (this: { models: Record<string, unknown> }) {
    this.models = {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    };
  }),
}));

import { GoogleGenAI } from '@google/genai';
import {
  applyThinkingConfig,
  getGenAIClient,
  getModelClient,
  isFatalGeminiError,
  isGemini3Model,
  isRetryableGeminiError,
} from './client';
import { OcrError, OcrErrorType } from './types';

const MockedGoogleGenAI = vi.mocked(GoogleGenAI);

describe('getGenAIClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws an OcrError when the API key is missing', () => {
    expect(() => getGenAIClient('')).toThrow(OcrError);
    try {
      getGenAIClient('');
    } catch (error) {
      expect((error as OcrError).type).toBe(OcrErrorType.API_KEY_MISSING);
    }
  });

  it('caches clients per API key', () => {
    const first = getGenAIClient('cache-test-key');
    const second = getGenAIClient('cache-test-key');
    expect(second).toBe(first);
    expect(MockedGoogleGenAI).toHaveBeenCalledTimes(1);
  });
});

describe('getModelClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates content from a prompt and maps maxTokens to maxOutputTokens', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'extracted text',
      candidates: [{ index: 0, finishReason: 'STOP' }],
    });

    const model = getModelClient('model-test-key', 'gemini-3-flash-preview');
    const result = await model.generateContent({
      prompt: 'Read this document',
      generationConfig: { temperature: 0.1, maxTokens: 2048 },
      safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }],
    });

    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-3-flash-preview',
      contents: 'Read this document',
      config: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }],
      },
    });
    expect(result.response.text()).toBe('extracted text');
    expect(result.response.candidates).toEqual([{ index: 0, finishReason: 'STOP' }]);
  });

  it('rejects a response with no candidate instead of returning an empty success', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: undefined, candidates: undefined });

    const model = getModelClient('model-test-key');
    await expect(model.generateContent({ contents: 'hello' })).rejects.toThrow(/no candidate/i);

    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-3.5-flash',
      contents: 'hello',
    });
  });

  it('streams chunks that expose their text', async () => {
    async function* fakeSdkStream() {
      yield { text: 'first ', candidates: [{}] };
      yield { text: 'second', candidates: [{ finishReason: 'STOP' }] };
      yield { text: undefined, usageMetadata: { totalTokenCount: 3 } };
    }
    mockGenerateContentStream.mockResolvedValueOnce(fakeSdkStream());

    const model = getModelClient('model-test-key', 'gemini-3-flash-preview');
    const { stream } = await model.generateContentStream({
      prompt: 'stream this',
      generationConfig: { maxOutputTokens: 1024 },
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk.text());
    }

    expect(chunks).toEqual(['first ', 'second', '']);
    expect(mockGenerateContentStream).toHaveBeenCalledWith({
      model: 'gemini-3-flash-preview',
      contents: 'stream this',
      config: { maxOutputTokens: 1024 },
    });
  });

  it('rejects a wrapped stream that reaches MAX_TOKENS', async () => {
    async function* fakeSdkStream() {
      yield { text: 'partial', candidates: [{}] };
      yield { text: ' truncated', candidates: [{ finishReason: 'MAX_TOKENS' }] };
    }
    mockGenerateContentStream.mockResolvedValueOnce(fakeSdkStream());
    const model = getModelClient('model-test-key');
    const { stream } = await model.generateContentStream({ prompt: 'stream this' });

    const consume = async (): Promise<void> => {
      for await (const chunk of stream) chunk.text();
    };
    await expect(consume()).rejects.toThrow(/incomplete output/i);
  });

  it('rejects a wrapped stream that ends without terminal STOP', async () => {
    async function* fakeSdkStream() {
      yield { text: 'possibly truncated', candidates: [{}] };
    }
    mockGenerateContentStream.mockResolvedValueOnce(fakeSdkStream());
    const model = getModelClient('model-test-key');
    const { stream } = await model.generateContentStream({ prompt: 'stream this' });

    const consume = async (): Promise<void> => {
      for await (const chunk of stream) chunk.text();
    };
    await expect(consume()).rejects.toThrow(/without a terminal STOP/i);
  });
});

describe('isGemini3Model', () => {
  it('recognizes Gemini 3 models', () => {
    expect(isGemini3Model('gemini-3.1-pro-preview')).toBe(true);
    expect(isGemini3Model('gemini-3-flash-preview')).toBe(true);
    expect(isGemini3Model('gemini-3.5-flash')).toBe(true);
    expect(isGemini3Model('gemini-3.1-flash-lite')).toBe(true);
  });
});

describe('Gemini error classification', () => {
  it('uses structured status before misleading message prose', () => {
    const transient = Object.assign(new Error('API key service unavailable'), { status: 503 });
    expect(isFatalGeminiError(transient)).toBe(false);
    expect(isRetryableGeminiError(transient)).toBe(true);

    const invalid = Object.assign(new Error('request rejected'), { status: 401 });
    expect(isFatalGeminiError(invalid)).toBe(true);
    expect(isRetryableGeminiError(invalid)).toBe(false);
  });

  it('recognizes current structured RPC error codes through wrapper causes', () => {
    const exhausted = new Error('provider request failed', {
      cause: Object.assign(new Error('busy'), { code: 'RESOURCE_EXHAUSTED' }),
    });
    const denied = Object.assign(new Error('request rejected'), { code: 'PERMISSION_DENIED' });
    expect(isRetryableGeminiError(exhausted)).toBe(true);
    expect(isFatalGeminiError(denied)).toBe(true);
  });

  it('treats a credential-specific Gemini HTTP 400 as fatal without classifying every 400 that way', () => {
    expect(isFatalGeminiError(Object.assign(
      new Error('API key not valid. Please pass a valid API key.'),
      { status: 400 },
    ))).toBe(true);
    expect(isFatalGeminiError(Object.assign(
      new Error('Invalid request parameter'),
      { status: 400 },
    ))).toBe(false);
  });
});

describe('applyThinkingConfig', () => {
  it('defaults thinking by model family when no config is provided', () => {
    expect(applyThinkingConfig({}, 'gemini-3.1-pro-preview').thinkingConfig).toEqual({
      thinkingLevel: 'HIGH',
    });
    expect(applyThinkingConfig({}, 'gemini-3.5-flash').thinkingConfig).toEqual({
      thinkingLevel: 'MEDIUM',
    });
    expect(applyThinkingConfig({}, 'gemini-3.1-flash-lite').thinkingConfig).toEqual({
      thinkingLevel: 'MINIMAL',
    });
  });

  it('uses the SDK thinking enum and preserves the base config', () => {
    const result = applyThinkingConfig(
      { temperature: 0.2 },
      'gemini-3-flash-preview',
      { level: 'MEDIUM', includeThoughts: true },
    );
    expect(result).toEqual({
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: 'MEDIUM', includeThoughts: true },
    });
  });

  it('allows minimal on Flash models but rejects it on Pro instead of silently upgrading it', () => {
    const flash = applyThinkingConfig({}, 'gemini-3.5-flash', { level: 'MINIMAL' });
    expect(flash.thinkingConfig.thinkingLevel).toBe('MINIMAL');

    const lite = applyThinkingConfig({}, 'gemini-3.1-flash-lite', { level: 'MINIMAL' });
    expect(lite.thinkingConfig.thinkingLevel).toBe('MINIMAL');

    expect(() => applyThinkingConfig(
      {},
      'gemini-3.1-pro-preview',
      { level: 'MINIMAL' },
    )).toThrow('gemini-3.1-pro-preview supports thinking levels low, medium, high');
  });
});
