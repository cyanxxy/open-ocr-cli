import { logger } from '../logger';
import type { UrlResult } from '../../store/useWebOcrStore';
import type { GeminiModel, ThinkingConfig } from './types';
import { extractTextFromUrls } from './operations';

/**
 * Grounded URL extraction wrapper.
 *
 * The previous prompt-only fallbacks have been removed intentionally. If URL
 * context is unavailable or unverifiable, this function throws so the UI can
 * surface an explicit error instead of fabricated content.
 */
export async function extractTextFromUrlsProgressive(
  urls: string[],
  apiKey: string,
  analysisMode: 'individual' | 'combined' | 'comparison',
  model: GeminiModel,
  thinkingConfig?: ThinkingConfig,
  abortSignal?: AbortSignal,
): Promise<{
  results?: UrlResult[];
  combinedContent?: string;
  comparisonAnalysis?: string;
}> {
  try {
    return await extractTextFromUrls(
      urls,
      apiKey,
      analysisMode,
      model,
      thinkingConfig,
      abortSignal,
    );
  } catch (error) {
    logger.error('Grounded URL extraction failed:', error);
    throw error instanceof Error ? error : new Error('Grounded URL extraction failed.');
  }
}
