import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertWebOutputAvailable,
  readableWebText,
  renderWebResult,
  resolveWebUrls,
  writeWebOutput,
} from './web';

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

  it('extracts structured HTML text and decodes named and numeric entities', () => {
    const html = [
      '<html><body><main>',
      '<h1>Invoice&nbsp;42</h1>',
      '<p>Seller: ACME &amp; Co<br>Total: &euro;10 &#x2B; tax</p>',
      '<ul><li>First item</li><li>Second item</li></ul>',
      '<script>doNotInclude()</script>',
      '</main></body></html>',
    ].join('');
    const text = readableWebText(new TextEncoder().encode(html), 'text/html');

    expect(text).toContain('INVOICE 42');
    expect(text).toContain('Seller: ACME & Co');
    expect(text).toContain('Total: €10 + tax');
    expect(text).toContain('First item');
    expect(text).not.toContain('doNotInclude');
  });

  it('protects output files unless overwrite is explicit', async () => {
    const target = await writeWebOutput('first', 'result.md', directory, false);
    await expect(writeWebOutput('second', 'result.md', directory, false)).rejects.toMatchObject({ code: 'EEXIST' });
    await writeWebOutput('second', 'result.md', directory, true);
    expect(await readFile(target, 'utf8')).toBe('second');
  });

  it('preflights an existing destination before Web OCR can spend API tokens', async () => {
    const target = path.join(directory, 'result.md');
    await writeFile(target, 'existing');
    await expect(assertWebOutputAvailable('result.md', directory, false)).rejects.toThrow(
      `Output already exists: ${target} (use --overwrite)`,
    );
    await expect(assertWebOutputAvailable('result.md', directory, true)).resolves.toBe(target);
    await expect(assertWebOutputAvailable('new.md', directory, false)).resolves.toBe(
      path.join(directory, 'new.md'),
    );
  });
});
