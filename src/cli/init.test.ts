import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runInit, type InitPrompter } from './init';

let directory: string;

function answers(values: string[], confirmation = true): InitPrompter {
  let index = 0;
  return {
    ask: vi.fn((_question: string, defaultValue: string) => Promise.resolve(values[index++] ?? defaultValue)),
    confirm: vi.fn(() => Promise.resolve(confirmation)),
    close: vi.fn(),
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-init-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('CLI init', () => {
  it('writes safe interactive configuration and validates an environment credential', async () => {
    const validateCredentials = vi.fn(() => Promise.resolve());
    const output: string[] = [];
    const result = await runInit({}, {
      cwd: directory,
      env: { OCR_KEY: 'secret-value' },
      prompter: answers(['gemini-3.1-flash-lite', 'LOW', '4', '30', '2.50', 'OCR_KEY']),
      validateCredentials,
      writeOutput: (text) => output.push(text),
    });

    expect(result).toMatchObject({ written: true, credentialStatus: 'valid' });
    expect(validateCredentials).toHaveBeenCalledWith('secret-value', 'gemini-3.1-flash-lite');
    const config = JSON.parse(await readFile(path.join(directory, '.gemini-ocr.json'), 'utf8')) as Record<string, unknown>;
    expect(config).toMatchObject({ concurrency: 4, requestsPerMinute: 30, maxCostUsd: 2.5, apiKeyEnv: 'OCR_KEY' });
    expect(config).not.toHaveProperty('apiKey');
    expect(await readFile(path.join(directory, '.gemini-ocr.json'), 'utf8')).not.toContain('secret-value');
    expect(output.join('')).toContain('credential validated');
  });

  it('does not replace existing configuration when confirmation is declined', async () => {
    const target = path.join(directory, '.gemini-ocr.json');
    const output: string[] = [];
    await writeFile(target, '{"model":"gemini-3.5-flash"}\n');
    const result = await runInit({}, {
      cwd: directory,
      prompter: answers([], false),
      writeOutput: (text) => output.push(text),
    });
    expect(result.written).toBe(false);
    expect(await readFile(target, 'utf8')).toContain('gemini-3.5-flash');
    expect(output.join('')).toContain('Use --force');
  });

  it('reports an existing config in non-interactive mode instead of silently succeeding', async () => {
    const target = path.join(directory, '.gemini-ocr.json');
    const output: string[] = [];
    await writeFile(target, '{"model":"gemini-3.5-flash"}\n');
    const result = await runInit({ yes: true }, {
      cwd: directory,
      prompter: answers([]),
      writeOutput: (text) => output.push(text),
    });
    expect(result.written).toBe(false);
    expect(output.join('')).toContain('already exists');
    expect(output.join('')).toContain('--force');
  });

  it('uses the same maximum cost bound as extract', async () => {
    await expect(runInit({}, {
      cwd: directory,
      prompter: answers(['gemini-3.5-flash', 'MEDIUM', '2', '0', '1000001']),
      writeOutput: () => undefined,
    })).rejects.toThrow('at most 1000000');
  });
});
