import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExtractStructuredDataFromFile, mockExtractTextFromFile } = vi.hoisted(() => ({
  mockExtractStructuredDataFromFile: vi.fn(),
  mockExtractTextFromFile: vi.fn(),
}));

vi.mock('../../../src/lib/gemini/extraction', () => ({
  extractStructuredDataFromFile: mockExtractStructuredDataFromFile,
  extractTextFromFile: mockExtractTextFromFile,
}));

import { resolveCliOptions } from './config';
import { discoverInputs } from './inputs';
import { runBatch } from './runner';
import { BatchOutputLock } from './output';
import { cliExitCode } from './errors';
import { recordGeminiUsage } from '../../../src/lib/gemini/usage';
import type { GeminiClientConfig } from '../../../src/lib/gemini/types';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
let directory: string;
let outputDirectory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-live-runner-'));
  outputDirectory = path.join(directory, 'results');
  process.env.GEMINI_API_KEY = 'test-key';
  mockExtractTextFromFile.mockReset();
  mockExtractStructuredDataFromFile.mockReset();
  mockExtractTextFromFile.mockResolvedValue({
    title: 'Extracted document',
    sections: [{ content: ['Hello from OCR'] }],
  });
  mockExtractStructuredDataFromFile.mockResolvedValue({ invoice_number: 'INV-42', total: 12.5 });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
});

describe('CLI live batch orchestration', () => {
  it('rejects concurrent ownership before spending Gemini requests', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'two.jpg'), JPEG_BYTES);
    const options = resolveCliOptions({ output: outputDirectory, quiet: true }, {}, directory);
    const inputs = await discoverInputs(['*.jpg'], options);
    const lock = await BatchOutputLock.acquire(outputDirectory);
    try {
      let thrown: unknown;
      try {
        await runBatch(inputs, options, {
          abortController: new AbortController(),
          writeStdout: () => undefined,
          writeStderr: () => undefined,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain('Batch output directory is already in use');
      expect(cliExitCode(thrown)).toBe(2);
      expect(mockExtractTextFromFile).not.toHaveBeenCalled();
    } finally {
      await lock.release();
    }
  });

  it('rejects existing non-resumable artifacts before spending Gemini requests', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'two.jpg'), JPEG_BYTES);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, 'one.md'), 'existing output\n');
    const options = resolveCliOptions({ output: outputDirectory, quiet: true }, {}, directory);
    const inputs = await discoverInputs(['*.jpg'], options);

    let thrown: unknown;
    try {
      await runBatch(inputs, options, {
        abortController: new AbortController(),
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('Output already exists before extraction');
    expect(cliExitCode(thrown)).toBe(2);
    expect(mockExtractTextFromFile).not.toHaveBeenCalled();
  });

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
    expect(second.results.map((result) => result.outputFiles)).toEqual([
      [path.join(outputDirectory, 'one.md')],
      [path.join(outputDirectory, 'two.md')],
    ]);
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

  it('extracts and writes caller-defined schema output', async () => {
    await writeFile(path.join(directory, 'schema.jpg'), JPEG_BYTES);
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { invoice_number: { type: 'string' }, total: { type: 'number' } },
      required: ['invoice_number', 'total'],
    };
    const options = {
      ...resolveCliOptions({ schema: 'invoice.schema.json', output: outputDirectory, quiet: true }, {}, directory),
      customSchema: schema,
    };
    const inputs = await discoverInputs(['schema.jpg'], options);
    const summary = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(summary.succeeded).toBe(1);
    expect(mockExtractStructuredDataFromFile).toHaveBeenCalledWith(
      expect.any(String),
      'image/jpeg',
      expect.objectContaining({ model: 'gemini-3.5-flash' }),
      schema,
      undefined,
      expect.objectContaining({ maxTokens: 32768 }),
    );
    expect(await readFile(path.join(outputDirectory, 'schema.json'), 'utf8')).toContain('INV-42');
  });

  it('stops scheduling new documents when the estimated cost ceiling is reached', async () => {
    await writeFile(path.join(directory, 'a.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'b.jpg'), JPEG_BYTES);
    mockExtractTextFromFile.mockImplementation((
      _fileData: string,
      _mimeType: string,
      clientConfig: GeminiClientConfig,
    ) => {
      recordGeminiUsage({
        usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 100, totalTokenCount: 1_100 },
      }, 'gemini-3.5-flash', clientConfig.runtime);
      return Promise.resolve({ sections: [{ content: ['Costed result'] }] });
    });
    const options = resolveCliOptions({
      output: outputDirectory,
      quiet: true,
      concurrency: '1',
      maxCost: '0.000001',
    }, {}, directory);
    const inputs = await discoverInputs(['*.jpg'], options);
    const summary = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(summary).toMatchObject({ total: 2, succeeded: 1, skipped: 1, costLimitReached: true });
    expect(summary.usage.estimatedCostUsd).toBeGreaterThan(options.maxCostUsd!);
    expect(summary.results[1].error).toContain('--max-cost');
    expect(mockExtractTextFromFile).toHaveBeenCalledTimes(1);
  });
});
