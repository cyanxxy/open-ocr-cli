import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { credentialSetupGuidance, loadCliConfig, loadLocalEnv, resolveCliOptions } from './config';

const originalApiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  delete process.env.GEMINI_OCR_MODEL;
  delete process.env.GEMINI_OCR_THINKING;
});

describe('CLI configuration', () => {
  it('uses safe defaults and environment credentials', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const options = resolveCliOptions({}, {}, '/workspace');
    expect(options).toMatchObject({
      apiKey: 'test-key',
      model: 'gemini-3.5-flash',
      thinking: 'MEDIUM',
      mode: 'simple',
      format: 'markdown',
      concurrency: 2,
      retries: 3,
      resume: true,
    });
  });

  it('lets CLI flags override environment and file configuration', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_OCR_MODEL = 'gemini-3-flash-preview';
    const options = resolveCliOptions(
      { model: 'gemini-3.1-pro-preview', thinking: 'high', concurrency: '6' },
      { model: 'gemini-3.1-flash-lite', thinking: 'LOW', concurrency: 3 },
      '/workspace',
    );
    expect(options.model).toBe('gemini-3.1-pro-preview');
    expect(options.thinking).toBe('HIGH');
    expect(options.concurrency).toBe(6);
  });

  it('makes a preset imply template mode and accepts CSV', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const options = resolveCliOptions({ preset: 'invoice', format: 'csv' }, {}, '/workspace');
    expect(options.mode).toBe('template');
    expect(options.preset).toBe('invoice');
    expect(options.format).toBe('csv');
  });

  it('raises minimal thinking for agentic and Pro runs', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(resolveCliOptions({ mode: 'agentic', thinking: 'minimal' }, {}, '/workspace').thinking).toBe('MEDIUM');
    expect(resolveCliOptions({ model: 'gemini-3.1-pro-preview', thinking: 'minimal' }, {}, '/workspace').thinking).toBe('LOW');
  });

  it('allows credential-free dry runs but rejects live runs without a key', () => {
    delete process.env.GEMINI_API_KEY;
    expect(resolveCliOptions({ dryRun: true }, {}, '/workspace').apiKey).toBe('');
    expect(() => resolveCliOptions({}, {}, '/workspace')).toThrow('Gemini API key is missing');
    expect(() => resolveCliOptions({}, {}, '/workspace')).toThrow('PowerShell');
    expect(credentialSetupGuidance('CUSTOM_GEMINI_KEY', '/workspace')).toContain(
      'CUSTOM_GEMINI_KEY=your-key',
    );
  });

  it('validates modes, formats, numeric bounds, and presets', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(() => resolveCliOptions({ mode: 'template' }, {}, '/workspace')).toThrow('--preset is required');
    expect(() => resolveCliOptions({ format: 'csv' }, {}, '/workspace')).toThrow('only available in template mode');
    expect(() => resolveCliOptions({ concurrency: '0' }, {}, '/workspace')).toThrow('--concurrency');
    expect(() => resolveCliOptions({ preset: 'missing' }, {}, '/workspace')).toThrow('Unknown extraction preset');
    expect(() => resolveCliOptions({ maxCost: '0' }, {}, '/workspace')).toThrow('--max-cost');
    expect(() => resolveCliOptions({ requestsPerMinute: '-1' }, {}, '/workspace')).toThrow('--requests-per-minute');
  });

  it('makes custom schemas JSON-only simple extraction', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(resolveCliOptions({ schema: 'invoice.schema.json' }, {}, '/workspace')).toMatchObject({
      mode: 'simple',
      format: 'json',
      schemaPath: 'invoice.schema.json',
    });
    expect(() => resolveCliOptions(
      { schema: 'invoice.schema.json', mode: 'agentic' },
      {},
      '/workspace',
    )).toThrow('--schema is only available in simple mode');
    expect(() => resolveCliOptions(
      { schema: 'invoice.schema.json', format: 'markdown' },
      {},
      '/workspace',
    )).toThrow('--schema requires --format json');
    expect(() => resolveCliOptions(
      { schema: 'invoice.schema.json', preset: 'invoice', mode: 'simple' },
      {},
      '/workspace',
    )).toThrow('--schema cannot be combined with --preset');
  });

  it('allowlists file configuration and warns about unknown keys without retaining secrets', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-config-'));
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await writeFile(path.join(directory, '.gemini-ocr.json'), JSON.stringify({
        concurrency: 3,
        apiKey: 'must-not-survive',
        concurreny: 9,
      }));
      const config = await loadCliConfig(directory);
      expect(config).toMatchObject({ concurrency: 3 });
      expect(config).not.toHaveProperty('apiKey');
      expect(config).not.toHaveProperty('concurreny');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('apiKey, concurreny'));
    } finally {
      warning.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('loads a project-local .env file for first-run credential setup', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-env-'));
    delete process.env.PROJECT_GEMINI_KEY;
    try {
      await writeFile(path.join(directory, '.env'), 'PROJECT_GEMINI_KEY=from-project-env\n');
      loadLocalEnv(directory);
      expect(process.env.PROJECT_GEMINI_KEY).toBe('from-project-env');
    } finally {
      delete process.env.PROJECT_GEMINI_KEY;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
