import { promises as fs } from 'node:fs';
import path from 'node:path';
import { convert } from 'html-to-text';

import {
  dedupeRequestedUrls,
  extractTextFromUrls,
  parseIndividualResults,
  type UrlResult,
} from '../lib/gemini/operations';
import type { GeminiModel } from '../lib/gemini/types';
import {
  createChatCompletion,
  documentContentParts,
  providerDefaultBaseUrl,
  providerRequestHeaders,
  type OpenAIContentPart,
  type ProviderRuntimeConfig,
} from '../lib/providers';
import { getUnsupportedUrls } from '../lib/urlValidation';
import type { ResolvedCliOptions } from './types';
import { writeTextFileAtomically } from './output';
import { secureFetchPublicUrl } from './secureFetch';

export const WEB_ANALYSIS_MODES = ['individual', 'combined', 'comparison'] as const;
export type WebAnalysisMode = (typeof WEB_ANALYSIS_MODES)[number];
export type WebOutputFormat = 'markdown' | 'json';

export interface WebExtractionResult {
  results?: UrlResult[];
  combinedContent?: string;
  comparisonAnalysis?: string;
}

function runtimeConfig(options: ResolvedCliOptions): ProviderRuntimeConfig {
  return {
    provider: options.provider,
    gateway: options.gateway,
    apiKey: options.apiKey,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    baseUrl: options.baseUrl,
    thinkingConfig: { level: options.thinking, includeThoughts: options.includeThoughts },
    gatewayToken: options.gatewayToken,
    gatewayTokenEnv: options.gatewayTokenEnv,
    cloudflareAccountId: options.cloudflareAccountId,
    cloudflareGatewayId: options.cloudflareGatewayId,
    cloudflareByok: options.cloudflareByok,
    cloudflareByokAlias: options.cloudflareByokAlias,
    cloudflareProvider: options.cloudflareProvider,
    inputPricePerMillionUsd: options.inputPricePerMillionUsd,
    outputPricePerMillionUsd: options.outputPricePerMillionUsd,
  };
}

export function readableWebText(bytes: Uint8Array, contentType: string): string {
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!contentType.includes('html') && !contentType.includes('xml')) return decoded;
  return convert(decoded, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'noscript', format: 'skip' },
      { selector: 'svg', format: 'skip' },
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  })
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function webPrompt(urls: string[], analysis: WebAnalysisMode): string {
  const sources = urls.map((url, index) => `${index + 1}. ${url}`).join('\n');
  if (analysis === 'individual') return [
    'Extract the primary text from each supplied source independently.',
    `The exact source URLs are:\n${sources}`,
    'Return one result for every URL. Preserve the exact URL string.',
    'Return JSON only with {"results":[{"url":"...","type":"webpage|image|pdf|unknown","title":"...","content":"..."}]}.',
  ].join('\n\n');
  if (analysis === 'combined') return [
    'Combine the supplied sources into one well-structured Markdown document.',
    'Remove duplicates and retain source attribution.',
    sources,
  ].join('\n\n');
  return [
    'Compare the supplied sources in Markdown.',
    'Include a summary of each, similarities, differences, common themes, and unique insights.',
    sources,
  ].join('\n\n');
}

const WEB_RESULTS_SCHEMA: Record<string, unknown> = {
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
          type: { type: 'string', enum: ['webpage', 'image', 'pdf', 'unknown'] },
          title: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  },
};

async function runCompatibleWebExtraction(
  urls: string[],
  analysis: WebAnalysisMode,
  options: ResolvedCliOptions,
  signal: AbortSignal,
): Promise<WebExtractionResult> {
  const config = runtimeConfig(options);
  const parts: OpenAIContentPart[] = [{ type: 'text', text: webPrompt(urls, analysis) }];
  let totalBytes = 0;
  let hasPdf = false;
  for (const [index, url] of urls.entries()) {
    const fetched = await secureFetchPublicUrl(url, signal);
    totalBytes += fetched.bytes.byteLength;
    if (totalBytes > 30 * 1024 * 1024) throw new Error('Web OCR source data exceeds the 30 MB combined limit');
    const contentType = fetched.contentType;
    if (contentType === 'application/pdf' || contentType.startsWith('image/')) {
      hasPdf ||= contentType === 'application/pdf';
      const dataUrl = `data:${contentType};base64,${Buffer.from(fetched.bytes).toString('base64')}`;
      parts.push({ type: 'text', text: `Source ${index + 1}: ${url}` });
      parts.push(...await documentContentParts(
        config,
        dataUrl,
        contentType,
        new URL(url).pathname.split('/').pop() || `source-${index + 1}`,
        signal,
      ));
    } else {
      const text = readableWebText(fetched.bytes, contentType).slice(0, 1_500_000);
      if (!text) throw new Error(`URL returned no readable text: ${url}`);
      parts.push({ type: 'text', text: `Source ${index + 1}: ${url}\n\n${text}` });
    }
  }
  const response = await createChatCompletion(config, {
    messages: [{ role: 'user', content: parts }],
    maxTokens: analysis === 'individual'
      ? Math.min(32768, Math.max(8192, urls.length * 2048))
      : 16384,
    responseSchema: analysis === 'individual' ? WEB_RESULTS_SCHEMA : undefined,
    schemaName: 'web_ocr_results',
    signal,
    ...(config.provider === 'openrouter' && hasPdf
      ? { extraBody: { plugins: [{ id: 'file-parser' }] } }
      : {}),
  });
  if (analysis === 'individual') return { results: parseIndividualResults(response.text, urls) };
  if (analysis === 'combined') return { combinedContent: response.text.trim() };
  return { comparisonAnalysis: response.text.trim() };
}

export async function resolveWebUrls(rawUrls: string[], filePath: string | undefined, cwd: string): Promise<string[]> {
  const fromFile = filePath
    ? (await fs.readFile(path.resolve(cwd, filePath), 'utf8'))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    : [];
  const requested = [...rawUrls, ...fromFile].map((url) => url.trim()).filter(Boolean);
  if (requested.length === 0) throw new Error('Provide at least one URL or use --file');
  const unsupported = getUnsupportedUrls(requested);
  if (unsupported.length > 0) throw new Error(`Unsupported or unsafe URL(s): ${unsupported.join(', ')}`);
  const { urls } = dedupeRequestedUrls(requested);
  if (urls.length > 20) throw new Error(`Web OCR supports at most 20 unique URLs per request; received ${urls.length}`);
  return urls;
}

export function renderWebResult(
  result: WebExtractionResult,
  analysis: WebAnalysisMode,
  format: WebOutputFormat,
): string {
  if (format === 'json') return `${JSON.stringify(result, null, 2)}\n`;
  if (analysis === 'combined') {
    if (!result.combinedContent) throw new Error('Combined Web OCR returned no content');
    return result.combinedContent.replace(/\n?$/, '\n');
  }
  if (analysis === 'comparison') {
    if (!result.comparisonAnalysis) throw new Error('Comparison Web OCR returned no content');
    return result.comparisonAnalysis.replace(/\n?$/, '\n');
  }
  if (!result.results?.length) throw new Error('Individual Web OCR returned no results');
  return `${result.results.map((entry) => [
    `# ${entry.title || entry.url}`,
    '',
    `Source: ${entry.url}`,
    '',
    entry.content,
  ].join('\n')).join('\n\n---\n\n')}\n`;
}

export async function runWebExtraction(
  urls: string[],
  analysis: WebAnalysisMode,
  options: ResolvedCliOptions,
  signal: AbortSignal,
): Promise<WebExtractionResult> {
  if (options.provider !== 'gemini') {
    return runCompatibleWebExtraction(urls, analysis, options, signal);
  }
  const config = runtimeConfig(options);
  return extractTextFromUrls(
    urls,
    options.apiKey || (options.cloudflareByok ? options.gatewayToken || 'cloudflare-byok' : ''),
    analysis,
    options.model as GeminiModel,
    { level: options.thinking, includeThoughts: options.includeThoughts },
    signal,
    options.gateway === 'cloudflare' || options.baseUrl !== providerDefaultBaseUrl('gemini')
      ? {
          baseUrl: options.baseUrl,
          ...(options.gateway === 'cloudflare' ? { headers: providerRequestHeaders(config) } : {}),
        }
      : undefined,
  );
}

/** Resolve and preflight a Web OCR destination before any paid API request. */
export async function assertWebOutputAvailable(
  outputPath: string,
  cwd: string,
  overwrite: boolean,
): Promise<string> {
  const target = path.resolve(cwd, outputPath);
  if (overwrite) return target;
  try {
    // A dangling symlink still occupies the destination and must be rejected
    // before the URL-context request spends tokens.
    await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
    throw error;
  }
  throw new Error(`Output already exists: ${target} (use --overwrite)`);
}

export async function writeWebOutput(
  content: string,
  outputPath: string,
  cwd: string,
  overwrite: boolean,
): Promise<string> {
  const target = path.resolve(cwd, outputPath);
  await writeTextFileAtomically(target, content, overwrite);
  return target;
}
