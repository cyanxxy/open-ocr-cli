import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCliOptions } from './config';
import { detectMimeType, discoverInputs, inputFingerprint, readAndValidateInput, readStdin } from './inputs';
import type { ResolvedCliOptions, ResolvedInput } from './types';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87A_BYTES = new TextEncoder().encode('GIF87a');
const GIF89A_BYTES = new TextEncoder().encode('GIF89a');

function bmffBytes(majorBrand: string, compatibleBrands: string[] = []): Uint8Array {
  const bytes = Buffer.alloc(16 + compatibleBrands.length * 4);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write(majorBrand, 8, 'ascii');
  compatibleBrands.forEach((brand, index) => bytes.write(brand, 16 + index * 4, 'ascii'));
  return Uint8Array.from(bytes);
}

function stdinInput(bytes: Uint8Array, mimeType: string, name = 'stdin'): ResolvedInput {
  return {
    displayPath: '<stdin>',
    relativePath: name,
    name,
    mimeType,
    size: bytes.byteLength,
    mtimeMs: 0,
    stdinBytes: bytes,
  };
}
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
  it('destroys a blocked document stdin stream when aborted', async () => {
    const input = new PassThrough();
    const abortController = new AbortController();
    const reading = readStdin(1024, abortController.signal, input);

    input.write(PNG_BYTES);
    abortController.abort(new Error('Interrupted by SIGTERM'));

    await expect(reading).rejects.toThrow('Interrupted by SIGTERM');
    expect(input.destroyed).toBe(true);
  });

  it('detects every supported extension', () => {
    expect(detectMimeType('a.pdf')).toBe('application/pdf');
    expect(detectMimeType('a.PNG')).toBe('image/png');
    expect(detectMimeType('a.jpeg')).toBe('image/jpeg');
    expect(detectMimeType('a.webp')).toBe('image/webp');
    expect(detectMimeType('a.GIF')).toBe('image/gif');
    expect(detectMimeType('a.heic')).toBe('image/heic');
    expect(() => detectMimeType('a.txt')).toThrow('Unsupported document extension');
  });

  it('sniffs stdin media when its synthetic filename has no extension', () => {
    expect(detectMimeType('stdin', undefined, PNG_BYTES)).toBe('image/png');
    expect(detectMimeType('stdin', undefined, JPEG_BYTES)).toBe('image/jpeg');
    expect(detectMimeType('stdin', undefined, GIF87A_BYTES)).toBe('image/gif');
    expect(detectMimeType('stdin', undefined, GIF89A_BYTES)).toBe('image/gif');
    expect(detectMimeType('stdin', undefined, bmffBytes('heic', ['mif1']))).toBe('image/heic');
    expect(detectMimeType('stdin', undefined, bmffBytes('mif1'))).toBe('image/heif');
    expect(detectMimeType('stdin', 'image/png', PNG_BYTES)).toBe('image/png');
  });

  it('rejects unrelated ISO-BMFF and AVIF media instead of treating them as HEIF', async () => {
    // This MP4-brand payload is a negative fixture, not a supported OCR input.
    const nonImageBmff = bmffBytes('isom', ['mp42']);
    const avif = bmffBytes('avif', ['mif1']);
    const mixedAvif = bmffBytes('mif1', ['heic', 'avif']);
    expect(() => detectMimeType('stdin', undefined, nonImageBmff)).toThrow('Unsupported document extension');
    expect(() => detectMimeType('stdin', undefined, avif)).toThrow('Unsupported document extension');
    expect(() => detectMimeType('stdin', undefined, mixedAvif)).toThrow('Unsupported document extension');
    await expect(readAndValidateInput(stdinInput(nonImageBmff, 'image/heif'))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      category: 'input',
    });
    await expect(readAndValidateInput(
      stdinInput(bmffBytes('heic', ['mif1']), 'image/heif'),
    )).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      category: 'input',
    });
  });

  it('expands directories recursively, sorts files, and applies exclusions', async () => {
    await mkdir(path.join(directory, 'nested'));
    await writeFile(path.join(directory, 'b.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'nested', 'a.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'nested', 'ignored.jpg'), JPEG_BYTES);
    const found = await discoverInputs(['.'], { ...options, excludes: ['**/ignored.jpg'] });
    expect(found.map((input) => input.relativePath)).toEqual(['b.jpg', path.join('nested', 'a.jpg')]);
  });

  it('discovers and validates GIF files recursively', async () => {
    await mkdir(path.join(directory, 'nested'));
    await writeFile(path.join(directory, 'nested', 'animation.gif'), GIF89A_BYTES);

    const [input] = await discoverInputs(['.'], options);

    expect(input).toMatchObject({ name: 'animation.gif', mimeType: 'image/gif' });
    const result = await readAndValidateInput(input);
    expect(result.dataUrl).toMatch(/^data:image\/gif;base64,/);
  });

  it('deduplicates overlapping file and glob inputs', async () => {
    await writeFile(path.join(directory, 'document.jpg'), JPEG_BYTES);
    const found = await discoverInputs(['document.jpg', '*.jpg'], options);
    expect(found).toHaveLength(1);
  });

  it('sniffs an explicitly named extensionless or temporary document', async () => {
    const extensionless = path.join(directory, 'agent-upload');
    const temporary = path.join(directory, 'agent-upload.tmp');
    await writeFile(extensionless, PNG_BYTES);
    await writeFile(temporary, JPEG_BYTES);

    const found = await discoverInputs([extensionless, temporary], options);

    expect(found.map((input) => [input.name, input.mimeType])).toEqual([
      ['agent-upload', 'image/png'],
      ['agent-upload.tmp', 'image/jpeg'],
    ]);
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

  it('reports a file removed after discovery as an input error', async () => {
    const target = path.join(directory, 'removed.jpg');
    await writeFile(target, JPEG_BYTES);
    const [input] = await discoverInputs([target], options);
    await rm(target);

    await expect(readAndValidateInput(input)).rejects.toMatchObject({
      code: 'INPUT_NOT_FOUND',
      category: 'input',
    });
  });

  it('content-addresses stdin fingerprints and document names', () => {
    const first = stdinInput(new Uint8Array([1, 2, 3]), 'image/png', 'first.png');
    const differentContent = stdinInput(new Uint8Array([9, 8, 7]), 'image/png', 'first.png');
    const differentName = stdinInput(new Uint8Array([1, 2, 3]), 'image/png', 'second.png');
    expect(inputFingerprint(first, 'simple')).not.toBe(inputFingerprint(differentContent, 'simple'));
    expect(inputFingerprint(first, 'simple')).not.toBe(inputFingerprint(differentName, 'simple'));
  });

  it('classifies structurally invalid PDFs as input errors', async () => {
    const malformedPdf = stdinInput(Buffer.from('%PDF-1.7\nbroken'), 'application/pdf', 'broken.pdf');
    await expect(readAndValidateInput(malformedPdf)).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      category: 'input',
    });
  });

  it('validates PDF page counts with Uint8Array input', async () => {
    const target = path.join(directory, 'invoice.pdf');
    await copyFile(path.resolve(process.cwd(), 'evals/corpus/invoice.pdf'), target);
    const [input] = await discoverInputs([target], options);
    const result = await readAndValidateInput(input);
    expect(result.dataUrl).toMatch(/^data:application\/pdf;base64,/);
  });
});
