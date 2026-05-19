import { isGemini3Model } from './client';
import {
  createInteractionGenerationConfig,
  extractInteractionText,
  runModelInteraction,
  summarizeUrlContextResults,
} from './interactions';
import { logger } from '../logger';
import type { UrlResult } from '../../store/useWebOcrStore';
import type { GeminiModel, ThinkingConfig } from './types';

const VERIFIED_ONLY_SUFFIX = 'Web OCR only returns verified URL-context results and will not guess content.';

function createGroundedUrlError(message: string): Error {
  return new Error(`${message} ${VERIFIED_ONLY_SUFFIX}`);
}

function normalizeResultType(value: unknown): UrlResult['type'] {
  switch (value) {
    case 'webpage':
    case 'image':
    case 'pdf':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function parseIndividualResults(responseText: string, urls: string[]): UrlResult[] {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw createGroundedUrlError('Grounded URL extraction returned an unreadable individual response.');
  }

  const parsed = JSON.parse(jsonMatch[0]) as { results?: unknown };
  if (!Array.isArray(parsed.results) || parsed.results.length !== urls.length) {
    throw createGroundedUrlError('Grounded URL extraction did not return a complete result for every requested URL.');
  }

  return parsed.results.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw createGroundedUrlError('Grounded URL extraction returned a malformed result entry.');
    }

    const result = entry as {
      url?: unknown;
      type?: unknown;
      title?: unknown;
      content?: unknown;
    };

    if (typeof result.content !== 'string' || result.content.trim().length === 0) {
      throw createGroundedUrlError('Grounded URL extraction returned an empty result for at least one URL.');
    }

    return {
      url: typeof result.url === 'string' ? result.url : urls[index],
      type: normalizeResultType(result.type),
      title: typeof result.title === 'string' ? result.title : undefined,
      content: result.content.trim(),
    };
  });
}

function validateUrlContextResults(
  urls: string[],
  outputs?: Array<{
    type?: string;
    is_error?: boolean;
    result?: unknown;
  }>,
): void {
  const { hasToolError, results } = summarizeUrlContextResults(outputs);

  if (hasToolError) {
    throw createGroundedUrlError('Grounded URL retrieval failed before the model produced a verified answer.');
  }

  if (results.length === 0) {
    throw createGroundedUrlError('Grounded URL retrieval could not be verified for this response.');
  }

  if (results.length < urls.length) {
    throw createGroundedUrlError('Grounded URL retrieval did not verify every requested URL.');
  }

  const failedResults = results.filter((result) => result.status !== 'success');
  if (failedResults.length > 0) {
    const detail = failedResults
      .map((result, index) => `${result.url || urls[index] || `URL ${index + 1}`} (${result.status || 'unknown'})`)
      .join(', ');

    throw createGroundedUrlError(`Grounded URL retrieval failed for ${detail}.`);
  }
}

function normalizeUrlExtractionError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.message.includes(VERIFIED_ONLY_SUFFIX)) {
      return error;
    }

    const loweredError = error.message.toLowerCase();
    if (
      loweredError.includes('url context')
      || loweredError.includes('url_context')
      || loweredError.includes('internal')
      || loweredError.includes('not supported')
      || loweredError.includes('tools')
      || loweredError.includes('500')
      || loweredError.includes('permission')
    ) {
      return createGroundedUrlError('Grounded URL retrieval is unavailable for this API key, model, or region.');
    }

    return new Error(error.message);
  }

  return createGroundedUrlError('Grounded URL retrieval failed.');
}

/**
 * Extract text from multiple URLs using Gemini's URL context feature.
 *
 * The response is treated as valid only when URL-context retrieval reports
 * success for every requested URL. Otherwise the function fails closed.
 */
export async function extractTextFromUrls(
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
    logger.info(`Processing ${urls.length} URLs with mode: ${analysisMode}`);

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
    } else {
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

    if (interaction.status && interaction.status !== 'completed') {
      throw createGroundedUrlError(`URL-context interaction ended with status "${interaction.status}".`);
    }

    validateUrlContextResults(urls, interaction.outputs);

    const responseText = extractInteractionText(interaction.outputs);
    if (!responseText) {
      throw createGroundedUrlError('Grounded URL retrieval succeeded, but the model returned no text output.');
    }

    if (analysisMode === 'individual') {
      return { results: parseIndividualResults(responseText, urls) };
    }

    if (analysisMode === 'combined') {
      return { combinedContent: responseText.trim() };
    }

    return { comparisonAnalysis: responseText.trim() };
  } catch (error) {
    logger.error('URL extraction failed:', error);
    throw normalizeUrlExtractionError(error);
  }
}
