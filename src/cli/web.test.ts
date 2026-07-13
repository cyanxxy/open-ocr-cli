import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderWebResult, resolveWebUrls, writeWebOutput } from './web';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-web-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('CLI Web OCR', () => {
  it('merges arguments and URL files, ignores comments, and deduplicates', async () => {
    await writeFile(path.join(directory, 'urls.txt'), [
      '# reports',
      'https://example.com/report',
      'https://example.org/data.pdf',
      '',
    ].join('\n'));
    const urls = await resolveWebUrls(['https://example.com/report'], 'urls.txt', directory);
    expect(urls).toEqual(['https://example.com/report', 'https://example.org/data.pdf']);
  });

  it('rejects unsafe URLs and request groups above the API limit', async () => {
    await expect(resolveWebUrls(['http://localhost/private'], undefined, directory)).rejects.toThrow('Unsupported or unsafe');
    const tooMany = Array.from({ length: 21 }, (_, index) => `https://example.com/${index}`);
    await expect(resolveWebUrls(tooMany, undefined, directory)).rejects.toThrow('at most 20');
  });

  it('renders individual, combined, comparison, and JSON output', () => {
    const individual = {
      results: [{ url: 'https://example.com', title: 'Example', type: 'webpage' as const, content: 'Hello' }],
    };
    expect(renderWebResult(individual, 'individual', 'markdown')).toContain('# Example');
    expect(renderWebResult({ combinedContent: '# Combined' }, 'combined', 'markdown')).toBe('# Combined\n');
    expect(renderWebResult({ comparisonAnalysis: '# Comparison' }, 'comparison', 'markdown')).toBe('# Comparison\n');
    expect(renderWebResult(individual, 'individual', 'json')).toContain('"results"');
    expect(() => renderWebResult({}, 'individual', 'markdown')).toThrow('no results');
  });

  it('protects output files unless overwrite is explicit', async () => {
    const target = await writeWebOutput('first', 'result.md', directory, false);
    await expect(writeWebOutput('second', 'result.md', directory, false)).rejects.toMatchObject({ code: 'EEXIST' });
    await writeWebOutput('second', 'result.md', directory, true);
    expect(await readFile(target, 'utf8')).toBe('second');
  });
});
