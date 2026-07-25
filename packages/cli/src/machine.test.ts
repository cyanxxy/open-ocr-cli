import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeOcrJobRequest, readStandardInput } from './machine';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
const originalNoConfig = process.env.OPEN_OCR_NO_CONFIG;
const originalProvider = process.env.OPEN_OCR_PROVIDER;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'open-ocr-machine-'));
  delete process.env.OPEN_OCR_PROVIDER;
});

afterEach(async () => {
  if (originalNoConfig === undefined) delete process.env.OPEN_OCR_NO_CONFIG;
  else process.env.OPEN_OCR_NO_CONFIG = originalNoConfig;
  if (originalProvider === undefined) delete process.env.OPEN_OCR_PROVIDER;
  else process.env.OPEN_OCR_PROVIDER = originalProvider;
  await rm(directory, { recursive: true, force: true });
});

describe('machine request execution', () => {
  it('destroys a blocked request stdin stream when aborted', async () => {
    const input = new PassThrough();
    const abortController = new AbortController();
    const reading = readStandardInput(abortController.signal, input);

    input.write('{"protocolVersion":2');
    abortController.abort(new Error('Interrupted by SIGINT'));

    await expect(reading).rejects.toThrow('Interrupted by SIGINT');
    expect(input.destroyed).toBe(true);
  });

  it('loads only the explicit config when execution disables ambient config', async () => {
    await writeFile(path.join(directory, 'invoice.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'agent-config.json'), JSON.stringify({
      concurrency: 7,
      model: 'gemini-3.1-flash-lite',
    }));
    await writeFile(path.join(directory, '.open-ocr-cli.json'), JSON.stringify({
      provider: 'kimi',
      model: 'kimi-k3',
      mode: 'agentic',
    }));

    const execution = await executeOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      configPath: 'agent-config.json',
      delivery: { mode: 'inline' },
      dryRun: true,
    }, {
      cwd: directory,
      runId: 'explicit-config-hermetic-run',
      abortController: new AbortController(),
      noConfig: true,
    });

    expect(execution.summary).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      mode: 'simple',
      failed: 0,
    });
  });

  it('honors OPEN_OCR_NO_CONFIG for protocol runs', async () => {
    await writeFile(path.join(directory, 'invoice.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, '.open-ocr-cli.json'), JSON.stringify({
      provider: 'kimi',
      model: 'kimi-k3',
    }));
    await writeFile(path.join(directory, '.env'), 'OPEN_OCR_PROVIDER=kimi\n');
    process.env.OPEN_OCR_NO_CONFIG = '1';

    const execution = await executeOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      delivery: { mode: 'inline' },
      dryRun: true,
    }, {
      cwd: directory,
      runId: 'hermetic-run',
      abortController: new AbortController(),
    });

    expect(execution.summary).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      failed: 0,
    });
    expect(process.env.OPEN_OCR_PROVIDER).toBeUndefined();
  });

  it('routes URL dry runs through the shared job service', async () => {
    const execution = await executeOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [
        { type: 'url', url: 'https://example.com/article' },
        { type: 'url', url: 'https://example.com/report.pdf' },
      ],
      web: { analysis: 'comparison' },
      extraction: { mode: 'simple', contentFormat: 'markdown' },
      delivery: { mode: 'inline' },
      dryRun: true,
    }, {
      cwd: directory,
      runId: 'url-dry-run',
      abortController: new AbortController(),
      noConfig: true,
    });

    expect(execution.result).toMatchObject({
      status: 'validated',
      total: 1,
      failed: 0,
      documents: [{ status: 'skipped', skipReason: 'validated' }],
    });
  });
});
