import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { Readable } from 'node:stream';

import fg from 'fast-glob';

import { FILE_CONSTRAINTS, maxFileSizeForMime } from '../constants';
import { CliExitError, type OcrErrorCode } from './errors';
import type { ResolvedCliOptions, ResolvedInput } from './types';

const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const SUPPORTED_GLOB = '**/*.{pdf,png,jpg,jpeg,webp,gif,heic,heif}';

function inputError(message: string, code: OcrErrorCode = 'INPUT_INVALID'): CliExitError {
  return new CliExitError(message, 2, {
    code,
    category: 'input',
    retryable: false,
    hint: code === 'INPUT_NOT_FOUND'
      ? 'Check the input path and working directory.'
      : 'Use a supported, non-empty image or PDF within the documented limits.',
  });
}

export function detectMimeType(
  filePath: string,
  explicitMime?: string,
  bytes?: Uint8Array,
): string {
  if (explicitMime) {
    const supported = [
      ...FILE_CONSTRAINTS.SUPPORTED_IMAGE_MIME_TYPES,
      ...FILE_CONSTRAINTS.SUPPORTED_DOCUMENT_MIME_TYPES,
    ];
    if (!supported.includes(explicitMime as never)) throw inputError(`Unsupported MIME type: ${explicitMime}`);
    return explicitMime;
  }
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = EXTENSION_TO_MIME[extension];
  if (mimeType) return mimeType;
  const sniffed = bytes ? sniffDocumentMimeType(bytes.subarray(0, 256)) : undefined;
  if (sniffed) return sniffed;
  throw inputError(`Unsupported document extension: ${extension || '(none)'}`);
}

async function detectLocalMimeType(absolutePath: string): Promise<string> {
  const extension = path.extname(absolutePath).toLowerCase();
  const declared = EXTENSION_TO_MIME[extension];
  if (declared) return declared;

  // Coding agents commonly create extensionless or `.tmp` files. Sniff only
  // the bounded signature prefix for an explicitly named file; recursive
  // directory/glob discovery remains extension-filtered and predictable.
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(absolutePath, 'r');
    const prefix = Buffer.alloc(256);
    const { bytesRead } = await handle.read(prefix, 0, prefix.byteLength, 0);
    return detectMimeType(absolutePath, undefined, prefix.subarray(0, bytesRead));
  } catch (error) {
    if (error instanceof CliExitError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw inputError(`Input no longer exists: ${absolutePath}`, 'INPUT_NOT_FOUND');
    throw inputError(
      `Could not inspect ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await handle?.close();
  }
}

function isGlobPattern(value: string): boolean {
  return /[*?{}[\]()!]/.test(value);
}

async function expandInput(value: string, options: ResolvedCliOptions): Promise<string[]> {
  const absolute = path.resolve(options.cwd, value);
  try {
    const stat = await fs.stat(absolute);
    if (stat.isFile()) return [absolute];
    if (stat.isDirectory()) {
      return fg(SUPPORTED_GLOB, {
        cwd: absolute,
        absolute: true,
        onlyFiles: true,
        dot: options.hidden,
        followSymbolicLinks: false,
        ignore: options.excludes,
      });
    }
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (!isGlobPattern(value)) throw inputError(`Input does not exist: ${value}`, 'INPUT_NOT_FOUND');
  return fg(value, {
    cwd: options.cwd,
    absolute: true,
    onlyFiles: true,
    dot: options.hidden,
    followSymbolicLinks: false,
    ignore: options.excludes,
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
}

export async function readStdin(
  maxBytes: number,
  signal?: AbortSignal,
  input: Readable = process.stdin,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  signal?.throwIfAborted();
  const onAbort = (): void => {
    input.destroy(signal ? abortReason(signal) : undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const chunk of input as AsyncIterable<Uint8Array | string>) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > maxBytes) {
        throw inputError(
          `stdin exceeds the ${(maxBytes / 1024 / 1024).toFixed(1)}MB configured input limit`,
        );
      }
      chunks.push(bytes);
    }
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(chunks, totalBytes);
}

function safeRelativePath(cwd: string, absolutePath: string): string {
  const relative = path.relative(cwd, absolutePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  const hash = createHash('sha256').update(absolutePath).digest('hex').slice(0, 8);
  const parsed = path.parse(absolutePath);
  return `${parsed.name}-${hash}${parsed.ext}`;
}

export async function discoverInputs(
  rawInputs: string[],
  options: ResolvedCliOptions,
  signal?: AbortSignal,
): Promise<ResolvedInput[]> {
  if (rawInputs.length === 0) throw inputError('Provide at least one file, directory, glob, or - for stdin');
  if (rawInputs.includes('-') && rawInputs.length !== 1) throw inputError('stdin (-) must be the only input');

  if (rawInputs[0] === '-') {
    if (process.stdin.isTTY) throw inputError('stdin input was requested, but no data is being piped');
    const discoveryLimit = Math.min(
      options.maxTotalMb * 1024 * 1024,
      Math.max(FILE_CONSTRAINTS.MAX_IMAGE_SIZE, FILE_CONSTRAINTS.MAX_PDF_SIZE),
    );
    const stdinBytes = await readStdin(discoveryLimit, signal);
    if (stdinBytes.byteLength === 0) throw inputError('<stdin> is empty');
    const mimeType = detectMimeType(options.stdinName, options.stdinType, stdinBytes);
    const { bytes: mimeLimit, label } = maxFileSizeForMime(mimeType);
    if (stdinBytes.byteLength > mimeLimit) {
      throw inputError(`<stdin> exceeds the ${label} ${mimeType === 'application/pdf' ? 'PDF' : 'image'} limit`);
    }
    return [{
      displayPath: '<stdin>',
      relativePath: options.stdinName,
      name: options.stdinName,
      mimeType,
      size: stdinBytes.byteLength,
      mtimeMs: 0,
      stdinBytes,
    }];
  }

  const expanded = (await Promise.all(rawInputs.map((input) => expandInput(input, options)))).flat();
  const unique = [...new Set(expanded.map((input) => path.resolve(input)))].sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) throw inputError('No supported documents matched the supplied inputs');

  const inputs = await Promise.all(unique.map(async (absolutePath): Promise<ResolvedInput> => {
    const stat = await fs.stat(absolutePath);
    const mimeType = await detectLocalMimeType(absolutePath);
    return {
      absolutePath,
      displayPath: safeRelativePath(options.cwd, absolutePath),
      relativePath: safeRelativePath(options.cwd, absolutePath),
      name: path.basename(absolutePath),
      mimeType,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }));

  if (inputs.length > options.maxFiles) {
    throw inputError(`Matched ${inputs.length} files, exceeding --max-files ${options.maxFiles}`);
  }
  const totalBytes = inputs.reduce((sum, input) => sum + input.size, 0);
  const maxBytes = options.maxTotalMb * 1024 * 1024;
  if (totalBytes > maxBytes) {
    throw inputError(`Matched documents total ${(totalBytes / 1024 / 1024).toFixed(1)}MB, exceeding --max-total-mb ${options.maxTotalMb}`);
  }

  return inputs;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function fourCcAt(bytes: Uint8Array, offset: number): string | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return undefined;
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function isoBmffBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 12 || fourCcAt(bytes, 4) !== 'ftyp') return [];
  const boxSize = (
    bytes[0] * 0x1000000
    + bytes[1] * 0x10000
    + bytes[2] * 0x100
    + bytes[3]
  );
  // Extended-size ftyp boxes are unusual and cannot be validated from the
  // bounded sniffing prefix, so reject them instead of guessing.
  if (boxSize === 1 || (boxSize !== 0 && boxSize < 16)) return [];
  const boxEnd = boxSize === 0 ? bytes.length : Math.min(boxSize, bytes.length);
  const majorBrand = fourCcAt(bytes, 8);
  if (!majorBrand) return [];
  const brands = [majorBrand];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    const brand = fourCcAt(bytes, offset);
    if (brand) brands.push(brand);
  }
  return brands;
}

function sniffHeifMimeType(bytes: Uint8Array): 'image/heic' | 'image/heif' | undefined {
  const brands = isoBmffBrands(bytes);
  // AVIF is also HEIF-based. Its explicit brand wins over compatible HEVC
  // brands so a mixed/crafted ftyp box cannot smuggle unsupported AVIF input.
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return undefined;
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'image/heic';
  return brands.some((brand) => HEIF_BRANDS.has(brand)) ? 'image/heif' : undefined;
}

function magicBytesMatch(bytes: Uint8Array, mimeType: string): boolean {
  const startsWith = (signature: readonly number[]): boolean => signature.every((byte, index) => bytes[index] === byte);
  switch (mimeType) {
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff]);
    case 'image/webp':
      return startsWith([0x52, 0x49, 0x46, 0x46]) && startsWithAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
    case 'image/gif':
      return startsWith([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
        || startsWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    case 'application/pdf':
      return startsWith([0x25, 0x50, 0x44, 0x46]);
    case 'image/heic':
      return sniffHeifMimeType(bytes) === 'image/heic';
    case 'image/heif':
      return sniffHeifMimeType(bytes) === 'image/heif';
    default:
      return false;
  }
}

/** Sniff a document MIME type from the bounded signatures accepted by the CLI. */
export function sniffDocumentMimeType(bytes: Uint8Array): string | undefined {
  const common = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
  const matched = common.find((mimeType) => magicBytesMatch(bytes, mimeType));
  if (matched) return matched;
  return sniffHeifMimeType(bytes);
}

function startsWithAt(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export async function readAndValidateInput(input: ResolvedInput): Promise<{ bytes: Uint8Array; dataUrl: string }> {
  const { bytes: maxBytes, label } = maxFileSizeForMime(input.mimeType);
  let bytes: Uint8Array;
  if (input.stdinBytes) {
    bytes = input.stdinBytes;
  } else {
    const absolutePath = input.absolutePath;
    if (!absolutePath) throw inputError(`${input.displayPath} has no readable input path`);
    try {
      const currentSize = (await fs.stat(absolutePath)).size;
      if (currentSize > maxBytes) {
        throw inputError(
          `${input.displayPath} exceeds the ${label} ${input.mimeType === 'application/pdf' ? 'PDF' : 'image'} limit`,
        );
      }
      const handle = await fs.open(absolutePath, 'r');
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      try {
        while (totalBytes <= maxBytes) {
          const readSize = Math.min(1024 * 1024, maxBytes + 1 - totalBytes);
          const chunk = Buffer.allocUnsafe(readSize);
          const { bytesRead } = await handle.read(chunk, 0, readSize, null);
          if (bytesRead === 0) break;
          chunks.push(chunk.subarray(0, bytesRead));
          totalBytes += bytesRead;
        }
      } finally {
        await handle.close();
      }
      bytes = Buffer.concat(chunks, totalBytes);
    } catch (error) {
      if (error instanceof CliExitError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw inputError(`Input no longer exists: ${input.displayPath}`, 'INPUT_NOT_FOUND');
      }
      throw inputError(
        `Could not read ${input.displayPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (bytes.byteLength === 0) throw inputError(`${input.displayPath} is empty`);
  if (bytes.byteLength > maxBytes) {
    throw inputError(
      `${input.displayPath} exceeds the ${label} ${input.mimeType === 'application/pdf' ? 'PDF' : 'image'} limit`,
    );
  }
  if (!magicBytesMatch(bytes.subarray(0, 256), input.mimeType)) {
    throw inputError(`${input.displayPath} does not match its declared type (${input.mimeType})`);
  }

  if (input.mimeType === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      // Buffer#slice returns another Buffer, which pdf.js deliberately rejects;
      // Uint8Array.from always creates the runtime-neutral byte type it expects.
      data: Uint8Array.from(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    try {
      const pdf = await loadingTask.promise;
      try {
        if (pdf.numPages > FILE_CONSTRAINTS.MAX_PDF_PAGES) {
          throw inputError(`${input.displayPath} has ${pdf.numPages} pages; the maximum is ${FILE_CONSTRAINTS.MAX_PDF_PAGES}`);
        }
      } finally {
        await pdf.destroy();
      }
    } catch (error) {
      if (error instanceof CliExitError) throw error;
      try {
        await loadingTask.destroy();
      } catch {
        // Preserve the input-validation error when pdf.js cleanup also fails.
      }
      throw inputError(
        `${input.displayPath} is not a valid PDF: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    bytes,
    dataUrl: `data:${input.mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
  };
}

export function inputFingerprint(input: ResolvedInput, modeKey: string): string {
  const identity = input.absolutePath ?? `<stdin:${input.relativePath}>`;
  const fingerprint = createHash('sha256')
    .update(`${identity}\0${input.size}\0${input.mtimeMs}\0${modeKey}`);
  if (input.stdinBytes) fingerprint.update('\0stdin-bytes\0').update(input.stdinBytes);
  return fingerprint.digest('hex');
}
