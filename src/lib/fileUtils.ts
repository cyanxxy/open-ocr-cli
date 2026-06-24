/**
 * This module provides utilities for file validation and reading files as Data URLs.
 * It ensures files meet specific size and type constraints before processing.
 */

import { logger } from './logger';
import { FILE_CONSTRAINTS } from '../constants';

/** Maximum allowed file size in bytes */
const MAX_FILE_SIZE = FILE_CONSTRAINTS.MAX_SIZE;

/**
 * Batch ingestion budgets for bulk processing (audit H-10).
 * These cap how much work a single bulk run can queue so a browser tab cannot
 * be asked to read tens of gigabytes of base64 simultaneously, and so the
 * sequential API loop cannot run unbounded.
 */
export const BULK_LIMITS = {
  /** Maximum number of files allowed in a single bulk queue. */
  MAX_FILES: 200,
  /** Maximum combined byte size across all queued files (500 MB). */
  MAX_TOTAL_BYTES: 500 * 1024 * 1024,
  /** Human-readable label for the total-byte ceiling. */
  MAX_TOTAL_BYTES_LABEL: '500MB',
} as const;

/**
 * Returns a cryptographically-random v4 UUID. Prefers the native
 * `crypto.randomUUID()` (all modern browsers, Node 19+) and falls back to a
 * `crypto.getRandomValues()`-based implementation when `randomUUID` is missing
 * (e.g. some test environments). Used for collision-proof file ids (audit
 * B-01 / U-02).
 */
export function generateUuid(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  // Per RFC 4122 §4.4: set version (4) and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}

/**
 * MIME types for which we lack a reliable client-side decoder. They are valid
 * inputs for the Gemini API (sent as inlineData), but the browser cannot render
 * a preview for them, so callers should suppress image previews (audit B-09).
 */
const NON_PREVIEWABLE_IMAGE_MIME_TYPES: readonly string[] = ['image/heic', 'image/heif'];

/**
 * Returns true when the file is an image whose bytes cannot be rendered by the
 * browser's <img>/createImageBitmap pipeline (currently HEIC/HEIF). Callers use
 * this to avoid showing a broken-image icon while still allowing the upload to
 * reach the API (audit B-09).
 */
export function isNonPreviewableImage(file: File): boolean {
  return NON_PREVIEWABLE_IMAGE_MIME_TYPES.includes(file.type);
}

/**
 * Validates a file based on its size and MIME type.
 * Allowed types are images (e.g., `image/png`, `image/jpeg`) and PDFs (`application/pdf`).
 * The maximum file size is 20MB.
 *
 * @param file - The {@link File} object to validate.
 * @returns An object containing a `valid` boolean and an optional `error` message string if validation fails.
 */
export function validateFile(file: File | null | undefined): { valid: boolean; error?: string } {
  // Check if file exists
  if (!file) {
    return {
      valid: false,
      error: 'No file provided.'
    };
  }

  // Reject empty / zero-byte files: they cannot contain a decodable document
  // and would otherwise be sent to the API as an empty payload (audit B-04).
  if (file.size === 0) {
    return {
      valid: false,
      error: `File "${file.name}" is empty.`
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File "${file.name}" exceeds the maximum size of ${FILE_CONSTRAINTS.MAX_SIZE_LABEL}.`
    };
  }

  // Check file type
  const supportedMimeTypes: readonly string[] = [
    ...FILE_CONSTRAINTS.SUPPORTED_IMAGE_MIME_TYPES,
    ...FILE_CONSTRAINTS.SUPPORTED_DOCUMENT_MIME_TYPES,
  ];

  if (!supportedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File "${file.name}" is of an unsupported type (${file.type || 'unknown'}). Supported formats: PNG, JPEG, WEBP, HEIC, HEIF, and PDF.`
    };
  }

  return { valid: true };
}

/**
 * Inspects the leading bytes of a buffer to confirm the declared MIME type is
 * not spoofed (e.g. an executable renamed to .png). The OS assigns `file.type`
 * from the extension, so a magic-number check is the only client-side defence
 * against a file that lies about its format (audit B-04).
 *
 * Returns true when the bytes are consistent with `mimeType`. Unknown/edge
 * formats (e.g. HEIC, which has a variable ftyp box) are accepted rather than
 * rejected to avoid false negatives — the API remains the final arbiter.
 */
function magicBytesMatchMimeType(bytes: Uint8Array, mimeType: string): boolean {
  const startsWith = (sig: number[]): boolean =>
    sig.every((byte, index) => bytes[index] === byte);

  switch (mimeType) {
    case 'image/png':
      // 89 50 4E 47 0D 0A 1A 0A
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      // FF D8 FF
      return startsWith([0xff, 0xd8, 0xff]);
    case 'image/webp':
      // "RIFF" .... "WEBP"
      return (
        startsWith([0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case 'application/pdf':
      // "%PDF"
      return startsWith([0x25, 0x50, 0x44, 0x46]);
    case 'image/heic':
    case 'image/heif':
      // HEIC/HEIF carry an ISO-BMFF "ftyp" box at offset 4; the brand varies.
      // Accept when the ftyp marker is present, otherwise do not block.
      return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    default:
      // No signature known for this (already MIME-validated) type — do not block.
      return true;
  }
}

/**
 * Reads the first bytes of a file and verifies they match the declared MIME
 * type, guarding against MIME spoofing (audit B-04). This is async because it
 * must read file bytes; callers should run it after the synchronous
 * {@link validateFile} passes.
 *
 * @param file - The {@link File} object to inspect.
 * @returns A Promise resolving to `{ valid, error? }`.
 */
export async function validateFileMagicBytes(
  file: File
): Promise<{ valid: boolean; error?: string }> {
  try {
    const header = file.slice(0, 16);
    const buffer = await header.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (!magicBytesMatchMimeType(bytes, file.type)) {
      return {
        valid: false,
        error: `File "${file.name}" does not match its declared type (${file.type || 'unknown'}).`
      };
    }
    return { valid: true };
  } catch (error) {
    logger.error('Magic-byte validation failed:', error);
    return {
      valid: false,
      error: `File "${file.name}" could not be read for validation.`
    };
  }
}

/**
 * Reads the contents of a {@link File} object and returns it as a Data URL string.
 *
 * @param file - The {@link File} object to read.
 * @returns A Promise that resolves with the file's content as a Data URL string.
 * @throws Rejects the promise if the file reading fails, is aborted, or if the result is not a string.
 */
export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Invalid file data'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = (event) => {
      logger.error('FileReader error:', event);
      reject(new Error('Failed to read file: ' + (event.target?.error?.message || 'Unknown error')));
    };
    // Settle the promise if the read is aborted (e.g. reader.abort() during
    // teardown); without this the promise would hang forever (audit B-06).
    reader.onabort = () => {
      reject(new Error('File read aborted'));
    };
    reader.readAsDataURL(file);
  });
}
