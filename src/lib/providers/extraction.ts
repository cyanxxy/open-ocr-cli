import type {
  ExtractedContent,
  ExtractionInstruction,
  ExtractionOptions,
  ExtractionPreset,
  GeminiClientConfig,
  GeminiModel,
  JsonValue,
  PresetRunResult,
} from '../gemini';
import {
  EXTRACTED_CONTENT_RESPONSE_SCHEMA,
  coerceExtractionResult,
  extractStructuredDataFromFile,
  extractTextFromFile,
} from '../gemini/extraction';
import {
  buildPresetPrompt,
  buildPresetResponseSchema,
  presetRunResultFromText,
  runExtractionPreset,
} from '../templates';
import type { ProviderRuntimeConfig } from './types';
import {
  createChatCompletion,
  documentContentParts,
  type OpenAIMessage,
} from './openaiCompatible';
import { providerDefaultBaseUrl, providerRequestHeaders } from './registry';

function geminiConfig(config: ProviderRuntimeConfig): GeminiClientConfig {
  const usesCustomTransport = config.gateway === 'cloudflare'
    || config.baseUrl !== providerDefaultBaseUrl('gemini');
  return {
    apiKey: config.apiKey || (config.cloudflareByok ? config.gatewayToken || 'cloudflare-byok' : ''),
    model: config.model as GeminiModel,
    thinkingConfig: config.thinkingConfig,
    baseUrl: usesCustomTransport ? config.baseUrl : undefined,
    headers: config.gateway === 'cloudflare' ? providerRequestHeaders(config) : undefined,
    runtime: config.runtime,
  };
}

function extractionPrompt(
  instructions: ExtractionInstruction[] | undefined,
  options: ExtractionOptions | undefined,
  wantsJson: boolean,
): string {
  const parts = instructions?.length
    ? instructions.map((instruction) => instruction.prompt)
    : ['Extract all text content from this document.'];
  if (options?.detectImages) parts.push('Detect and describe any images, charts, or diagrams.');
  if (options?.detectMathEquations) parts.push('Detect and format mathematical equations using LaTeX notation.');
  parts.push(wantsJson
    ? 'Return only JSON matching the response schema.'
    : 'Preserve layout, headings, tables, lists, code, equations, and reading order in Markdown.');
  return parts.join(' ');
}

async function providerMessages(
  config: ProviderRuntimeConfig,
  dataUrl: string,
  mimeType: string,
  filename: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<OpenAIMessage[]> {
  const media = await documentContentParts(config, dataUrl, mimeType, filename, signal);
  return [{
    role: 'user',
    content: [{ type: 'text', text: prompt }, ...media],
  }];
}

export async function extractTextWithProvider(
  dataUrl: string,
  mimeType: string,
  filename: string,
  config: ProviderRuntimeConfig,
  instructions?: ExtractionInstruction[],
  options?: ExtractionOptions,
): Promise<ExtractedContent> {
  if (config.provider === 'gemini') {
    return extractTextFromFile(dataUrl, mimeType, geminiConfig(config), instructions, options);
  }
  const wantsJson = options?.structuredOutput === true || options?.outputFormat === 'json';
  const result = await createChatCompletion(config, {
    messages: await providerMessages(
      config,
      dataUrl,
      mimeType,
      filename,
      extractionPrompt(instructions, options, wantsJson),
      options?.abortSignal,
    ),
    maxTokens: options?.maxTokens ?? 32768,
    responseSchema: wantsJson ? EXTRACTED_CONTENT_RESPONSE_SCHEMA : undefined,
    schemaName: 'ocr_document',
    signal: options?.abortSignal,
    ...(config.provider === 'openrouter' && mimeType === 'application/pdf'
      ? { extraBody: { plugins: [{ id: 'file-parser' }] } }
      : {}),
  });
  return coerceExtractionResult(result.text, wantsJson);
}

export async function extractStructuredWithProvider(
  dataUrl: string,
  mimeType: string,
  filename: string,
  config: ProviderRuntimeConfig,
  responseJsonSchema: Record<string, unknown>,
  instructions?: ExtractionInstruction[],
  options?: Pick<ExtractionOptions, 'abortSignal' | 'maxTokens' | 'detectImages' | 'detectMathEquations'>,
): Promise<JsonValue> {
  if (config.provider === 'gemini') {
    return extractStructuredDataFromFile(
      dataUrl,
      mimeType,
      geminiConfig(config),
      responseJsonSchema,
      instructions,
      options,
    );
  }
  const prompt = [
    'Extract the document into the exact JSON structure described by the response schema.',
    'Use only information visible in the document. Do not invent missing values. Return JSON only.',
    ...(instructions?.map((instruction) => instruction.prompt) ?? []),
    ...(options?.detectImages ? ['Include relevant information visible in charts, diagrams, or images.'] : []),
    ...(options?.detectMathEquations ? ['Represent mathematical expressions accurately.'] : []),
  ].join(' ');
  const result = await createChatCompletion(config, {
    messages: await providerMessages(config, dataUrl, mimeType, filename, prompt, options?.abortSignal),
    maxTokens: options?.maxTokens ?? 32768,
    responseSchema: responseJsonSchema,
    schemaName: 'custom_ocr_result',
    signal: options?.abortSignal,
    ...(config.provider === 'openrouter' && mimeType === 'application/pdf'
      ? { extraBody: { plugins: [{ id: 'file-parser' }] } }
      : {}),
  });
  try {
    return JSON.parse(result.text) as JsonValue;
  } catch {
    throw new Error('Schema extraction returned invalid JSON');
  }
}

export async function extractPresetWithProvider(
  dataUrl: string,
  mimeType: string,
  filename: string,
  config: ProviderRuntimeConfig,
  preset: ExtractionPreset,
  signal?: AbortSignal,
): Promise<PresetRunResult> {
  if (config.provider === 'gemini') {
    return runExtractionPreset(dataUrl, mimeType, geminiConfig(config), preset, { abortSignal: signal });
  }
  const result = await createChatCompletion(config, {
    messages: await providerMessages(config, dataUrl, mimeType, filename, buildPresetPrompt(preset), signal),
    maxTokens: 16384,
    responseSchema: buildPresetResponseSchema(preset),
    schemaName: `${preset.id.replace(/[^a-zA-Z0-9_-]/g, '_')}_ocr`,
    signal,
    ...(config.provider === 'openrouter' && mimeType === 'application/pdf'
      ? { extraBody: { plugins: [{ id: 'file-parser' }] } }
      : {}),
  });
  return presetRunResultFromText(result.text, preset);
}
