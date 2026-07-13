import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCliOptions } from './config';
import { ManifestStore, primaryArtifact, writeArtifacts } from './output';
import type { OcrArtifacts, ResolvedCliOptions, ResolvedInput } from './types';

let directory: string;
let options: ResolvedCliOptions;
const input: ResolvedInput = {
  absolutePath: '/workspace/nested/invoice.pdf',
  displayPath: 'nested/invoice.pdf',
  relativePath: 'nested/invoice.pdf',
  name: 'invoice.pdf',
  mimeType: 'application/pdf',
  size: 100,
  mtimeMs: 123,
};
const artifacts: OcrArtifacts = {
  markdown: '# Invoice',
  json: { title: 'Invoice', sections: [] },
  csv: 'name,total\nAcme,12.00',
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-output-'));
  process.env.GEMINI_API_KEY = 'test-key';
  options = resolveCliOptions({ output: directory, format: 'all' }, {}, '/workspace');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
});

describe('CLI output', () => {
  it('renders primary artifacts for pipelines', () => {
    expect(primaryArtifact(artifacts, 'markdown')).toBe('# Invoice\n');
    expect(primaryArtifact(artifacts, 'json')).toContain('"title": "Invoice"');
    expect(primaryArtifact(artifacts, 'csv')).toBe('name,total\nAcme,12.00\n');
    expect(() => primaryArtifact({ markdown: '# Only' }, 'csv')).toThrow('tabular CSV');
  });

  it('writes all artifacts while preserving input directories', async () => {
    const files = await writeArtifacts(input, artifacts, options, 2);
    expect(files).toHaveLength(3);
    expect(files).toContain(path.join(directory, 'nested', 'invoice.md'));
    expect(await readFile(path.join(directory, 'nested', 'invoice.json'), 'utf8')).toContain('"Invoice"');
  });

  it('refuses accidental replacement and supports explicit overwrite', async () => {
    await writeArtifacts(input, artifacts, options, 2);
    await expect(writeArtifacts(input, artifacts, options, 2)).rejects.toThrow('Output already exists');
    await expect(writeArtifacts(input, artifacts, { ...options, overwrite: true }, 2)).resolves.toHaveLength(3);
  });

  it('persists and verifies resumable manifest entries', async () => {
    const outputFile = path.join(directory, 'invoice.json');
    await writeArtifacts(
      { ...input, relativePath: 'invoice.pdf' },
      { json: artifacts.json },
      { ...options, format: 'json' },
      2,
    );
    const manifest = new ManifestStore(directory);
    await manifest.load();
    await manifest.update('/workspace/invoice.pdf', {
      fingerprint: 'abc',
      status: 'succeeded',
      outputFiles: [outputFile],
      completedAt: new Date().toISOString(),
    });
    const reloaded = new ManifestStore(directory);
    await reloaded.load();
    await expect(reloaded.completed('/workspace/invoice.pdf', 'abc')).resolves.toBe(true);
    await expect(reloaded.completed('/workspace/invoice.pdf', 'different')).resolves.toBe(false);

    await manifest.update('/workspace/invoice.pdf', {
      fingerprint: 'partial',
      status: 'partial',
      outputFiles: [outputFile],
      completedAt: new Date().toISOString(),
    });
    const partial = new ManifestStore(directory);
    await partial.load();
    await expect(partial.completed('/workspace/invoice.pdf', 'partial')).resolves.toBe(true);
  });
});
