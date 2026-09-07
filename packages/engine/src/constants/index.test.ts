import { describe, it, expect } from 'vitest';
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
});
