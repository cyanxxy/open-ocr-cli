import { describe, it, expect } from 'vitest';
import * as constants from './index';
import { FILE_CONSTRAINTS, maxFileSizeForMime } from './index';

describe('constants', () => {
  it('keeps the file constraints the CLI consumes', () => {
    expect(FILE_CONSTRAINTS.MAX_IMAGE_SIZE).toBe(70 * 1024 * 1024);
    expect(FILE_CONSTRAINTS.MAX_PDF_SIZE).toBe(50 * 1024 * 1024);
    expect(FILE_CONSTRAINTS.MAX_PDF_PAGES).toBe(1000);
    expect(FILE_CONSTRAINTS.SUPPORTED_IMAGE_MIME_TYPES).toContain('image/png');
    expect(FILE_CONSTRAINTS.SUPPORTED_DOCUMENT_MIME_TYPES).toEqual(['application/pdf']);
  });

  it('resolves the per-MIME upload limit', () => {
    expect(maxFileSizeForMime('application/pdf')).toEqual({
      bytes: FILE_CONSTRAINTS.MAX_PDF_SIZE,
      label: '50MB',
    });
    expect(maxFileSizeForMime('image/png')).toEqual({
      bytes: FILE_CONSTRAINTS.MAX_IMAGE_SIZE,
      label: '70MB',
    });
  });

  it('drops the dead OCR_OPTIONS / AGENT_CONFIG / ROUTES exports (audit M-06)', () => {
    expect('OCR_OPTIONS' in constants).toBe(false);
    expect('AGENT_CONFIG' in constants).toBe(false);
    expect('ROUTES' in constants).toBe(false);
  });

  it('drops the browser-only constants left behind by the web app removal', () => {
    expect('UI_TIMING' in constants).toBe(false);
    expect('STORAGE_KEYS' in constants).toBe(false);
    expect('MAX_SIZE' in FILE_CONSTRAINTS).toBe(false);
    expect('MAX_SIZE_LABEL' in FILE_CONSTRAINTS).toBe(false);
    expect('ACCEPTED_IMAGE_TYPES' in FILE_CONSTRAINTS).toBe(false);
    expect('ACCEPTED_DOCUMENT_TYPES' in FILE_CONSTRAINTS).toBe(false);
    expect('ACCEPTED_MIME_TYPES' in FILE_CONSTRAINTS).toBe(false);
  });
});
