import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateFile,
  readFileAsDataUrl,
  validateFileMagicBytes,
  generateUuid,
  isNonPreviewableImage,
} from './fileUtils';

/** Build a File whose raw bytes are the provided byte array. */
const fileFromBytes = (bytes: number[], name: string, type: string): File => {
  return new File([new Uint8Array(bytes)], name, { type });
};

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

    it('should reject images larger than 100MB', () => {
      const file = new File(['dummy content'], 'large.jpg', {
        type: 'image/jpeg',
      });
      Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 });

      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds the maximum size');
      expect(result.error).toMatch(/100MB|images/i);
    });

    it('should reject PDFs larger than 50MB', () => {
      const file = new File(['dummy content'], 'large.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });

      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds the maximum size');
      expect(result.error).toMatch(/50MB|PDFs/i);
    });

    it('should accept PDFs at or under 50MB', () => {
      const file = new File(['dummy content'], 'ok.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });

      expect(validateFile(file).valid).toBe(true);
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

    it('should reject empty (zero-byte) files (audit B-04)', () => {
      const file = new File([], 'empty.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 0 });

      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });
  });

  describe('validateFileMagicBytes (audit B-04)', () => {
    it('accepts a PNG whose bytes match the declared type', async () => {
      const png = fileFromBytes(
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
        'real.png',
        'image/png'
      );
      const result = await validateFileMagicBytes(png);
      expect(result.valid).toBe(true);
    });

    it('rejects a file declared image/png but carrying ELF magic bytes', async () => {
      // 0x7F 'E' 'L' 'F' is the ELF executable signature.
      const spoofed = fileFromBytes([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0], 'malware.png', 'image/png');
      const result = await validateFileMagicBytes(spoofed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not match');
    });

    it('accepts a valid PDF header', async () => {
      const pdf = fileFromBytes([0x25, 0x50, 0x44, 0x46, 0x2d], 'doc.pdf', 'application/pdf');
      const result = await validateFileMagicBytes(pdf);
      expect(result.valid).toBe(true);
    });
  });

  describe('isNonPreviewableImage (audit B-09)', () => {
    it('returns true for HEIC/HEIF', () => {
      expect(isNonPreviewableImage(new File(['x'], 'a.heic', { type: 'image/heic' }))).toBe(true);
      expect(isNonPreviewableImage(new File(['x'], 'a.heif', { type: 'image/heif' }))).toBe(true);
    });

    it('returns false for renderable images and PDFs', () => {
      expect(isNonPreviewableImage(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(false);
      expect(isNonPreviewableImage(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
    });
  });

  describe('generateUuid (audit B-01)', () => {
    it('returns unique values across many calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateUuid());
      }
      expect(ids.size).toBe(1000);
    });

    it('returns a v4 UUID shape', () => {
      const id = generateUuid();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
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

    it('should reject (not hang) when the read is aborted (audit B-06)', async () => {
      const OriginalFileReader = globalThis.FileReader;

      class AbortFileReader {
        result: string | null = null;
        onload: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onabort: ((e: unknown) => void) | null = null;

        readAsDataURL() {
          setTimeout(() => {
            if (this.onabort) {
              this.onabort({ target: this });
            }
          }, 0);
        }
      }

      globalThis.FileReader = AbortFileReader as unknown as typeof FileReader;

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      await expect(readFileAsDataUrl(file)).rejects.toThrow('File read aborted');

      globalThis.FileReader = OriginalFileReader;
    });
  });
});
