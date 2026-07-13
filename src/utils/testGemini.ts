import { ModelType } from '../store/useSettingsStore';
import { logger } from '../lib/logger';
import { getGenAIClient } from '../lib/gemini/client';

export interface TestResult {
  success: boolean;
  model: string;
  responseTime: number;
  response?: string;
  error?: string;
  errorType?: 'auth' | 'quota' | 'model' | 'network' | 'timeout' | 'unknown';
}

/** Bound the connectivity probe so a hung request cannot block the UI forever. */
const TEST_TIMEOUT_MS = 15000;

// Connectivity probe for the Gemini API. This is a network test of the supplied
// key/model, NOT a format check: Google's key format is changing in 2026, so
// asserting a "AIza"/length prefix would reject valid keys (audit G-06).
export async function testGemini(apiKey: string, model: ModelType = 'gemini-3.5-flash'): Promise<TestResult> {
  const startTime = Date.now();

  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      model,
      responseTime: 0,
      error: 'API key is required',
      errorType: 'auth'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    // Reuse the shared client and keep Gemini 3's recommended default temperature.
    const ai = getGenAIClient(apiKey.trim());
    const response = await ai.models.generateContent({
      model,
      contents: 'Reply with exactly: OK',
      config: {
        maxOutputTokens: 64,
        abortSignal: controller.signal,
      }
    });

    return {
      success: true,
      model,
      responseTime: Date.now() - startTime,
      response: response.text || 'OK'
    };

  } catch (error: unknown) {
    const responseTime = Date.now() - startTime;
    logger.error('Error testing Gemini API:', error);

    let errorType: TestResult['errorType'] = 'unknown';
    let errorMessage = 'An unknown error occurred';

    if (controller.signal.aborted) {
      return {
        success: false,
        model,
        responseTime,
        error: `Request timed out after ${TEST_TIMEOUT_MS / 1000}s`,
        errorType: 'timeout',
      };
    }

    if (error instanceof Error && error.message) {
      const message = error.message.toLowerCase();

      if (message.includes('api key') || message.includes('401') || message.includes('unauthorized')) {
        errorType = 'auth';
        errorMessage = 'Invalid API key or unauthorized access';
      } else if (message.includes('quota') || message.includes('429') || message.includes('rate limit')) {
        errorType = 'quota';
        errorMessage = 'API quota exceeded or rate limit reached';
      } else if (message.includes('model') || message.includes('404') || message.includes('not found')) {
        errorType = 'model';
        errorMessage = `Model "${model}" not found or unavailable`;
      } else if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
        errorType = 'network';
        errorMessage = 'Network connection error';
      } else {
        errorMessage = error.message;
      }
    }

    return {
      success: false,
      model,
      responseTime,
      error: errorMessage,
      errorType
    };
  } finally {
    clearTimeout(timeout);
  }
}
