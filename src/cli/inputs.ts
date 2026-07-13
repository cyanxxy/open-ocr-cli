import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import fg from 'fast-glob';

import { FILE_CONSTRAINTS, maxFileSizeForMime } from '../constants';
import type { ResolvedCliOptions, ResolvedInput } from './types';

const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const SUPPORTED_GLOB = '**/*.{pdf,png,jpg,jpeg,webp,heic,heif}';

export function detectMimeType(filePath: string, explicitMime?: string): string {
  if (explicitMime) {
    const supported = [
      ...FILE_CONSTRAINTS.SUPPORTED_IMAGE_MIME_TYPES,
      ...FILE_CONSTRAINTS.SUPPORTED_DOCUMENT_MIME_TYPES,
    ];
    if (!supported.includes(explicitMime as never)) throw new Error(`Unsupported MIME type: ${explicitMime}`);
    return explicitMime;
  }
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = EXTENSION_TO_MIME[extension];
  if (!mimeType) throw new Error(`Unsupported document extension: ${extension || '(none)'}`);
  return mimeType;
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

  if (!isGlobPattern(value)) throw new Error(`Input does not exist: ${value}`);
  return fg(value, {
    cwd: options.cwd,
    absolute: true,
    onlyFiles: true,
    dot: options.hidden,
    followSymbolicLinks: false,
    ignore: options.excludes,
  });
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function safeRelativePath(cwd: string, absolutePath: string): string {
  const relative = path.relative(cwd, absolutePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  const hash = createHash('sha256').update(absolutePath).digest('hex').slice(0, 8);
  const parsed = path.parse(absolutePath);
  return `${parsed.name}-${hash}${parsed.ext}`;
}

export async function discoverInputs(rawInputs: string[], options: ResolvedCliOptions): Promise<ResolvedInput[]> {
  if (rawInputs.length === 0) throw new Error('Provide at least one file, directory, glob, or - for stdin');
  if (rawInputs.includes('-') && rawInputs.length !== 1) throw new Error('stdin (-) must be the only input');

  if (rawInputs[0] === '-') {
    if (process.stdin.isTTY) throw new Error('stdin input was requested, but no data is being piped');
    const stdinBytes = await readStdin();
    const mimeType = detectMimeType(options.stdinName, options.stdinType);
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
  if (unique.length === 0) throw new Error('No supported documents matched the supplied inputs');

  const inputs = await Promise.all(unique.map(async (absolutePath): Promise<ResolvedInput> => {
    const stat = await fs.stat(absolutePath);
    const mimeType = detectMimeType(absolutePath);
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
    throw new Error(`Matched ${inputs.length} files, exceeding --max-files ${options.maxFiles}`);
  }
  const totalBytes = inputs.reduce((sum, input) => sum + input.size, 0);
  const maxBytes = options.maxTotalMb * 1024 * 1024;
  if (totalBytes > maxBytes) {
    throw new Error(`Matched documents total ${(totalBytes / 1024 / 1024).toFixed(1)}MB, exceeding --max-total-mb ${options.maxTotalMb}`);
  }

  return inputs;
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
    case 'application/pdf':
      return startsWith([0x25, 0x50, 0x44, 0x46]);
    case 'image/heic':
    case 'image/heif':
      return startsWithAt(bytes, 4, [0x66, 0x74, 0x79, 0x70]);
    default:
      return false;
  }
}

function startsWithAt(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export async function readAndValidateInput(input: ResolvedInput): Promise<{ bytes: Uint8Array; dataUrl: string }> {
  const currentSize = input.stdinBytes?.byteLength ?? (await fs.stat(input.absolutePath!)).size;
  const { bytes: maxBytes, label } = maxFileSizeForMime(input.mimeType);
  if (currentSize === 0) throw new Error(`${input.displayPath} is empty`);
  if (currentSize > maxBytes) {
    throw new Error(
      `${input.displayPath} exceeds the ${label} ${input.mimeType === 'application/pdf' ? 'PDF' : 'image'} limit`,
    );
  }
  const bytes = input.stdinBytes ?? await fs.readFile(input.absolutePath!);
  if (!magicBytesMatch(bytes.subarray(0, 16), input.mimeType)) {
    throw new Error(`${input.displayPath} does not match its declared type (${input.mimeType})`);
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
    const pdf = await loadingTask.promise;
    try {
      if (pdf.numPages > FILE_CONSTRAINTS.MAX_PDF_PAGES) {
        throw new Error(`${input.displayPath} has ${pdf.numPages} pages; the maximum is ${FILE_CONSTRAINTS.MAX_PDF_PAGES}`);
      }
    } finally {
      await pdf.destroy();
    }
  }

  return {
    bytes,
    dataUrl: `data:${input.mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
  };
}

export function inputFingerprint(input: ResolvedInput, modeKey: string): string {
  return createHash('sha256')
    .update(`${input.absolutePath ?? '<stdin>'}\0${input.size}\0${input.mtimeMs}\0${modeKey}`)
    .digest('hex');
}
