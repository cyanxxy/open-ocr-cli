import { getModelClient, isGemini3Model } from './client';
import { createInteractionGenerationConfig, extractInteractionText, runModelInteraction } from './interactions';
import { logger } from '../logger';
import type { UrlResult } from '../../store/useWebOcrStore';
import type { GeminiModel, ThinkingConfig } from './types';

/**
 * Extract text from multiple URLs using Gemini's URL context feature
 * Following the official documentation: https://ai.google.dev/gemini-api/docs/url-context
 *
 * @param urls - Array of URLs to extract content from
 * @param apiKey - The Gemini API key
 * @param analysisMode - How to analyze the URLs
 * @param model - The Gemini model to use
 * @param thinkingConfig - Optional thinking configuration
 */
export async function extractTextFromUrls(
  urls: string[],
  apiKey: string,
  analysisMode: 'individual' | 'combined' | 'comparison',
  model: GeminiModel,
  thinkingConfig?: ThinkingConfig,
  abortSignal?: AbortSignal
): Promise<{
  results?: UrlResult[];
  combinedContent?: string;
  comparisonAnalysis?: string;
}> {
  try {
    logger.info(`Processing ${urls.length} URLs with mode: ${analysisMode}`);

    // Build the prompt with URLs embedded in the text
    let prompt = '';

    if (analysisMode === 'individual') {
      prompt = `Analyze each of the following URLs and extract their text content individually:

${urls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

For each URL, provide:
1. The URL
2. The type of content (webpage, image, pdf, etc.)
3. A title or heading if available
4. The main text content extracted

Format the response as JSON:
{
  "results": [
    {
      "url": "the URL",
      "type": "webpage|image|pdf|unknown",
      "title": "title if available",
      "content": "extracted text content"
    }
  ]
}`;
    } else if (analysisMode === 'combined') {
      prompt = `Extract and combine all text content from the following URLs into a single coherent document:

${urls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

Merge the content intelligently, removing duplicates and organizing it logically.
Include source attribution where appropriate.

Provide the combined content as a well-structured markdown document.`;
    } else if (analysisMode === 'comparison') {
      prompt = `Compare and analyze the content from the following URLs:

${urls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

Provide:
1. Summary of each document
2. Key similarities between documents
3. Key differences between documents
4. Common themes or topics
5. Unique insights from each source

Format as a structured comparison analysis.`;
    }

    // Configure generation parameters with model-specific defaults (Gemini 3 defaults to temperature 1.0)
    const generationConfig = createInteractionGenerationConfig({
      temperature: isGemini3Model(model) ? 1.0 : 0.2,
      maxOutputTokens: 8192,
      topP: 0.95,
    }, thinkingConfig);
    const responseFormat = analysisMode === 'individual'
      ? {
          type: 'object',
          additionalProperties: false,
          required: ['results'],
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['url', 'type', 'content'],
                properties: {
                  url: { type: 'string' },
                  type: { type: 'string' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        }
      : undefined;

    const interaction = await runModelInteraction({
      apiKey,
      model,
      input: prompt,
      tools: [{ type: 'url_context' }],
      generationConfig,
      responseFormat,
      responseMimeType: analysisMode === 'individual' ? 'application/json' : undefined,
      abortSignal,
      store: false,
    });

    const responseText = extractInteractionText(interaction.outputs);
    if (!responseText) {
      throw new Error('URL context interaction returned no text response');
    }

    // Parse response based on mode
    if (analysisMode === 'individual') {
      try {
        // Try to parse as JSON first
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { results: parsed.results || [] };
        }
      } catch {
        logger.warn('Failed to parse JSON response, falling back to text parsing');
      }

      // Fallback: parse as text
      const results: UrlResult[] = urls.map(url => ({
        url,
        type: 'unknown' as const,
        content: `Extracted content for ${url}:\n\n${responseText}`
      }));

      return { results };
    } else if (analysisMode === 'combined') {
      return { combinedContent: responseText };
    } else {
      return {
        comparisonAnalysis: responseText,
        results: urls.map(url => ({
          url,
          type: 'unknown' as const,
          content: 'See comparison analysis'
        }))
      };
    }
  } catch (error) {
    logger.error('URL extraction failed:', error);

    // Check if it's an API error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorString = JSON.stringify(error);

    // Check for 500 internal error - this often means the URL context feature isn't available
    // or there's an issue with the API call format
    if (errorString.includes('500') ||
        errorString.includes('INTERNAL') ||
        errorMessage.includes('internal error')) {
      logger.warn('Gemini API internal error - attempting fallback without URL context');
      return extractTextFromUrlsFallback(urls, apiKey, analysisMode, model, abortSignal);
    }

    // Check for various error patterns that might indicate URL context isn't supported
    if (errorMessage.includes('tools') ||
        errorMessage.includes('urlContext') ||
        errorMessage.includes('config') ||
        errorMessage.includes('not supported') ||
        errorString.includes('500') ||
        errorString.includes('INTERNAL')) {
      logger.info('URL context not supported or API error, falling back to prompt-only mode');
      return extractTextFromUrlsFallback(urls, apiKey, analysisMode, model, abortSignal);
    }

    throw error;
  }
}

/**
 * Fallback method when URL context is not available
 * This provides guidance to the user about the URLs without actually fetching them
 *
 * @param urls - Array of URLs to analyze
 * @param apiKey - The Gemini API key
 * @param analysisMode - How to analyze the URLs
 * @param model - The Gemini model to use
 */
async function extractTextFromUrlsFallback(
  urls: string[],
  apiKey: string,
  analysisMode: 'individual' | 'combined' | 'comparison',
  model: GeminiModel,
  abortSignal?: AbortSignal
): Promise<{
  results?: UrlResult[];
  combinedContent?: string;
  comparisonAnalysis?: string;
}> {
  const modelClient = getModelClient(apiKey, model);

  logger.warn('Using fallback mode - URL content cannot be directly accessed');

  // Build a prompt that asks the model to analyze URLs based on their structure
  let prompt = `I need to analyze the following URLs, but I cannot directly access their content.

URLs provided:
${urls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

`;

  if (analysisMode === 'individual') {
    prompt += `Based on the URL structure and domains, please provide:
1. What type of content each URL likely contains
2. Suggestions for extracting text from these types of sources
3. Common text extraction challenges for these content types

Note: To actually extract content from these URLs, please ensure you're using a model that supports URL context (Gemini 3.1 Pro / Gemini 3 Flash or Gemini 2.5 Pro/Flash/Flash-Lite).`;
  } else if (analysisMode === 'combined') {
    prompt += `Please provide guidance on:
1. How to combine content from multiple web sources
2. Best practices for merging different content types
3. Strategies for organizing combined content

Note: Direct URL access requires a model with URL context support.`;
  } else {
    prompt += `Please provide guidance on:
1. How to compare content from multiple sources
2. Key aspects to analyze when comparing documents
3. Methods for identifying similarities and differences

Note: Direct URL access requires a model with URL context support.`;
  }

  // Safety settings to disable all content filtering
  const safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
  ];

  const result = await modelClient.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096
    },
    safetySettings,
    config: abortSignal ? { abortSignal } : undefined
  });

  const responseText = result.response.text();

  // Return appropriate structure based on mode with clear error messaging
  const errorNote = 'Direct URL access not available. Please ensure:\n1. You\'re using a model that supports URL context (Gemini 3.1 Pro / Gemini 3 Flash or Gemini 2.5 Pro/Flash/Flash-Lite)\n2. Your API key has access to URL context features\n\nNote: This app currently exposes Gemini 3.1 Pro and Gemini 3 Flash preview models.\n\n';

  if (analysisMode === 'individual') {
    const results: UrlResult[] = urls.map(url => ({
      url,
      type: 'unknown' as const,
      content: '',
      error: errorNote + 'URL analysis:\n' + responseText
    }));
    return { results };
  } else if (analysisMode === 'combined') {
    return {
      combinedContent: errorNote + responseText
    };
  } else {
    return {
      comparisonAnalysis: errorNote + responseText,
      results: urls.map(url => ({
        url,
        type: 'unknown' as const,
        content: 'URL context not available',
        error: 'Please use a model that supports URL context'
      }))
    };
  }
}
