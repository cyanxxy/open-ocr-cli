/**
 * This module provides utilities for file validation and reading files as Data URLs.
 * It ensures files meet specific size and type constraints before processing.
 */

import { logger } from './logger';
import { FILE_CONSTRAINTS } from '../constants';

/** Maximum allowed file size in bytes */
const MAX_FILE_SIZE = FILE_CONSTRAINTS.MAX_SIZE;

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
 * Reads the contents of a {@link File} object and returns it as a Data URL string.
 *
 * @param file - The {@link File} object to read.
 * @returns A Promise that resolves with the file's content as a Data URL string.
 * @throws Rejects the promise if the file reading fails or if the result is not a string.
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
    reader.readAsDataURL(file);
  });
}
