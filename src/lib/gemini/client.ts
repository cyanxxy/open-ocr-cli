/**
 * Gemini AI client configuration and initialization
 * Handles API client creation and model configuration
 */

import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger';
import { waitForGeminiRequestSlot } from './requestPolicy';
import { GeminiModel, OcrError, OcrErrorType, ThinkingLevel } from './types';
import { recordGeminiUsage } from './usage';

/**
 * Cache for GoogleGenAI instances to avoid recreating them
 */
const clientCache = new Map<string, GoogleGenAI>();

export interface GeminiTransportOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
}

/**
 * Content part type for the SDK
 */
interface ContentPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

/**
 * Content type for the SDK
 */
interface Content {
  role: 'user' | 'model';
  parts: ContentPart[];
}

/**
 * Content list union - matches SDK's ContentListUnion
 */
type ContentListUnion = Content | Content[] | ContentPart | ContentPart[] | string | string[];

/**
 * Content generation parameters
 */
export interface GenerationParams {
  contents?: ContentListUnion;
  prompt?: string;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
  };
  config?: Record<string, unknown>;
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

/**
 * Generation response
 */
export interface GenerationResponse {
  response: {
    text: () => string;
    candidates?: Array<unknown>;
  };
}

/**
 * Stream chunk
 */
export interface StreamChunk {
  text: () => string;
}

/**
 * GenerativeModel interface for the application
 */
export interface GenerativeModel {
  generateContent: (params: GenerationParams) => Promise<GenerationResponse>;
  generateContentStream: (params: GenerationParams) => Promise<{ stream: AsyncGenerator<StreamChunk> }>;
}

/**
 * Get or create a raw GoogleGenAI client for APIs that need direct SDK access
 * such as the Interactions API.
 */
export function getGenAIClient(apiKey: string, transport: GeminiTransportOptions = {}): GoogleGenAI {
  if (!apiKey) {
    throw new OcrError(
      OcrErrorType.API_KEY_MISSING,
      'API key is required for Gemini AI'
    );
  }

  const cacheKey = JSON.stringify([apiKey, transport.baseUrl ?? '', transport.headers ?? {}]);
  const cached = clientCache.get(cacheKey);
  if (cached) {
    logger.debug(`Using cached GoogleGenAI client`);
    return cached;
  }

  // Retain only one client at a time. Clearing the cache before adding a new
  // entry prevents old API-key strings and their client objects from lingering
  // in memory for the page lifetime after a key rotation (audit H-14).
  clientCache.clear();
  try {
    const genAI = new GoogleGenAI({
      apiKey,
      ...((transport.baseUrl || transport.headers) ? {
        httpOptions: {
          ...(transport.baseUrl ? { baseUrl: transport.baseUrl } : {}),
          ...(transport.headers ? { headers: transport.headers } : {}),
        },
      } : {}),
    });
    clientCache.set(cacheKey, genAI);
    logger.info(`Created new GoogleGenAI client`);
    return genAI;
  } catch (error) {
    logger.error('Failed to create Gemini client:', error);
    throw new OcrError(
      OcrErrorType.API_KEY_MISSING,
      'Failed to initialize Gemini AI client',
      error
    );
  }
}

/**
 * Drop any cached GoogleGenAI client. Call this on API-key change/logout so a
 * rotated or removed credential is not retained in memory (audit H-14).
 */
export function clearGeminiClientCache(): void {
  clientCache.clear();
}

interface GeminiResponseStatus {
  candidates?: Array<{ finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

function assertNotFailedFinishReason(finishReason: string | undefined, operation: string): void {
  if (!finishReason || finishReason === 'STOP') return;
  if (finishReason === 'MAX_TOKENS') {
    throw new Error(
      `${operation} reached the output token limit and returned incomplete output. `
      + 'Increase the output-token limit or lower the thinking level and retry.',
    );
  }
  throw new Error(`${operation} did not complete normally (finishReason: ${finishReason})`);
}

function assertPromptNotBlocked(response: GeminiResponseStatus, operation: string): void {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`${operation} was blocked by safety filters (${blockReason})`);
  }
}

/**
 * Reject blocked or incomplete generateContent responses before callers parse
 * or persist them. A MAX_TOKENS response can contain plausible-looking text or
 * even valid JSON, but it is still truncated and must not be reported as a
 * successful OCR result.
 */
export function assertCompleteGeminiResponse(
  response: GeminiResponseStatus,
  operation = 'Gemini request',
): void {
  assertPromptNotBlocked(response, operation);
  const candidate = response.candidates?.[0];
  if (!candidate) return;
  if (!candidate.finishReason) {
    throw new Error(`${operation} returned a candidate without a terminal finish reason and may be incomplete`);
  }
  assertNotFailedFinishReason(candidate.finishReason, operation);
}

export interface GeminiStreamCompletionTracker {
  observe: (chunk: GeminiResponseStatus) => void;
  assertComplete: () => void;
}

/**
 * Track completion across a generateContent stream. In-progress chunks may
 * have candidates without finishReason; the stream is successful only after a
 * candidate reports STOP. Later usage-only chunks do not erase that terminal
 * state.
 */
export function createGeminiStreamCompletionTracker(
  operation = 'Gemini request',
): GeminiStreamCompletionTracker {
  let sawCandidate = false;
  let lastCandidateFinishReason: string | undefined;
  return {
    observe: (chunk: GeminiResponseStatus): void => {
      assertPromptNotBlocked(chunk, operation);
      const candidate = chunk.candidates?.[0];
      if (!candidate) return;
      sawCandidate = true;
      lastCandidateFinishReason = candidate.finishReason;
      assertNotFailedFinishReason(lastCandidateFinishReason, operation);
    },
    assertComplete: (): void => {
      if (!sawCandidate || lastCandidateFinishReason !== 'STOP') {
        throw new Error(`${operation} stream ended without a terminal STOP and may be incomplete`);
      }
    },
  };
}

/**
 * Get or create a Gemini model client
 * @param apiKey - The Google AI API key
 * @param modelName - The model name to use
 * @returns The configured GenerativeModel instance
 */
export function getModelClient(
  apiKey: string,
  modelName: GeminiModel = 'gemini-3.5-flash'
): GenerativeModel {
  const genAI = getGenAIClient(apiKey);

  return {
    generateContent: async (params: GenerationParams) => {
      let contents: ContentListUnion = params.contents || '';
      if (params.prompt) {
        contents = params.prompt;
      }

      const rawGenerationConfig = params.generationConfig || {};
      const { maxTokens, maxOutputTokens, ...restGenerationConfig } = rawGenerationConfig;
      const mappedGenerationConfig = {
        ...restGenerationConfig,
        ...(maxTokens !== undefined || maxOutputTokens !== undefined
          ? { maxOutputTokens: maxOutputTokens ?? maxTokens }
          : {})
      };

      const config: Record<string, unknown> = {
        ...mappedGenerationConfig,
        ...(params.config || {})
      };

      if (params.safetySettings && !('safetySettings' in config)) {
        config.safetySettings = params.safetySettings;
      }

      // Use the new SDK's API
      await waitForGeminiRequestSlot();
      const response = await genAI.models.generateContent({
        model: modelName,
        contents,
        ...(Object.keys(config).length > 0 ? { config } : {})
      });
      recordGeminiUsage(response, modelName);
      assertCompleteGeminiResponse(response);

      return {
        response: {
          text: () => response.text || '',
          candidates: response.candidates || []
        }
      };
    },

    generateContentStream: async (params: GenerationParams) => {
      // Handle streaming with new SDK
      let contents: ContentListUnion = params.contents || '';

      if (params.prompt) {
        contents = params.prompt;
      }

      const rawGenerationConfig = params.generationConfig || {};
      const { maxTokens, maxOutputTokens, ...restGenerationConfig } = rawGenerationConfig;
      const mappedGenerationConfig = {
        ...restGenerationConfig,
        ...(maxTokens !== undefined || maxOutputTokens !== undefined
          ? { maxOutputTokens: maxOutputTokens ?? maxTokens }
          : {})
      };

      const config: Record<string, unknown> = {
        ...mappedGenerationConfig,
        ...(params.config || {})
      };

      if (params.safetySettings && !('safetySettings' in config)) {
        config.safetySettings = params.safetySettings;
      }

      await waitForGeminiRequestSlot();
      const stream = await genAI.models.generateContentStream({
        model: modelName,
        contents,
        ...(Object.keys(config).length > 0 ? { config } : {})
      });

      // Create and return the generator immediately (not a function)
      async function* createStreamGenerator() {
        const completion = createGeminiStreamCompletionTracker();
        let lastChunk: unknown;
        for await (const chunk of stream) {
          lastChunk = chunk;
          try {
            completion.observe(chunk);
          } catch (error) {
            recordGeminiUsage(chunk, modelName);
            throw error;
          }
          yield {
            text: () => chunk.text || ''
          };
        }
        recordGeminiUsage(lastChunk, modelName);
        completion.assertComplete();
      }

      return {
        stream: createStreamGenerator()
      };
    }
  };
}


/**
 * Check if a model is a Gemini 3.x model
 */
export function isGemini3Model(modelName: GeminiModel): boolean {
  return modelName === 'gemini-3.1-pro-preview'
    || modelName === 'gemini-3-flash-preview'
    || modelName === 'gemini-3.5-flash'
    || modelName === 'gemini-3.1-flash-lite';
}

/** Flash-family models that support MINIMAL thinking. */
export function isFlashFamilyModel(modelName: GeminiModel): boolean {
  return modelName === 'gemini-3-flash-preview'
    || modelName === 'gemini-3.5-flash'
    || modelName === 'gemini-3.1-flash-lite';
}

/**
 * Global generateContent media resolution for OCR.
 * Images: HIGH (fine text). PDFs: MEDIUM (docs: quality saturates at medium).
 */
export function generateContentMediaResolution(
  mimeType: string,
): 'MEDIA_RESOLUTION_HIGH' | 'MEDIA_RESOLUTION_MEDIUM' {
  if (mimeType === 'application/pdf' || mimeType.startsWith('application/')) {
    return 'MEDIA_RESOLUTION_MEDIUM';
  }
  return 'MEDIA_RESOLUTION_HIGH';
}

/**
 * Apply thinking configuration for Gemini preview models.
 *
 * Per the Gemini 3 API docs, `thinkingLevel` is sent as a lowercase string
 * (`"minimal" | "low" | "medium" | "high"`). The internal `ThinkingLevel` type
 * is uppercase to match how settings are stored in the UI, so we lowercase
 * only at the wire boundary here.
 *
 * - Gemini 3.1 Pro supports: low, medium, high
 * - Gemini 3 Flash / Gemini 3.5 Flash support: minimal, low, medium, high
 */
/**
 * Detect terminal Gemini API failures (bad/missing key, permission). These can
 * never succeed on retry, so the agent loop stops entirely rather than burning
 * iterations against an endpoint that will keep rejecting every request.
 *
 * Note: rate-limit / quota / 5xx are intentionally NOT here — they are transient
 * and handled by isRetryableGeminiError with backoff (audit H-17).
 */
export function isFatalGeminiError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('api key')
    || message.includes('api_key_invalid')
    || message.includes('invalid api key')
    || message.includes('permission_denied')
    || message.includes('permission denied')
    || message.includes('unauthorized')
    || message.includes('401')
    || message.includes('403')
  );
}

/**
 * Detect transient Gemini API failures (rate-limit, quota, 5xx, overload,
 * network/timeout) that may succeed if retried with bounded backoff. The agent
 * loop retries these a few times before giving up rather than treating the
 * first 429/5xx as permanently fatal (audit H-17).
 */
export function isRetryableGeminiError(error: unknown): boolean {
  if (isFatalGeminiError(error)) return false;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('resource_exhausted')
    || message.includes('rate limit')
    || message.includes('rate-limit')
    || message.includes('quota')
    || message.includes('429')
    || message.includes('500')
    || message.includes('502')
    || message.includes('503')
    || message.includes('504')
    || message.includes('unavailable')
    || message.includes('overloaded')
    || message.includes('internal error')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('econnreset')
    || message.includes('fetch failed')
  );
}

/**
 * Resolve a UI `ThinkingLevel` to the lowercase wire value the Gemini API
 * expects (`"minimal" | "low" | "medium" | "high"`), clamped to what the given
 * model supports. Shared by both the `generateContent` path (applyThinkingConfig)
 * and the Interactions API path (createInteractionGenerationConfig) so they
 * never diverge.
 *
 * - Gemini 3.1 Pro supports: low, medium, high
 * - Gemini 3 Flash / Gemini 3.5 Flash support: minimal, low, medium, high
 * - Unsupported/unknown levels fall back to `high`.
 */
/**
 * Model-aware default thinking level when the UI has not set one.
 * - 3.1 Flash-Lite: minimal (API default; cheap/high-volume)
 * - 3.5 Flash: medium
 * - 3 Flash Preview: high
 * - 3.1 Pro: high
 */
export function defaultThinkingLevelForModel(modelName: GeminiModel): ThinkingLevel {
  if (modelName === 'gemini-3.1-flash-lite') return 'MINIMAL';
  if (modelName === 'gemini-3.5-flash') return 'MEDIUM';
  return 'HIGH';
}

export function normalizeThinkingLevel(
  level: ThinkingLevel | undefined,
  modelName: GeminiModel,
): 'minimal' | 'low' | 'medium' | 'high' {
  const rawLevel = level ?? defaultThinkingLevelForModel(modelName);
  const normalized = typeof rawLevel === 'string' ? rawLevel.toUpperCase() : rawLevel;
  const allowed = isFlashFamilyModel(modelName)
    ? (['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] as const)
    : (['LOW', 'MEDIUM', 'HIGH'] as const);
  const fallback = defaultThinkingLevelForModel(modelName);
  const resolved = (allowed as readonly string[]).includes(normalized) ? normalized : fallback;
  return resolved.toLowerCase() as 'minimal' | 'low' | 'medium' | 'high';
}

export function applyThinkingConfig(
  generationConfig: Record<string, unknown>,
  modelName: GeminiModel,
  thinkingConfig?: { level: ThinkingLevel; includeThoughts?: boolean }
) {
  return {
    ...generationConfig,
    thinkingConfig: {
      thinkingLevel: normalizeThinkingLevel(thinkingConfig?.level, modelName),
      ...(thinkingConfig?.includeThoughts && { includeThoughts: true }),
    },
  };
}
