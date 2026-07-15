import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  runWebExtraction: vi.fn(),
}));

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return {
    ...actual,
    loadCliConfig: vi.fn(async () => ({})),
    loadLocalEnv: vi.fn(),
  };
});

vi.mock('./web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./web')>();
  return {
    ...actual,
    runWebExtraction: mocks.runWebExtraction,
  };
});

vi.mock('./runner', () => ({
  runBatch: mocks.runBatch,
}));

import { cliExitCode } from './errors';
import { cliBinaryName, createProgram } from './main';

const originalApiKey = process.env.GEMINI_API_KEY;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-main-'));
  process.env.GEMINI_API_KEY = 'test-key';
  process.exitCode = undefined;
  mocks.runWebExtraction.mockReset();
  mocks.runBatch.mockReset();
});

afterEach(async () => {
  process.exitCode = undefined;
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  await rm(directory, { recursive: true, force: true });
});

describe('CLI identity', () => {
  it('uses Open OCR CLI as the primary name and preserves the Gemini alias', () => {
    expect(createProgram().helpInformation()).toContain('Usage: open-ocr-cli');
    expect(createProgram('gemini-ocr').helpInformation()).toContain('Usage: gemini-ocr');
    expect(cliBinaryName(['node', '/usr/local/bin/open-ocr-cli'])).toBe('open-ocr-cli');
    expect(cliBinaryName(['node', '/usr/local/bin/gemini-ocr'])).toBe('gemini-ocr');
    expect(cliBinaryName(['node', '/workspace/src/cli/index.ts'])).toBe('open-ocr-cli');
  });
});

describe('CLI command exit contracts', () => {
  it('classifies batch execution failures as exit code 1', async () => {
    const input = path.join(directory, 'document.jpg');
    await writeFile(input, new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]));
    mocks.runBatch.mockRejectedValueOnce(new Error('Could not persist batch summary'));

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node',
        'gemini-ocr',
        'extract',
        input,
        '--quiet',
        '--force-unlock',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not persist batch summary');
    expect(cliExitCode(thrown)).toBe(1);
    expect(mocks.runBatch.mock.calls[0]?.[1]).toMatchObject({ forceUnlock: true });
  });

  it('classifies Web OCR runtime failures as exit code 1', async () => {
    mocks.runWebExtraction.mockRejectedValueOnce(new Error('Gemini request failed'));

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node',
        'gemini-ocr',
        'web',
        'https://example.com/report',
        '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Gemini request failed');
    expect(cliExitCode(thrown)).toBe(1);
  });

  it('rejects an existing Web output before starting a Gemini request', async () => {
    const output = path.join(directory, 'result.md');
    await writeFile(output, 'existing');

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node',
        'gemini-ocr',
        'web',
        'https://example.com/report',
        '--output',
        output,
        '--dry-run',
        '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(`Output already exists: ${output}`);
    expect(cliExitCode(thrown)).toBe(2);
    expect(mocks.runWebExtraction).not.toHaveBeenCalled();
  });
});
