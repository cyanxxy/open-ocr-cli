import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeOcrJobRequest: vi.fn(),
  promptInteractiveArguments: vi.fn(),
  readOcrJobRequest: vi.fn(),
  runBatch: vi.fn(),
  runWebExtraction: vi.fn(),
}));

vi.mock('./interactive', () => ({
  promptInteractiveArguments: mocks.promptInteractiveArguments,
}));

vi.mock('./machine', () => ({
  executeOcrJobRequest: mocks.executeOcrJobRequest,
  readOcrJobRequest: mocks.readOcrJobRequest,
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

import { CliExitError, cliExitCode } from './errors';
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
  mocks.executeOcrJobRequest.mockReset();
  mocks.readOcrJobRequest.mockReset();
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

describe('agent machine commands', () => {
  it('emits capabilities and bundled schemas as machine-readable JSON', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'capabilities', '--json']);
      const capabilities = JSON.parse(stdout.mock.calls.flat().join('')) as {
        protocolVersion: number;
        schemaAccess: { networkFetch: boolean };
      };
      expect(capabilities).toMatchObject({ protocolVersion: 1, schemaAccess: { networkFetch: false } });

      stdout.mockClear();
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'schema', 'request']);
      const schema = JSON.parse(stdout.mock.calls.flat().join('')) as { $id: string };
      expect(schema.$id).toContain('request-v1.schema.json');
    } finally {
      stdout.mockRestore();
    }
  });

  it('serializes a successful run result and preserves exit status zero', async () => {
    mocks.readOcrJobRequest.mockResolvedValueOnce({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
    });
    mocks.executeOcrJobRequest.mockResolvedValueOnce({
      result: {
        protocolVersion: 1,
        type: 'run.result',
        ok: true,
        runId: 'run-1',
        status: 'validated',
        documents: [],
      },
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'run', '--request', 'request.json', '--response-format', 'json',
      ]);
      expect(JSON.parse(stdout.mock.calls.flat().join(''))).toMatchObject({
        type: 'run.result',
        ok: true,
        status: 'validated',
      });
      expect(process.exitCode).toBeUndefined();
    } finally {
      stdout.mockRestore();
    }
  });

  it('emits exactly one typed JSONL failure and exit code 2 for an invalid request', async () => {
    mocks.readOcrJobRequest.mockRejectedValueOnce(new CliExitError(
      'OCR request extraction.preset cannot be combined with extraction.schema.',
      2,
      { code: 'CONFIG_INVALID', category: 'configuration', retryable: false },
    ));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'run', '--request', 'request.json', '--response-format', 'jsonl',
      ]);
      const lines = stdout.mock.calls.flat().join('').trim().split('\n').map((line) => JSON.parse(line) as {
        type: string;
        error: { code: string };
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ type: 'run.failed', error: { code: 'CONFIG_INVALID' } });
      expect(process.exitCode).toBe(2);
    } finally {
      stdout.mockRestore();
    }
  });

  it('does not duplicate a JSONL run.failed event already emitted by the service', async () => {
    mocks.readOcrJobRequest.mockResolvedValueOnce({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
    });
    const serviceError = new CliExitError('Provider failed', 1, {
      code: 'PROVIDER_FAILURE', category: 'provider', retryable: false,
    });
    mocks.executeOcrJobRequest.mockImplementationOnce((
      _request: unknown,
      execution: { eventSink?: (event: Record<string, unknown>) => void | Promise<void> },
    ) => {
      void execution.eventSink?.({
        protocolVersion: 1,
        type: 'run.failed',
        runId: 'run-1',
        sequence: 0,
        timestamp: new Date().toISOString(),
        error: {
          code: 'PROVIDER_FAILURE', category: 'provider', message: 'Provider failed', retryable: false,
        },
      });
      return Promise.reject(serviceError);
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'run', '--request', 'request.json', '--response-format', 'jsonl',
      ]);
      const lines = stdout.mock.calls.flat().join('').trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ type: 'run.failed' });
      expect(process.exitCode).toBe(1);
    } finally {
      stdout.mockRestore();
    }
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
