import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCliOptions } from './config';
import { detectMimeType, discoverInputs, inputFingerprint, readAndValidateInput } from './inputs';
import type { ResolvedCliOptions } from './types';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
let directory: string;
let options: ResolvedCliOptions;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-inputs-'));
  process.env.GEMINI_API_KEY = 'test-key';
  options = resolveCliOptions({ dryRun: true }, {}, directory);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
});

describe('CLI input discovery', () => {
  it('detects every supported extension', () => {
    expect(detectMimeType('a.pdf')).toBe('application/pdf');
    expect(detectMimeType('a.PNG')).toBe('image/png');
    expect(detectMimeType('a.jpeg')).toBe('image/jpeg');
    expect(detectMimeType('a.webp')).toBe('image/webp');
    expect(detectMimeType('a.heic')).toBe('image/heic');
    expect(() => detectMimeType('a.txt')).toThrow('Unsupported document extension');
  });

  it('expands directories recursively, sorts files, and applies exclusions', async () => {
    await mkdir(path.join(directory, 'nested'));
    await writeFile(path.join(directory, 'b.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'nested', 'a.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'nested', 'ignored.jpg'), JPEG_BYTES);
    const found = await discoverInputs(['.'], { ...options, excludes: ['**/ignored.jpg'] });
    expect(found.map((input) => input.relativePath)).toEqual(['b.jpg', path.join('nested', 'a.jpg')]);
  });

  it('deduplicates overlapping file and glob inputs', async () => {
    await writeFile(path.join(directory, 'document.jpg'), JPEG_BYTES);
    const found = await discoverInputs(['document.jpg', '*.jpg'], options);
    expect(found).toHaveLength(1);
  });

  it('discovers empty documents so the batch can report them individually', async () => {
    await writeFile(path.join(directory, 'empty.jpg'), new Uint8Array());
    await writeFile(path.join(directory, 'valid.jpg'), JPEG_BYTES);
    const found = await discoverInputs(['.'], options);
    expect(found).toHaveLength(2);
    await expect(readAndValidateInput(found[0])).rejects.toThrow('is empty');
    await expect(readAndValidateInput(found[1])).resolves.toBeDefined();
  });

  it('enforces file-count and total-size budgets', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'two.jpg'), JPEG_BYTES);
    await expect(discoverInputs(['.'], { ...options, maxFiles: 1 })).rejects.toThrow('exceeding --max-files');
    await expect(discoverInputs(['.'], { ...options, maxTotalMb: 0.000001 })).rejects.toThrow('exceeding --max-total-mb');
  });

  it('validates magic bytes and produces stable fingerprints', async () => {
    const target = path.join(directory, 'document.jpg');
    await writeFile(target, JPEG_BYTES);
    const [input] = await discoverInputs([target], options);
    const result = await readAndValidateInput(input);
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(inputFingerprint(input, 'simple')).toBe(inputFingerprint(input, 'simple'));
    expect(inputFingerprint(input, 'simple')).not.toBe(inputFingerprint(input, 'agentic'));

    await writeFile(target, 'not an image');
    await expect(readAndValidateInput(input)).rejects.toThrow('does not match its declared type');
  });

  it('validates PDF page counts with Uint8Array input', async () => {
    const target = path.join(directory, 'invoice.pdf');
    await copyFile(path.resolve(process.cwd(), 'evals/corpus/invoice.pdf'), target);
    const [input] = await discoverInputs([target], options);
    const result = await readAndValidateInput(input);
    expect(result.dataUrl).toMatch(/^data:application\/pdf;base64,/);
  });
});
