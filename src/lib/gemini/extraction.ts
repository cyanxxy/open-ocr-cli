/**
 * Text and structured data extraction operations using Gemini AI
 * This module contains the main extraction functions moved from the monolithic gemini.ts
 */

import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger';
import { applyThinkingConfig } from './client';
import type {
  ExtractedContent,
  StreamingCallbacks,
  ExtractionOptions,
  ExtractionInstruction,
  GeminiModel,
  GeminiClientConfig,
  ThinkingConfig
} from './types';

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

/**
 * Build generation configuration for Gemini preview API calls
 */
function buildGenerationConfig(
  modelName: GeminiModel,
  options?: ExtractionOptions,
  thinkingConfig?: ThinkingConfig
): Record<string, unknown> {
  // Gemini preview models default to temperature 1.0; keep unless you have a reason to tune
  const isFlashModel = modelName === 'gemini-3-flash-preview' || modelName === 'gemini-3.5-flash';
  let config: Record<string, unknown> = {
    temperature: options?.temperature ?? 1.0,
    maxOutputTokens: options?.maxTokens ?? 65536,
    topP: 0.95,
    topK: isFlashModel ? 64 : 40
  };

  if (options?.structuredOutput || options?.outputFormat === 'json') {
    config.responseMimeType = 'application/json';
  }

  if (options?.abortSignal) {
    config.abortSignal = options.abortSignal;
  }

  // Apply thinking configuration for Gemini preview models
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

    const genAI = new GoogleGenAI({ apiKey });
    
    // Prepare the file data
    const base64Data = fileData.split(',')[1] || fileData;
    
    // Build the prompt
    let prompt = 'Extract all text content from this document. ';
    
    if (instructions && instructions.length > 0) {
      prompt = instructions.map(inst => inst.prompt).join('\n\n') + '\n\n';
    }
    
    if (options?.handwritingStyle) {
      prompt += `The document contains ${options.handwritingStyle} handwriting. `;
    }
    
    if (options?.detectImages) {
      prompt += 'Detect and describe any images, charts, or diagrams. ';
    }
    
    if (options?.detectMathEquations) {
      prompt += 'Detect and format mathematical equations using LaTeX notation. ';
    }
    
    if (options?.outputFormat === 'markdown' || !options?.structuredOutput) {
      prompt += 'Format the output as clean markdown with proper headings and structure.';
    } else if (options?.structuredOutput || options?.outputFormat === 'json') {
      prompt += 'Output the result as structured JSON with title, sections, and content.';
    }

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

    // Build generation config
    const generationConfig = buildGenerationConfig(model, options, thinkingConfig);

    // Handle streaming if callbacks are provided
    if (callbacks) {
      const result = await genAI.models.generateContentStream({
        model,
        contents,
        config: generationConfig
      });

      let fullText = '';
      for await (const chunk of result) {
        const chunkText = chunk.text || '';
        fullText += chunkText;
        callbacks.onProgress?.(chunkText);
      }

      const finalContent = (options?.structuredOutput || options?.outputFormat === 'json')
        ? (parseExtractedContentFromJson(fullText) || processMarkdownIntoExtractedContent(fullText))
        : processMarkdownIntoExtractedContent(fullText);
      callbacks.onComplete?.(finalContent);
      return finalContent;

    } else {
      // Non-streaming implementation
      const response = await genAI.models.generateContent({
        model,
        contents,
        config: generationConfig
      });

      const responseText = response.text || '';
      return (options?.structuredOutput || options?.outputFormat === 'json')
        ? (parseExtractedContentFromJson(responseText) || processMarkdownIntoExtractedContent(responseText))
        : processMarkdownIntoExtractedContent(responseText);
    }

  } catch (error) {
    if (callbacks?.onError) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      logger.error('Text extraction failed:', error);
      // Return a minimal result instead of throwing, since the error is handled by the callback
      return { sections: [] };
    }
    logger.error('Text extraction failed:', error);
    throw error instanceof Error ? error : new Error('Failed to extract text from file');
  }
}
