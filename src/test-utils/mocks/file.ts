import { vi } from 'vitest';

export class MockFileReader {
  result: string | ArrayBuffer | null = 'data:image/png;base64,testbase64data';
  error: DOMException | null = null;
  readyState: number = 0;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL(_blob: Blob) {
    this.readyState = 1;
    setTimeout(() => {
      this.result = 'data:image/png;base64,testbase64data';
      this.readyState = 2;
      if (this.onload) {
        this.onload({ target: this } as unknown as ProgressEvent<FileReader>);
      }
      if (this.onloadend) {
        this.onloadend({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    }, 0);
  }

  readAsText(_blob: Blob) {
    this.readyState = 1;
    setTimeout(() => {
      this.result = 'mock text content';
      this.readyState = 2;
      if (this.onload) {
        this.onload({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    }, 0);
  }

  readAsArrayBuffer(_blob: Blob) {
    this.readyState = 1;
    setTimeout(() => {
      this.result = new ArrayBuffer(8);
      this.readyState = 2;
      if (this.onload) {
        this.onload({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    }, 0);
  }

  abort() {
    this.readyState = 2;
    if (this.onabort) {
      this.onabort({ target: this } as unknown as ProgressEvent<FileReader>);
    }
  }

  static readonly EMPTY = 0;
  static readonly LOADING = 1;
  static readonly DONE = 2;
}

export const createMockFile = (
  name = 'test.png',
  type = 'image/png',
  size = 1024,
  content = 'test content'
): File => {
  const file = new File([content], name, { type });
  if (size !== content.length) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
};

export const createMockPdfFile = (name = 'test.pdf', size = 1024): File => {
  return createMockFile(name, 'application/pdf', size, '%PDF-1.4 test');
};

export const createMockImageFile = (name = 'test.jpg', size = 1024): File => {
  return createMockFile(name, 'image/jpeg', size);
};

export const mockURLCreateObjectURL = vi.fn(() => 'blob:mock-url');
export const mockURLRevokeObjectURL = vi.fn();
