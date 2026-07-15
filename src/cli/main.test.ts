import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  promptInteractiveArguments: vi.fn(),
  runBatch: vi.fn(),
  runWebExtraction: vi.fn(),
}));

vi.mock('./interactive', () => ({
  promptInteractiveArguments: mocks.promptInteractiveArguments,
}));

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return {
    ...actual,
    loadCliConfig: vi.fn(() => Promise.resolve({})),
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
import { cliBinaryName, createProgram, main } from './main';

const originalApiKey = process.env.GEMINI_API_KEY;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-main-'));
  process.env.GEMINI_API_KEY = 'test-key';
  process.exitCode = undefined;
  mocks.runWebExtraction.mockReset();
  mocks.runBatch.mockReset();
  mocks.promptInteractiveArguments.mockReset();
});

afterEach(async () => {
  process.exitCode = undefined;
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  await rm(directory, { recursive: true, force: true });
});

describe('CLI identity', () => {
  it('uses Open OCR CLI as the primary name and preserves the Gemini alias', () => {
    const help = createProgram().helpInformation();
    expect(help).toContain('Usage: open-ocr-cli');
    expect(help).toContain('interactive|i');
    expect(createProgram('gemini-ocr').helpInformation()).toContain('Usage: gemini-ocr');
    expect(cliBinaryName(['node', '/usr/local/bin/open-ocr-cli'])).toBe('open-ocr-cli');
    expect(cliBinaryName(['node', '/usr/local/bin/gemini-ocr'])).toBe('gemini-ocr');
    expect(cliBinaryName(['node', '/workspace/src/cli/index.ts'])).toBe('open-ocr-cli');
  });
});

describe('CLI command exit contracts', () => {
  it('maps Commander usage errors through main() to exit code 2', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await main(['node', 'open-ocr-cli', 'extract']);
    expect(process.exitCode).toBe(2);
    stderr.mockRestore();
  });

  it('classifies Commander usage errors as exit code 2', async () => {
    let thrown: unknown;
    try {
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'extract']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(cliExitCode(thrown)).toBe(2);
  });

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

describe('bare CLI invocation', () => {
  function setTTY(value: boolean): () => void {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stderrDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value });
    return () => {
      if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
      if (stderrDescriptor) Object.defineProperty(process.stderr, 'isTTY', stderrDescriptor);
      else Reflect.deleteProperty(process.stderr, 'isTTY');
    };
  }

  it('opens the guided menu when stdin and the prompt stream are TTYs', async () => {
    const restoreTTY = setTTY(true);
    mocks.promptInteractiveArguments.mockResolvedValueOnce(undefined);
    try {
      await main(['node', 'open-ocr-cli']);
      expect(mocks.promptInteractiveArguments).toHaveBeenCalledOnce();
    } finally {
      restoreTTY();
    }
  });

  it('prints help without prompting for a non-TTY bare invocation', async () => {
    const restoreTTY = setTTY(false);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await main(['node', 'open-ocr-cli']);
      expect(mocks.promptInteractiveArguments).not.toHaveBeenCalled();
      expect(stdout.mock.calls.flat().join('')).toContain('Usage: open-ocr-cli');
    } finally {
      stdout.mockRestore();
      restoreTTY();
    }
  });
});
