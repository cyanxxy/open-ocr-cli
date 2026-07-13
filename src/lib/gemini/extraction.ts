/**
 * Text and structured data extraction operations using Gemini AI
 * This module contains the main extraction functions moved from the monolithic gemini.ts
 */

import { logger } from '../logger';
import { applyThinkingConfig, generateContentMediaResolution, getGenAIClient } from './client';
import type {
  ExtractedContent,
  StreamingCallbacks,
  ExtractionOptions,
  ExtractionInstruction,
  GeminiModel,
  GeminiClientConfig,
  JsonValue,
  ThinkingConfig
} from './types';
import { recordGeminiUsage } from './usage';
import { waitForGeminiRequestSlot } from './requestPolicy';

/**
 * Helper function to process markdown text into ExtractedContent structure
 */
function processMarkdownIntoExtractedContent(
  text: string
): ExtractedContent {
  const lines = text.split('\n');
  const sections: ExtractedContent['sections'] = [];
  let currentSection: { heading?: string; content: string[] } = { content: [] };
  let title: string | undefined;
  let inCodeFence = false;
  let codeFenceMarker: string | null = null;

  const trimTrailingBlankLines = (content: string[]) => {
    let endIndex = content.length;
    while (endIndex > 0 && content[endIndex - 1].trim() === '') {
      endIndex -= 1;
    }
    return content.slice(0, endIndex);
  };

  const commitSection = () => {
    const cleanedContent = trimTrailingBlankLines(currentSection.content);
    const hasContent = cleanedContent.some((line) => line.trim() !== '');
    if (currentSection.heading || hasContent) {
      sections.push({
        heading: currentSection.heading,
        content: cleanedContent,
      });
    }
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    const fenceMatch = trimmedLine.match(/^(```|~~~)/);

    if (fenceMatch) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = fenceMatch[1];
      } else if (codeFenceMarker && trimmedLine.startsWith(codeFenceMarker)) {
        inCodeFence = false;
        codeFenceMarker = null;
      }
      currentSection.content.push(line);
      continue;
    }

    if (!inCodeFence) {
      const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();

        if (
          level === 1 &&
          !title &&
          sections.length === 0 &&
          currentSection.content.every((contentLine) => contentLine.trim() === '')
        ) {
          title = headingText;
          continue;
        }

        commitSection();
        currentSection = {
          heading: headingText,
          content: []
        };
        continue;
      }
    }

    currentSection.content.push(line);
  }
  
  // Don't forget the last section
  commitSection();

  return { title, sections };
}

/** Extract a document directly into a caller-provided JSON Schema contract. */
export async function extractStructuredDataFromFile(
  fileData: string,
  mimeType: string,
  clientConfig: GeminiClientConfig,
  responseJsonSchema: Record<string, unknown>,
  instructions?: ExtractionInstruction[],
  options?: Pick<ExtractionOptions, 'abortSignal' | 'maxTokens' | 'detectImages' | 'detectMathEquations'>,
): Promise<JsonValue> {
  const { apiKey, model, thinkingConfig } = clientConfig;
  if (!apiKey) throw new Error('Please configure your Gemini API key in settings');

  const prompt = [
    'Extract the document into the exact JSON structure described by the response schema.',
    'Use only information visible in the document. Do not invent missing values.',
    'Return JSON only, without Markdown fences or commentary.',
    ...(instructions?.map((instruction) => instruction.prompt) ?? []),
    ...(options?.detectImages ? ['Include relevant information visible in charts, diagrams, or images.'] : []),
    ...(options?.detectMathEquations ? ['Represent mathematical expressions accurately.'] : []),
  ].join(' ');
  const base64Data = fileData.split(',')[1] || fileData;
  let generationConfig: Record<string, unknown> = {
    maxOutputTokens: options?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    responseJsonSchema,
    mediaResolution: generateContentMediaResolution(mimeType),
  };
  if (options?.abortSignal) generationConfig.abortSignal = options.abortSignal;
  generationConfig = applyThinkingConfig(generationConfig, model, thinkingConfig);

  const genAI = getGenAIClient(apiKey);
  await waitForGeminiRequestSlot(options?.abortSignal);
  const response = await genAI.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64Data } },
      ],
    }],
    config: generationConfig,
  });
  recordGeminiUsage(response, model);
  assertUsableResponse(response);
  const text = response.text?.trim() ?? '';
  if (!text) throw new Error('Schema extraction returned an empty response');
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new Error('Schema extraction returned invalid JSON');
  }
}

/**
 * Single source of truth for whether a JSON contract was requested. Both the
 * prompt and the generation config must agree on this — the previous code asked
 * for Markdown in the prompt while requesting `application/json` in the config
 * whenever `outputFormat: 'json'` was set without `structuredOutput` (audit H-01).
 */
function wantsJsonOutput(options?: ExtractionOptions): boolean {
  return options?.structuredOutput === true || options?.outputFormat === 'json';
}

/** Default output-token ceiling. Generous enough for a dense page, but bounded
 * (the model max of 65536 masked runaway prompts and inflated worst-case cost —
 * audit G-03). Callers needing more pass `options.maxTokens` explicitly. */
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

const EXTRACTED_CONTENT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    title: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: {
          heading: { type: 'string' },
          content: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    content: { type: 'string' },
    headings: { type: 'array', items: { type: 'string' } },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['headers', 'rows', 'content'],
        properties: {
          headers: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          content: { type: 'string' },
        },
      },
    },
    code: { type: 'array', items: { type: 'string' } },
    lists: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'items'],
        properties: {
          type: { type: 'string', enum: ['ordered', 'unordered'] },
          items: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    markdown: { type: 'string' },
  },
};

/**
 * Build generation configuration for Gemini preview API calls
 */
function buildGenerationConfig(
  modelName: GeminiModel,
  options?: ExtractionOptions,
  thinkingConfig?: ThinkingConfig,
  mimeType?: string,
): Record<string, unknown> {
  // Gemini 3.x: omit temperature/topP/topK unless the caller overrides temperature.
  let config: Record<string, unknown> = {
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxOutputTokens: options?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };

  if (wantsJsonOutput(options)) {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = EXTRACTED_CONTENT_RESPONSE_SCHEMA;
  }

  if (options?.abortSignal) {
    config.abortSignal = options.abortSignal;
  }

  if (mimeType) {
    config.mediaResolution = generateContentMediaResolution(mimeType);
  }

  config = applyThinkingConfig(config, modelName, thinkingConfig);

  return config;
}

function parseExtractedContentFromJson(text: string): ExtractedContent | null {
  try {
    const parsed = JSON.parse(text) as Partial<ExtractedContent>;
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.map((section) => ({
          heading: section?.heading,
          content: Array.isArray(section?.content)
            ? section.content
            : typeof section?.content === 'string'
              ? [section.content]
              : []
        }))
      : [];

    return {
      title: parsed.title,
      sections,
      content: parsed.content,
      headings: parsed.headings,
      tables: parsed.tables,
      code: parsed.code,
      lists: parsed.lists,
      markdown: parsed.markdown
    };
  } catch {
    return null;
  }
}

/**
 * Reject responses that did not complete normally (safety block, recitation,
 * or an empty/malformed candidate) instead of silently treating them as a
 * successful empty extraction (audit G-02).
 */
function assertUsableResponse(response: {
  candidates?: Array<{ finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}): void {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Extraction was blocked by safety filters (${blockReason})`);
  }
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
    throw new Error(`Extraction did not complete normally (finishReason: ${finishReason})`);
  }
  if (finishReason === 'MAX_TOKENS') {
    logger.warn('Extraction hit the output token limit and may be truncated.');
  }
}

/**
 * Turn raw model output into an ExtractedContent according to the requested
 * contract. When JSON was explicitly requested, an unparseable response is a
 * contract violation that throws — it is never silently downgraded to Markdown
 * (audit H-02). An empty response always throws (audit G-02/H-03).
 */
function coerceExtractionResult(text: string, wantsJson: boolean): ExtractedContent {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Extraction returned an empty response');
  }
  if (wantsJson) {
    const parsed = parseExtractedContentFromJson(trimmed);
    if (!parsed) {
      throw new Error('Extraction requested JSON but the model returned invalid JSON');
    }
    return parsed;
  }
  return processMarkdownIntoExtractedContent(trimmed);
}

/**
 * Extracts text content from a given file (image or PDF).
 *
 * @param fileData - The base64 encoded string of the file.
 * @param mimeType - The MIME type of the file (e.g., 'image/png', 'application/pdf').
 * @param clientConfig - Configuration containing apiKey, model, and thinkingConfig.
 * @param instructions - Optional array of ExtractionInstruction to guide the AI.
 * @param options - Optional ExtractionOptions to customize extraction behavior.
 * @param callbacks - Optional StreamingCallbacks for handling streaming responses.
 * @returns A promise that resolves to an ExtractedContent object.
 * @throws Error if API key is missing or if there's an issue with file data or API communication.
 */
export async function extractTextFromFile(
  fileData: string,
  mimeType: string,
  clientConfig: GeminiClientConfig,
  instructions?: ExtractionInstruction[],
  options?: ExtractionOptions,
  callbacks?: StreamingCallbacks
): Promise<ExtractedContent> {
  try {
    const { apiKey, model, thinkingConfig } = clientConfig;
    
    if (!apiKey) {
      throw new Error('Please configure your Gemini API key in settings');
    }

    // Reuse the shared (single-entry) client rather than constructing a new
    // GoogleGenAI per call, so credential lifecycle/caching stays centralized
    // (audit H-18).
    const genAI = getGenAIClient(apiKey);
    const wantsJson = wantsJsonOutput(options);

    // Prepare the file data
    const base64Data = fileData.split(',')[1] || fileData;

    // Build the prompt. Explicit user instructions act as the extraction
    // directive; otherwise we fall back to the default "extract all text"
    // objective. Feature flags and the format directive are always appended so
    // they are never lost when custom instructions are supplied (audit G-04).
    const promptParts: string[] = [];
    if (instructions && instructions.length > 0) {
      promptParts.push(...instructions.map((inst) => inst.prompt));
    } else {
      promptParts.push('Extract all text content from this document.');
    }

    if (options?.handwritingStyle) {
      promptParts.push(`The document contains ${options.handwritingStyle} handwriting.`);
    }
    if (options?.detectImages) {
      promptParts.push('Detect and describe any images, charts, or diagrams.');
    }
    if (options?.detectMathEquations) {
      promptParts.push('Detect and format mathematical equations using LaTeX notation.');
    }
    if (options?.imageDetailLevel === 'detailed') {
      promptParts.push('Describe visual (non-text) elements in detail.');
    } else if (options?.imageDetailLevel === 'minimal') {
      promptParts.push('Keep descriptions of non-text visual elements brief.');
    }

    if (wantsJson) {
      promptParts.push('Output the result as structured JSON with title, sections, and content.');
    } else {
      promptParts.push('Format the output as clean markdown with proper headings and structure.');
    }

    const prompt = promptParts.join(' ');

    // Prepare contents for the API
    const contents = [{
      role: 'user' as const,
      parts: [
        { text: prompt },
        { 
          inlineData: {
            mimeType,
            data: base64Data
          }
        }
      ]
    }];

    const generationConfig = buildGenerationConfig(model, options, thinkingConfig, mimeType);

    // Handle streaming if callbacks are provided
    if (callbacks) {
      callbacks.onStart?.();
      await waitForGeminiRequestSlot(options?.abortSignal);
      const result = await genAI.models.generateContentStream({
        model,
        contents,
        config: generationConfig
      });

      let fullText = '';
      let lastChunk: {
        candidates?: Array<{ finishReason?: string }>;
        promptFeedback?: { blockReason?: string };
      } | null = null;
      for await (const chunk of result) {
        lastChunk = chunk as unknown as {
          candidates?: Array<{ finishReason?: string }>;
          promptFeedback?: { blockReason?: string };
        };
        const chunkText = chunk.text || '';
        fullText += chunkText;
        callbacks.onProgress?.(chunkText);
      }

      // Streaming does not always attach finish metadata on the final chunk;
      // still reject obvious safety blocks when present.
      if (lastChunk) {
        recordGeminiUsage(lastChunk, model);
        assertUsableResponse(lastChunk);
      }
      const finalContent = coerceExtractionResult(fullText, wantsJson);
      callbacks.onComplete?.(finalContent);
      return finalContent;

    } else {
      await waitForGeminiRequestSlot(options?.abortSignal);
      const response = await genAI.models.generateContent({
        model,
        contents,
        config: generationConfig
      });

      recordGeminiUsage(response, model);
      assertUsableResponse(response);
      return coerceExtractionResult(response.text || '', wantsJson);
    }

  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    logger.error('Text extraction failed:', error);
    // Always surface failures. Previously, when callbacks were supplied, the
    // function notified onError and then RESOLVED with an empty `{ sections: [] }`,
    // so callers could not distinguish a real failure (or a cancellation) from a
    // genuinely empty document (audit H-03 / G-07). The onError callback is still
    // invoked for UI handling, and the rejection preserves the original error
    // (including an AbortError's name) so cancellation stays distinguishable.
    callbacks?.onError?.(normalizedError);
    throw normalizedError;
  }
}
