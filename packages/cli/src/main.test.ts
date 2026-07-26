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

import { CliExitError, cliExitCode, ocrErrorPayload } from './errors';
import { cliBinaryName, cliVersion, createProgram, main, requestedExtractJsonlStream } from './main';

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

  it('ends a failed extract --jsonl stream with exactly one CLI-native error record', async () => {
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
    const records = output.trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    // Pre-flight rejection: discovery fails before runBatch is ever entered, so
    // this record can only come from the command's own terminal emitter.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: 'error',
      version: 1,
      error: { code: 'INPUT_NOT_FOUND', category: 'input', retryable: false },
    });
    // The terminal record belongs to the same CLI-native family as the document
    // and summary lines. A protocol envelope here would make the failure line
    // the only schema-valid line on an otherwise CLI-native stream.
    expect(records[0]).not.toHaveProperty('protocolVersion');
    expect(records[0]).not.toHaveProperty('runId');
    expect(records[0]).not.toHaveProperty('sequence');
    expect(records[0]).not.toHaveProperty('timestamp');
    expect(records.map((record) => record.type)).not.toContain('run.failed');
  });

  it('reports a mid-run fatal on the --jsonl stream without duplicating it', async () => {
    const input = path.join(directory, 'document.jpg');
    await writeFile(input, new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]));
    mocks.runBatch.mockRejectedValueOnce(new CliExitError('Output already exists: report.md', 2, {
      code: 'OUTPUT_CONFLICT',
      category: 'output',
      retryable: false,
      hint: 'Choose a new output path or resume a matching job.',
    }));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let thrown: unknown;
    let output = '';
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input, '--jsonl', '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
    }

    expect(cliExitCode(thrown)).toBe(2);
    const records = output.trim().split('\n');
    expect(records).toHaveLength(1);
    expect(JSON.parse(records[0]) as unknown).toMatchObject({
      type: 'error',
      version: 1,
      error: { code: 'OUTPUT_CONFLICT', category: 'output' },
    });
  });

  it('adds no second terminal record when a cancelled batch already ended the --jsonl stream', async () => {
    const input = path.join(directory, 'document.jpg');
    await writeFile(input, new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]));
    // The service turns cancellation into skipped results and returns normally,
    // so the summary is written before anything downstream can fail.
    mocks.runBatch.mockImplementationOnce((
      _inputs: unknown,
      _options: unknown,
      runtime: { onTerminalRecord?: () => void },
    ) => {
      process.emit('SIGINT');
      runtime.onTerminalRecord?.();
      return Promise.reject(new Error('Interrupted by SIGINT'));
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let output = '';
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input, '--jsonl', '--quiet',
      ]);
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
    }

    expect(output).toBe('');
    expect(process.exitCode).toBe(130);
  });

  it('ends a cancelled --jsonl run that died before its summary with one error record', async () => {
    const input = path.join(directory, 'document.jpg');
    await writeFile(input, new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]));
    mocks.runBatch.mockImplementationOnce(() => {
      process.emit('SIGINT');
      return Promise.reject(new Error('Interrupted by SIGINT'));
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let output = '';
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input, '--jsonl', '--quiet',
      ]);
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
    }

    // No summary exists, so the interrupt owes the stream its terminal record.
    const records = output.trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: 'error',
      version: 1,
      error: { code: 'CANCELLED', category: 'cancelled' },
    });
    expect(process.exitCode).toBe(130);
  });

  it('ends a --jsonl run interrupted during pre-flight with one cancelled record', async () => {
    const { loadCliConfig } = await import('./config');
    // Pre-flight work happens before runBatch exists, so this is the window
    // where an interrupt used to reach Node's default SIGINT handler and kill
    // the process with no record on the stream at all.
    vi.mocked(loadCliConfig).mockImplementationOnce(() => {
      process.emit('SIGINT');
      return Promise.reject(new Error('Interrupted by SIGINT'));
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let thrown: unknown;
    let output = '';
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', path.join(directory, 'document.jpg'), '--jsonl', '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
    }

    // Cancellation is an exit status, not a usage error: reported, not rethrown.
    expect(thrown).toBeUndefined();
    const records = output.trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: 'error',
      version: 1,
      error: { code: 'CANCELLED', category: 'cancelled' },
    });
    expect(process.exitCode).toBe(130);
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('leaves stdout untouched on failure when --jsonl was not requested', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let output = '';
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', path.join(directory, 'missing.png'), '--quiet',
      ]);
    } catch {
      // The typed error is asserted elsewhere; this covers stream discipline.
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
    }
    expect(output).toBe('');
  });

  // A parse failure never reaches the action body, so the stream's own terminal
  // emitter cannot run. Left alone these paths end in zero records while a bad
  // option *value* ends in one, forcing a consumer to treat empty stdout as a
  // third outcome alongside "succeeded" and "failed".
  it.each([
    ['unknown option', ['extract', 'document.jpg', '--jsonl', '--totally-bogus'], 'unknown option'],
    ['missing operand', ['extract', '--jsonl'], 'missing required argument'],
  ])('ends a --jsonl run rejected by the parser (%s) with one error record', async (
    _label: string,
    args: string[],
    expectedMessage: string,
  ) => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let output = '';
    try {
      await main(['node', 'open-ocr-cli', ...args]);
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
      stderr.mockRestore();
    }

    const records = output.trim().split('\n').map((line) => JSON.parse(line) as {
      type: string;
      error: { code: string; message: string; hint?: string };
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: 'error',
      version: 1,
      error: { code: 'CONFIG_INVALID', category: 'configuration', retryable: false },
    });
    expect(records[0].error.message).toContain(expectedMessage);
    // Commander prefixes its own prose with "error:"; the typed record already
    // says it is an error, so the message must not repeat it.
    expect(records[0].error.message).not.toMatch(/^error:/);
    expect(records[0].error.hint).toContain('--help');
    expect(process.exitCode).toBe(2);
  });

  it('keeps parser failures off stdout when --jsonl was not requested', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let output = '';
    try {
      await main(['node', 'open-ocr-cli', 'extract', 'document.jpg', '--totally-bogus']);
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
      stderr.mockRestore();
    }
    expect(output).toBe('');
    expect(process.exitCode).toBe(2);
  });

  it('recognises an extract --jsonl request from unparsed argv', () => {
    const asks = (...args: string[]): boolean => requestedExtractJsonlStream(['node', 'open-ocr-cli', ...args]);
    expect(asks('extract', 'a.png', '--jsonl', '--bogus')).toBe(true);
    expect(asks('extract', '--jsonl', '-')).toBe(true);
    expect(asks('extract', 'a.png')).toBe(false);
    // Another command's failure must not borrow the extract stream.
    expect(asks('run', '--request', 'r.json', '--jsonl')).toBe(false);
    expect(asks('bogus-command', '--jsonl')).toBe(false);
    // After `--` every token is an operand, so a file literally named --jsonl
    // is an input, not a request for the stream.
    expect(asks('extract', '--', '--jsonl')).toBe(false);
  });

  it('leaves stdout untouched when the parser exits successfully', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let output = '';
    try {
      // --help and --version are CommanderError throws too, but successful ones.
      // Emitting a failure record for them would report a run that never failed.
      await main(['node', 'open-ocr-cli', 'extract', '--jsonl', '--help']);
    } finally {
      output = stdout.mock.calls.flat().join('');
      stdout.mockRestore();
    }
    // Assert structurally rather than by substring: the --jsonl help text names
    // the record types, so prose alone would trip a substring check.
    const records = output.split('\n').filter((line) => line.startsWith('{'));
    expect(records).toEqual([]);
    expect(process.exitCode).toBeUndefined();
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

  it('reports a missing input before a missing credential', async () => {
    delete process.env.GEMINI_API_KEY;

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', path.join(directory, 'missing.png'), '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    // capabilities advertises credential-free-dry-run, so a live run and a dry
    // run must agree on the first error for identical input.
    expect(thrown).toMatchObject({ code: 'INPUT_NOT_FOUND' });
    expect((thrown as Error).message).not.toContain('API key is missing');
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('reports an out-of-range numeric flag as a configuration error, not a retryable timeout', async () => {
    delete process.env.GEMINI_API_KEY;
    const input = path.join(directory, 'document.png');
    await writeFile(input, 'binary');

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input, '--timeout', '0', '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 'CONFIG_INVALID',
      category: 'configuration',
      retryable: false,
    });
    expect((thrown as Error).message).toBe('--timeout must be an integer from 1 to 3600');
    expect(cliExitCode(thrown)).toBe(2);
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('still requires a credential once flags and inputs resolve', async () => {
    delete process.env.GEMINI_API_KEY;
    const input = path.join(directory, 'document.png');
    await writeFile(input, 'binary');

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input, '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'AUTH_MISSING', category: 'authentication' });
    expect((thrown as Error).message).toContain('Gemini API key is missing');
    expect((thrown as Error).message).toContain('PowerShell');
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('keeps --dry-run credential-free for a resolvable input', async () => {
    delete process.env.GEMINI_API_KEY;
    const input = path.join(directory, 'document.png');
    await writeFile(input, 'binary');
    mocks.runBatch.mockResolvedValueOnce({
      succeeded: 0, partial: 0, failed: 0, skipped: 1, costLimitReached: false,
      usage: { totalTokens: 0, requests: 0, estimatedCostUsd: 0 },
    });

    await createProgram().parseAsync([
      'node', 'open-ocr-cli', 'extract', input, '--dry-run', '--quiet',
    ]);

    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects a preset the named mode would silently discard', async () => {
    const input = path.join(directory, 'invoice.png');
    await writeFile(input, 'binary');

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input, '--mode', 'simple', '--preset', 'invoice', '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'CONFIG_INVALID' });
    expect((thrown as Error).message).toBe('--preset is only available in template mode');
    expect(cliExitCode(thrown)).toBe(2);
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('warns on stderr about flags the resolved mode will ignore', async () => {
    const input = path.join(directory, 'document.png');
    await writeFile(input, 'binary');
    mocks.runBatch.mockResolvedValueOnce({
      succeeded: 1, partial: 0, failed: 0, skipped: 0, costLimitReached: false,
      usage: { totalTokens: 10, requests: 1, estimatedCostUsd: 0 },
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let output = '';

    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input,
        '--max-iterations', '9', '--confidence-threshold', '0.5', '--detect-math', '--quiet',
      ]);
    } finally {
      output = stderr.mock.calls.flat().join('');
      stderr.mockRestore();
    }

    expect(output).toContain(
      'ignoring option(s) that simple mode does not use: --max-iterations, --confidence-threshold\n',
    );
    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
  });

  it('does not warn about mode-scoped flags the user never passed', async () => {
    const input = path.join(directory, 'document.png');
    await writeFile(input, 'binary');
    mocks.runBatch.mockResolvedValueOnce({
      succeeded: 1, partial: 0, failed: 0, skipped: 0, costLimitReached: false,
      usage: { totalTokens: 10, requests: 1, estimatedCostUsd: 0 },
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let output = '';

    try {
      // --mode agentic leaves --detect-images/--detect-math unused, but neither
      // was typed, and --exclude/--instruction carry Commander [] defaults.
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'extract', input, '--mode', 'agentic', '--quiet',
      ]);
    } finally {
      output = stderr.mock.calls.flat().join('');
      stderr.mockRestore();
    }

    expect(output).not.toContain('ignoring option(s)');
  });

  it('reports an unreadable web URL list before a missing credential', async () => {
    delete process.env.GEMINI_API_KEY;

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'web', '--file', path.join(directory, 'urls.txt'), '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'INPUT_NOT_FOUND', category: 'input' });
    expect((thrown as Error).message).toBe(
      `URL list file not found: ${path.join(directory, 'urls.txt')}`,
    );
    expect((thrown as Error).message).not.toContain('ENOENT');
    expect(mocks.runWebJob).not.toHaveBeenCalled();
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

  it('reports an existing Web output before a missing credential', async () => {
    delete process.env.GEMINI_API_KEY;
    const output = path.join(directory, 'result.md');
    await writeFile(output, 'existing');

    let thrown: unknown;
    try {
      await createProgram().parseAsync([
        'node', 'open-ocr-cli', 'web', 'https://example.com/report', '--output', output, '--quiet',
      ]);
    } catch (error) {
      thrown = error;
    }

    // capabilities advertises credential-free-dry-run, so the credential-free
    // dry run above and this live run have to name the same first problem.
    expect(ocrErrorPayload(thrown, 2)).toMatchObject({
      code: 'OUTPUT_CONFLICT',
      category: 'output',
    });
    expect((thrown as Error).message).not.toContain('API key is missing');
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

  it('marks whether the reported project config paths exist', async () => {
    const projectConfig = path.join(directory, '.open-ocr-cli.json');
    const legacyProjectConfig = path.join(directory, '.gemini-ocr.json');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const read = (): string => stdout.mock.calls.flat().join('');
    try {
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'doctor', '--no-config', '--json']);
      expect(JSON.parse(read()) as Record<string, unknown>).toMatchObject({
        projectConfig,
        projectConfigExists: false,
        legacyProjectConfig,
        legacyProjectConfigExists: false,
      });

      stdout.mockClear();
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'doctor', '--no-config']);
      expect(read()).toContain(`Project config: ${projectConfig} (not found)`);
      expect(read()).not.toContain('Legacy project config:');

      await writeFile(projectConfig, '{}', 'utf8');
      await writeFile(legacyProjectConfig, '{}', 'utf8');

      stdout.mockClear();
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'doctor', '--no-config', '--json']);
      expect(JSON.parse(read()) as Record<string, unknown>).toMatchObject({
        projectConfig,
        projectConfigExists: true,
        legacyProjectConfig,
        legacyProjectConfigExists: true,
      });

      stdout.mockClear();
      await createProgram().parseAsync(['node', 'open-ocr-cli', 'doctor', '--no-config']);
      expect(read()).toContain(`Project config: ${projectConfig}\n`);
      expect(read()).not.toContain('(not found)');
      expect(read()).toContain(`Legacy project config: ${legacyProjectConfig}\n`);
    } finally {
      stdout.mockRestore();
      cwd.mockRestore();
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
