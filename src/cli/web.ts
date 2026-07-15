import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  dedupeRequestedUrls,
  extractTextFromUrls,
  type UrlResult,
} from '../lib/gemini/operations';
import { getUnsupportedUrls } from '../lib/urlValidation';
import type { ResolvedCliOptions } from './types';
import { writeTextFileAtomically } from './output';

export const WEB_ANALYSIS_MODES = ['individual', 'combined', 'comparison'] as const;
export type WebAnalysisMode = (typeof WEB_ANALYSIS_MODES)[number];
export type WebOutputFormat = 'markdown' | 'json';

export interface WebExtractionResult {
  results?: UrlResult[];
  combinedContent?: string;
  comparisonAnalysis?: string;
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
  return extractTextFromUrls(
    urls,
    options.apiKey,
    analysis,
    options.model,
    { level: options.thinking, includeThoughts: options.includeThoughts },
    signal,
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
