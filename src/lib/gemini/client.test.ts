import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent, mockGenerateContentStream } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateContentStream: vi.fn(),
}));

vi.mock('@google/genai', () => ({
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
  isGemini3Model,
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

  it('returns an empty string when the response has no text', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: undefined, candidates: undefined });

    const model = getModelClient('model-test-key');
    const result = await model.generateContent({ contents: 'hello' });

    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-3.5-flash',
      contents: 'hello',
    });
    expect(result.response.text()).toBe('');
    expect(result.response.candidates).toEqual([]);
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

describe('applyThinkingConfig', () => {
  it('defaults thinking by model family when no config is provided', () => {
    expect(applyThinkingConfig({}, 'gemini-3.1-pro-preview').thinkingConfig).toEqual({
      thinkingLevel: 'high',
    });
    expect(applyThinkingConfig({}, 'gemini-3.5-flash').thinkingConfig).toEqual({
      thinkingLevel: 'medium',
    });
    expect(applyThinkingConfig({}, 'gemini-3.1-flash-lite').thinkingConfig).toEqual({
      thinkingLevel: 'minimal',
    });
  });

  it('lowercases the configured level and preserves the base config', () => {
    const result = applyThinkingConfig(
      { temperature: 0.2 },
      'gemini-3-flash-preview',
      { level: 'MEDIUM', includeThoughts: true },
    );
    expect(result).toEqual({
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true },
    });
  });

  it('allows minimal on Flash models but falls back to high on Pro', () => {
    const flash = applyThinkingConfig({}, 'gemini-3.5-flash', { level: 'MINIMAL' });
    expect(flash.thinkingConfig.thinkingLevel).toBe('minimal');

    const lite = applyThinkingConfig({}, 'gemini-3.1-flash-lite', { level: 'MINIMAL' });
    expect(lite.thinkingConfig.thinkingLevel).toBe('minimal');

    const pro = applyThinkingConfig({}, 'gemini-3.1-pro-preview', { level: 'MINIMAL' });
    expect(pro.thinkingConfig.thinkingLevel).toBe('high');
  });
});
