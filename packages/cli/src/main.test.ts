import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeOcrJobRequest: vi.fn(),
  promptInteractiveArguments: vi.fn(),
  readOcrJobRequest: vi.fn(),
  readOcrJobRequestRaw: vi.fn(),
  runBatch: vi.fn(),
  runWebJob: vi.fn(),
}));

vi.mock('./interactive', () => ({
  promptInteractiveArguments: mocks.promptInteractiveArguments,
}));

vi.mock('./machine', () => ({
  executeOcrJobRequest: mocks.executeOcrJobRequest,
  readOcrJobRequest: mocks.readOcrJobRequest,
  readOcrJobRequestRaw: mocks.readOcrJobRequestRaw,
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
    runWebJob: mocks.runWebJob,
  };
});

vi.mock('./runner', () => ({
  runBatch: mocks.runBatch,
}));

import { CliExitError, cliExitCode } from './errors';
import { cliBinaryName, cliVersion, createProgram, main } from './main';

const originalApiKey = process.env.GEMINI_API_KEY;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-main-'));
  process.env.GEMINI_API_KEY = 'test-key';
  process.exitCode = undefined;
  mocks.runWebJob.mockReset();
  mocks.runBatch.mockReset();
  mocks.promptInteractiveArguments.mockReset();
  mocks.executeOcrJobRequest.mockReset();
  mocks.readOcrJobRequest.mockReset();
  mocks.readOcrJobRequestRaw.mockReset();
  mocks.readOcrJobRequestRaw.mockImplementation(async (...args: unknown[]) => {
    const request = await mocks.readOcrJobRequest(...args);
    return {
      raw: JSON.stringify(request),
      parsed: request,
      declaredProtocolVersion: request?.protocolVersion === 1 || request?.protocolVersion === 2
        ? request.protocolVersion
        : undefined,
    };
  });
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
    expect(cliBinaryName(['node', '/workspace/packages/cli/src/index.ts'])).toBe('open-ocr-cli');
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(cliVersion()).not.toBe('0.0.0');
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

  it('validates a custom schema before requiring provider credentials', async () => {
    delete process.env.GEMINI_API_KEY;
    const schema = path.join(directory, 'invalid.schema.json');
    await writeFile(schema, '{ not valid JSON');

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node',
        'open-ocr-cli',
        'extract',
        path.join(directory, 'document.png'),
        '--schema',
        schema,
        '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 'SCHEMA_INVALID',
    });
    expect((thrown as Error).message).toContain('Invalid JSON in schema');
    expect((thrown as Error).message).not.toContain('API key is missing');
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('does not mix protocol events into the established extract --jsonl stream', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let thrown: unknown;
    let output = '';
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', path.join(directory, 'missing.png'),
        '--jsonl', '--dry-run', '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
    }
    expect(thrown).toMatchObject({ code: 'INPUT_NOT_FOUND' });
    expect(output).toBe('');
  });

  it.each([
    ['--config', 'config.json', '--no-config'],
    ['--no-config', '--config', 'config.json'],
  ])('rejects --config and --no-config regardless of argument order (%s)', async (...flags: string[]) => {
    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', 'invoice.png', '--dry-run', '--quiet', ...flags,
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'CONFIG_INVALID',
      message: '--config and --no-config are mutually exclusive',
    });
  });

  it('classifies Web OCR runtime failures as exit code 1', async () => {
    mocks.runWebJob.mockRejectedValueOnce(new Error('Gemini request failed'));

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
    expect(mocks.runWebJob).not.toHaveBeenCalled();
  });

  it('reports an explicit skipped credential probe without making a request', async () => {
    delete process.env.GEMINI_API_KEY;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'doctor', '--no-config', '--check-credentials', '--json',
      ]);
      const report = JSON.parse(stdout.mock.calls.flat().join('')) as {
        credentialProbe: { status: string; error?: string };
      };
      expect(report.credentialProbe).toMatchObject({
        status: 'skipped',
        error: expect.stringContaining('GEMINI_API_KEY'),
      });
      expect(process.exitCode).toBe(1);
    } finally {
      stdout.mockRestore();
    }
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
      expect(capabilities).toMatchObject({
        protocolVersion: 2,
        supportedProtocolVersions: [1, 2],
        schemaAccess: { networkFetch: false },
      });

      stdout.mockClear();
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'schema', 'request']);
      const schema = JSON.parse(stdout.mock.calls.flat().join('')) as { $id: string };
      expect(schema.$id).toContain('request-v2.schema.json');

      stdout.mockClear();
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'schema', 'request-v1']);
      const legacySchema = JSON.parse(stdout.mock.calls.flat().join('')) as { $id: string };
      expect(legacySchema.$id).toContain('request-v1.schema.json');
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

  it('aborts a pending request stdin read on SIGINT and exits 130', async () => {
    mocks.readOcrJobRequestRaw.mockImplementationOnce(async (
      _requestPath: string,
      _cwd: string,
      signal: AbortSignal,
    ) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(
        signal.reason instanceof Error ? signal.reason : new Error('Operation aborted'),
      ), { once: true });
      queueMicrotask(() => process.emit('SIGINT'));
    }));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'run', '--request', '-', '--response-format', 'json',
      ]);
      expect(mocks.readOcrJobRequestRaw).toHaveBeenCalledWith(
        '-',
        process.cwd(),
        expect.any(AbortSignal),
      );
      expect(process.exitCode).toBe(130);
    } finally {
      stdout.mockRestore();
    }
  });

  it('waits for stdout backpressure before completing a machine response', async () => {
    mocks.readOcrJobRequest.mockResolvedValueOnce({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
    });
    mocks.executeOcrJobRequest.mockResolvedValueOnce({
      result: {
        protocolVersion: 2,
        type: 'run.result',
        ok: true,
        runId: 'backpressure-run',
        status: 'validated',
        documents: [],
      },
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      queueMicrotask(() => process.stdout.emit('drain'));
      return false;
    });
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'run', '--request', 'request.json', '--response-format', 'json',
      ]);
      expect(stdout).toHaveBeenCalledOnce();
      expect(process.exitCode).toBeUndefined();
    } finally {
      stdout.mockRestore();
    }
  });

  it('preserves exit code 1 for a partial machine result', async () => {
    mocks.readOcrJobRequest.mockResolvedValueOnce({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
    });
    mocks.executeOcrJobRequest.mockResolvedValueOnce({
      result: {
        protocolVersion: 1,
        type: 'run.result',
        ok: false,
        runId: 'partial-run',
        status: 'partial',
        documents: [],
      },
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'run', '--request', 'request.json', '--response-format', 'json',
      ]);
      expect(process.exitCode).toBe(1);
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

  it('prints help without prompting even when stdin and stderr are TTYs', async () => {
    const restoreTTY = setTTY(true);
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
