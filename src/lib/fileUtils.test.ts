import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateFile, readFileAsDataUrl } from './fileUtils';

describe('fileUtils', () => {
  describe('validateFile', () => {
    it('should accept valid image files', () => {
      const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid PDF files', () => {
      const file = new File(['dummy content'], 'test.pdf', {
        type: 'application/pdf',
      });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject files that are too large', () => {
      // Mock a file object with a size larger than MAX_FILE_SIZE (20MB)
      const file = new File(['dummy content'], 'large.jpg', {
        type: 'image/jpeg',
      });
      Object.defineProperty(file, 'size', { value: 21 * 1024 * 1024 });

      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds the maximum size');
    });

    it('should reject files of invalid type', () => {
      const file = new File(['dummy content'], 'test.txt', {
        type: 'text/plain',
      });
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unsupported type');
    });

    it('should accept PNG files', () => {
      const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should accept WEBP files', () => {
      const file = new File(['dummy content'], 'test.webp', {
        type: 'image/webp',
      });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should accept HEIC files', () => {
      const file = new File(['dummy content'], 'test.heic', { type: 'image/heic' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should reject unsupported image MIME types', () => {
      const file = new File(['dummy content'], 'test.gif', { type: 'image/gif' });
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Supported formats: PNG, JPEG, WEBP, HEIC, HEIF, and PDF');
    });

    it('should accept files at exactly the size limit', () => {
      const file = new File(['dummy content'], 'exact.jpg', {
        type: 'image/jpeg',
      });
      Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });

      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should reject null file', () => {
      const result = validateFile(null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No file provided.');
    });

    it('should reject undefined file', () => {
      const result = validateFile(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No file provided.');
    });
  });

  describe('readFileAsDataUrl', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should read a file as data URL', async () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      const result = await readFileAsDataUrl(file);
      expect(result).toContain('data:');
    });

    it('should reject when FileReader errors', async () => {
      // Create a custom FileReader mock that triggers error
      const OriginalFileReader = globalThis.FileReader;

      class ErrorFileReader {
        result: string | null = null;
        error = { message: 'Read failed' };
        onload: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;

        readAsDataURL() {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror({ target: this });
            }
          }, 0);
        }
      }

      globalThis.FileReader = ErrorFileReader as unknown as typeof FileReader;

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      await expect(readFileAsDataUrl(file)).rejects.toThrow('Failed to read file');

      // Restore original
      globalThis.FileReader = OriginalFileReader;
    });
  });
});
