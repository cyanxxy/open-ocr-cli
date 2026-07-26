import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCliOptions } from './config';
import { discoverInputSet, discoverInputs } from './inputs';
import { modeFingerprint, runBatch } from './runner';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-runner-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('CLI batch runner', () => {
  it('fingerprints output behavior without invalidating resume for display-only progress', () => {
    const gemini = resolveCliOptions({ dryRun: true }, {}, directory);
    const kimi = resolveCliOptions({ dryRun: true, provider: 'kimi' }, {}, directory);
    const cloudflare = resolveCliOptions({
      dryRun: true,
      gateway: 'cloudflare',
      cloudflareAccountId: 'account',
      cloudflareGatewayId: 'gateway',
    }, {}, directory);
    const withThoughts = resolveCliOptions({ dryRun: true, includeThoughts: true }, {}, directory);
    const traceStandard = resolveCliOptions({
      dryRun: true, format: 'all', progress: 'standard',
    }, {}, directory);
    const traceDetailed = resolveCliOptions({
      dryRun: true, format: 'all', progress: 'detailed',
    }, {}, directory);

    expect(modeFingerprint(kimi)).not.toBe(modeFingerprint(gemini));
    expect(modeFingerprint(cloudflare)).not.toBe(modeFingerprint(gemini));
    expect(modeFingerprint(withThoughts)).toBe(modeFingerprint(gemini));
    expect(modeFingerprint(traceDetailed)).not.toBe(modeFingerprint(traceStandard));
  });

  it('validates every document in a credential-free dry run', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'two.jpg'), JPEG_BYTES);
    const options = resolveCliOptions({ dryRun: true }, {}, directory);
    const inputs = await discoverInputs(['.'], options);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const summary = await runBatch(inputs, options, {
      abortController: new AbortController(),
      writeStdout: (text) => { stdout.push(text); },
      writeStderr: (text) => stderr.push(text),
    });
    expect(summary).toMatchObject({ total: 2, failed: 0, skipped: 2 });
    expect(summary.results.every((result) => result.skipReason === 'validated')).toBe(true);
    expect(summary.results.every((result) => result.plannedOutputFiles?.length === 1)).toBe(true);
    expect(summary.usage.requests).toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('validated (dry run)');
    expect(stderr.join('')).toContain(path.join(directory, 'gemini-ocr-output', 'one.md'));
  });

  it('reports invalid documents individually during dry runs', async () => {
    await writeFile(path.join(directory, 'good.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'spoofed.jpg'), 'plain text');
    const options = resolveCliOptions({ dryRun: true, quiet: true, jsonl: true }, {}, directory);
    const inputs = await discoverInputs(['.'], options);
    const stdout: string[] = [];
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const summary = await runBatch(inputs, options, {
      abortController: new AbortController(),
      writeStdout: async (text) => {
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
        await Promise.resolve();
        stdout.push(text);
        activeWrites -= 1;
      },
      writeStderr: () => undefined,
    });
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    const records = stdout.join('').trim().split('\n').map((line) => JSON.parse(line) as {
      type: string;
      status?: string;
      error?: string;
    });
    expect(records).toHaveLength(3);
    expect(records.slice(0, 2).map((record) => record.type)).toEqual(['document', 'document']);
    expect(records.slice(0, 2).map((record) => record.status).sort()).toEqual(['failed', 'skipped']);
    expect(records.at(-1)?.type).toBe('summary');
    expect(stdout.join('')).toContain('does not match its declared type');
    expect(maximumActiveWrites).toBe(1);
  });

  it('makes a failed document and a shrunken input set machine-readable in --jsonl', async () => {
    await writeFile(path.join(directory, 'good.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'spoofed.jpg'), 'plain text');
    await writeFile(path.join(directory, 'notes.md'), '# notes');
    const options = resolveCliOptions({ dryRun: true, quiet: true, jsonl: true }, {}, directory);
    const discovery = await discoverInputSet(['.'], options);
    const stdout: string[] = [];

    await runBatch(discovery.inputs, options, {
      abortController: new AbortController(),
      discovery: discovery.skipped,
      writeStdout: (text) => { stdout.push(text); },
      writeStderr: () => undefined,
    });

    const records = stdout.join('').trim().split('\n').map((line) => JSON.parse(line) as {
      type: string;
      status?: string;
      error?: string;
      errorDetails?: { code: string; category: string; retryable: boolean };
    });
    const failed = records.find((record) => record.status === 'failed');
    // The bare string survives for existing consumers; the typed detail is what
    // lets an agent branch without parsing prose.
    expect(failed?.error).toContain('does not match its declared type');
    expect(failed?.errorDetails).toMatchObject({
      code: 'INPUT_INVALID',
      category: 'input',
      retryable: false,
    });
    // `skipped` counts documents that entered the pipeline, so notes.md can only
    // be accounted for by the separate discovery report.
    expect(records.at(-1)).toMatchObject({
      type: 'summary',
      total: 2,
      failed: 1,
      skipped: 1,
      discovery: { unsupported: 1, defaultExcluded: 0 },
    });
  });

  it('ends a cancelled --jsonl batch with the summary as its one terminal record', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'two.jpg'), JPEG_BYTES);
    const options = resolveCliOptions({ dryRun: true, quiet: true, jsonl: true }, {}, directory);
    const inputs = await discoverInputs(['.'], options);
    const abortController = new AbortController();
    abortController.abort(new Error('Interrupted by SIGINT'));
    const stdout: string[] = [];
    let terminalRecords = 0;

    const summary = await runBatch(inputs, options, {
      abortController,
      onTerminalRecord: () => { terminalRecords += 1; },
      writeStdout: (text) => { stdout.push(text); },
      writeStderr: () => undefined,
    });

    // Cancellation resolves into skipped documents and a normal return, so the
    // stream terminates in a summary rather than a typed failure. Reporting it
    // is what stops the command from appending a second terminal record.
    expect(summary).toMatchObject({ total: 2, skipped: 2 });
    const records = stdout.join('').trim().split('\n').map((line) => JSON.parse(line) as {
      type: string;
      skipReason?: string;
    });
    expect(records.at(-1)?.type).toBe('summary');
    expect(records.filter((record) => record.type === 'summary')).toHaveLength(1);
    expect(records.filter((record) => record.type === 'document').map((record) => record.skipReason))
      .toEqual(['cancelled', 'cancelled']);
    expect(terminalRecords).toBe(1);
  });

  it('reports no terminal record when the batch was never asked for a --jsonl stream', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    const options = resolveCliOptions({ dryRun: true, quiet: true }, {}, directory);
    const inputs = await discoverInputs(['.'], options);
    let terminalRecords = 0;

    await runBatch(inputs, options, {
      abortController: new AbortController(),
      onTerminalRecord: () => { terminalRecords += 1; },
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    });

    expect(terminalRecords).toBe(0);
  });

  it('states that discovery passed over nothing rather than omitting the field', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    const options = resolveCliOptions({ dryRun: true, quiet: true, jsonl: true }, {}, directory);
    const inputs = await discoverInputs(['.'], options);
    const stdout: string[] = [];

    await runBatch(inputs, options, {
      abortController: new AbortController(),
      writeStdout: (text) => { stdout.push(text); },
      writeStderr: () => undefined,
    });

    const records = stdout.join('').trim().split('\n');
    expect(JSON.parse(records.at(-1)!) as unknown).toMatchObject({
      type: 'summary',
      discovery: { unsupported: 0, defaultExcluded: 0 },
    });
  });
});
