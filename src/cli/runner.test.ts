import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCliOptions } from './config';
import { discoverInputs } from './inputs';
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
  it('changes the resume fingerprint when the provider or gateway route changes', () => {
    const gemini = resolveCliOptions({ dryRun: true }, {}, directory);
    const kimi = resolveCliOptions({ dryRun: true, provider: 'kimi' }, {}, directory);
    const cloudflare = resolveCliOptions({
      dryRun: true,
      gateway: 'cloudflare',
      cloudflareAccountId: 'account',
      cloudflareGatewayId: 'gateway',
    }, {}, directory);

    expect(modeFingerprint(kimi)).not.toBe(modeFingerprint(gemini));
    expect(modeFingerprint(cloudflare)).not.toBe(modeFingerprint(gemini));
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
      writeStdout: (text) => stdout.push(text),
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
    const summary = await runBatch(inputs, options, {
      abortController: new AbortController(),
      writeStdout: (text) => stdout.push(text),
      writeStderr: () => undefined,
    });
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(stdout.join('')).toContain('does not match its declared type');
    expect(stdout.join('')).toContain('"type":"summary"');
  });
});
