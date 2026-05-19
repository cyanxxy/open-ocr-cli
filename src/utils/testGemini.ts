import { GoogleGenAI } from '@google/genai';
import { ModelType } from '../store/useSettingsStore';
import { logger } from '../lib/logger';

export interface TestResult {
  success: boolean;
  model: string;
  responseTime: number;
  response?: string;
  error?: string;
  errorType?: 'auth' | 'quota' | 'model' | 'network' | 'unknown';
}

// Enhanced function to test the Gemini API with detailed results
export async function testGemini(apiKey: string, model: ModelType = 'gemini-3.5-flash'): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    // Validate API key format
    if (!apiKey || !apiKey.trim()) {
      return {
        success: false,
        model,
        responseTime: 0,
        error: 'API key is required',
        errorType: 'auth'
      };
    }

    if (!apiKey.startsWith('AIza') || apiKey.length < 30) {
      return {
        success: false,
        model,
        responseTime: Date.now() - startTime,
        error: 'Invalid API key format. API key should start with "AIza" and be at least 30 characters long.',
        errorType: 'auth'
      };
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey.trim()
    });

    // Test a simple prompt with the selected model
    const response = await ai.models.generateContent({
      model,
      contents: 'Hello! Please respond with "API test successful" to confirm this connection is working.',
      config: {
        temperature: 0.7,
        maxOutputTokens: 50,
      }
    });

    const responseTime = Date.now() - startTime;
    const responseText = response.text || 'No response text';

    return {
      success: true,
      model,
      responseTime,
      response: responseText
    };

  } catch (error: unknown) {
    const responseTime = Date.now() - startTime;
    logger.error('Error testing Gemini API:', error);
    
    let errorType: TestResult['errorType'] = 'unknown';
    let errorMessage = 'An unknown error occurred';

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
  }
}

