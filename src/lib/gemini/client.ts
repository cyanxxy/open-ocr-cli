/**
 * Gemini AI client configuration and initialization
 * Handles API client creation and model configuration
 */

import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger';
import { GeminiModel, OcrError, OcrErrorType, ThinkingLevel } from './types';

/**
 * Cache for GoogleGenAI instances to avoid recreating them
 */
const clientCache = new Map<string, GoogleGenAI>();

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
export function getGenAIClient(apiKey: string): GoogleGenAI {
  if (!apiKey) {
    throw new OcrError(
      OcrErrorType.API_KEY_MISSING,
      'API key is required for Gemini AI'
    );
  }

  const cacheKey = apiKey;

  // Get or create GoogleGenAI instance
  let genAI: GoogleGenAI;
  if (clientCache.has(cacheKey)) {
    logger.debug(`Using cached GoogleGenAI client`);
    genAI = clientCache.get(cacheKey)!;
  } else {
    try {
      // Create new Gemini AI instance with the new SDK format
      genAI = new GoogleGenAI({ apiKey });
      clientCache.set(cacheKey, genAI);
      logger.info(`Created new GoogleGenAI client`);
    } catch (error) {
      logger.error('Failed to create Gemini client:', error);
      throw new OcrError(
        OcrErrorType.API_KEY_MISSING,
        'Failed to initialize Gemini AI client',
        error
      );
    }
  }

  return genAI;
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
      if (typeof params === 'string') {
        contents = params;
      } else if (params.prompt) {
        contents = params.prompt;
      }

      const rawGenerationConfig = typeof params === 'string' ? {} : (params.generationConfig || {});
      const { maxTokens, maxOutputTokens, ...restGenerationConfig } = rawGenerationConfig;
      const mappedGenerationConfig = {
        ...restGenerationConfig,
        ...(maxTokens !== undefined || maxOutputTokens !== undefined
          ? { maxOutputTokens: maxOutputTokens ?? maxTokens }
          : {})
      };

      const config: Record<string, unknown> = {
        ...mappedGenerationConfig,
        ...((typeof params === 'string' ? {} : params.config) || {})
      };

      if (typeof params !== 'string' && params.safetySettings && !('safetySettings' in config)) {
        config.safetySettings = params.safetySettings;
      }

      // Use the new SDK's API
      const response = await genAI.models.generateContent({
        model: modelName,
        contents,
        ...(Object.keys(config).length > 0 ? { config } : {})
      });

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

      if (typeof params === 'string') {
        contents = params;
      } else if (params.prompt) {
        contents = params.prompt;
      }

      const rawGenerationConfig = typeof params === 'string' ? {} : (params.generationConfig || {});
      const { maxTokens, maxOutputTokens, ...restGenerationConfig } = rawGenerationConfig;
      const mappedGenerationConfig = {
        ...restGenerationConfig,
        ...(maxTokens !== undefined || maxOutputTokens !== undefined
          ? { maxOutputTokens: maxOutputTokens ?? maxTokens }
          : {})
      };

      const config: Record<string, unknown> = {
        ...mappedGenerationConfig,
        ...((typeof params === 'string' ? {} : params.config) || {})
      };

      if (typeof params !== 'string' && params.safetySettings && !('safetySettings' in config)) {
        config.safetySettings = params.safetySettings;
      }

      const stream = await genAI.models.generateContentStream({
        model: modelName,
        contents,
        ...(Object.keys(config).length > 0 ? { config } : {})
      });

      // Create and return the generator immediately (not a function)
      async function* createStreamGenerator() {
        for await (const chunk of stream) {
          yield {
            text: () => chunk.text || ''
          };
        }
      }

      return {
        stream: createStreamGenerator()
      };
    }
  };
}


/**
 * Check if a model is a Gemini 3 model
 */
export function isGemini3Model(modelName: GeminiModel): boolean {
  return modelName === 'gemini-3.1-pro-preview'
    || modelName === 'gemini-3-flash-preview'
    || modelName === 'gemini-3.5-flash';
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
export function applyThinkingConfig(
  generationConfig: Record<string, unknown>,
  modelName: GeminiModel,
  thinkingConfig?: { level: ThinkingLevel; includeThoughts?: boolean }
) {
  const rawLevel = thinkingConfig?.level ?? 'HIGH';
  const normalized = typeof rawLevel === 'string' ? rawLevel.toUpperCase() : rawLevel;
  const isFlash = modelName === 'gemini-3-flash-preview' || modelName === 'gemini-3.5-flash';
  const allowed = isFlash
    ? (['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] as const)
    : (['LOW', 'MEDIUM', 'HIGH'] as const);
  const level = (allowed as readonly string[]).includes(normalized) ? normalized : 'HIGH';

  return {
    ...generationConfig,
    thinkingConfig: {
      thinkingLevel: level.toLowerCase(),
      ...(thinkingConfig?.includeThoughts && { includeThoughts: true }),
    },
  };
}
