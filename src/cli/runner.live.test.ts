import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExtractTextFromFile } = vi.hoisted(() => ({
  mockExtractTextFromFile: vi.fn(),
}));

vi.mock('../lib/gemini/extraction', () => ({
  extractTextFromFile: mockExtractTextFromFile,
}));

import { resolveCliOptions } from './config';
import { discoverInputs } from './inputs';
import { runBatch } from './runner';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
let directory: string;
let outputDirectory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-live-runner-'));
  outputDirectory = path.join(directory, 'results');
  process.env.GEMINI_API_KEY = 'test-key';
  mockExtractTextFromFile.mockReset();
  mockExtractTextFromFile.mockResolvedValue({
    title: 'Extracted document',
    sections: [{ content: ['Hello from OCR'] }],
  });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
});

describe('CLI live batch orchestration', () => {
  it('writes batch artifacts and resumes unchanged documents', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'two.jpg'), JPEG_BYTES);
    const options = resolveCliOptions(
      { output: outputDirectory, quiet: true, concurrency: '2' },
      {},
      directory,
    );
    const inputs = await discoverInputs(['*.jpg'], options);

    const first = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(first).toMatchObject({ total: 2, succeeded: 2, partial: 0, failed: 0 });
    expect(first.results.every((result) => result.artifacts === undefined)).toBe(true);
    expect(mockExtractTextFromFile).toHaveBeenCalledTimes(2);
    expect(await readFile(path.join(outputDirectory, 'one.md'), 'utf8')).toContain('Hello from OCR');
    expect(await readFile(path.join(outputDirectory, 'batch-summary.json'), 'utf8')).toContain('"succeeded": 2');

    const second = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(second).toMatchObject({ succeeded: 0, skipped: 2, failed: 0 });
    expect(mockExtractTextFromFile).toHaveBeenCalledTimes(2);
  });

  it('resumes partial outputs without colliding with their existing artifacts', async () => {
    await writeFile(path.join(directory, 'partial.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'second.jpg'), JPEG_BYTES);
    const options = resolveCliOptions({ output: outputDirectory, quiet: true }, {}, directory);
    const inputs = await discoverInputs(['*.jpg'], options);
    await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });

    const manifestPath = path.join(outputDirectory, '.gemini-ocr-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      entries: Record<string, { status: string }>;
    };
    for (const entry of Object.values(manifest.entries)) entry.status = 'partial';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const resumed = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(resumed).toMatchObject({ total: 2, succeeded: 0, failed: 0, skipped: 2 });
    expect(mockExtractTextFromFile).toHaveBeenCalledTimes(2);
  });

  it('validates every input during dry runs even when the resume manifest matches', async () => {
    await writeFile(path.join(directory, 'valid.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'other.jpg'), JPEG_BYTES);
    const options = resolveCliOptions({ output: outputDirectory, quiet: true }, {}, directory);
    const inputs = await discoverInputs(['*.jpg'], options);
    await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    await writeFile(inputs[0].absolutePath!, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));

    const dryRun = await runBatch(inputs, { ...options, dryRun: true }, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(dryRun).toMatchObject({ total: 2, failed: 1, skipped: 1 });
    expect(dryRun.results[0].error).toContain('does not match its declared type');
    expect(mockExtractTextFromFile).toHaveBeenCalledTimes(2);
  });

  it('represents the unscheduled fail-fast remainder explicitly', async () => {
    await writeFile(path.join(directory, 'a.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'b.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'c.jpg'), JPEG_BYTES);
    mockExtractTextFromFile.mockRejectedValue(new Error('invalid request'));
    const options = resolveCliOptions(
      { output: outputDirectory, quiet: true, concurrency: '1', retries: '0', failFast: true },
      {},
      directory,
    );
    const inputs = await discoverInputs(['*.jpg'], options);

    const summary = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(summary).toMatchObject({ total: 3, failed: 1, skipped: 2 });
    expect(summary.results).toHaveLength(3);
    expect(summary.results.slice(1).every((result) => (
      result.status === 'skipped'
      && result.attempts === 0
      && result.error?.includes('--fail-fast')
    ))).toBe(true);
    expect(mockExtractTextFromFile).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and records the true attempt count', async () => {
    await writeFile(path.join(directory, 'retry.jpg'), JPEG_BYTES);
    const transientError = Object.assign(new Error('rate limited'), { status: 429 });
    mockExtractTextFromFile.mockRejectedValueOnce(transientError).mockResolvedValueOnce({
      sections: [{ content: ['Recovered'] }],
    });
    const options = resolveCliOptions(
      { output: outputDirectory, quiet: true, retries: '1' },
      {},
      directory,
    );
    const inputs = await discoverInputs(['retry.jpg'], options);
    const summary = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(summary.succeeded).toBe(1);
    expect(summary.results[0].attempts).toBe(2);
    expect(mockExtractTextFromFile).toHaveBeenCalledTimes(2);
  });
});
