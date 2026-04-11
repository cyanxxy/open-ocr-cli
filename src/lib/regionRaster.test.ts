import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocument, mockPdfRender } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockPdfRender: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: mockGetDocument,
}));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({
  default: '/mock-pdf-worker.mjs',
}));

import {
  assertNormalizedRegion,
  cropImageRegion,
  renderPdfPageRegion,
} from './regionRaster';

class MockCanvasRenderingContext2D {
  drawImage = vi.fn();
}

class MockCanvasElement {
  width = 0;
  height = 0;
  context = new MockCanvasRenderingContext2D();

  getContext() {
    return this.context;
  }

  toDataURL() {
    return `data:image/png;base64,${btoa(`${this.width}x${this.height}`)}`;
  }
}

class MockImageElement {
  width = 200;
  height = 100;
  naturalWidth = 200;
  naturalHeight = 100;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.();
    });
  }
}

describe('regionRaster', () => {
  const originalCreateElement = document.createElement.bind(document);
  const originalImage = globalThis.Image;
  let canvases: MockCanvasElement[] = [];

  beforeEach(() => {
    canvases = [];
    mockGetDocument.mockReset();
    mockPdfRender.mockReset();

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        const canvas = new MockCanvasElement();
        canvases.push(canvas);
        return canvas as unknown as HTMLElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    Object.defineProperty(globalThis, 'Image', {
      value: MockImageElement,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'Image', {
      value: originalImage,
      writable: true,
    });
  });

  it('crops an image using normalized coordinates', async () => {
    const result = await cropImageRegion('data:image/png;base64,ZmFrZQ==', {
      page: 1,
      x: 0.25,
      y: 0.1,
      width: 0.25,
      height: 0.3,
      units: 'normalized',
    });

    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 50,
      height: 30,
    });
    expect(canvases).toHaveLength(1);
    expect(canvases[0]?.context.drawImage).toHaveBeenCalledWith(
      expect.any(MockImageElement),
      50,
      10,
      50,
      30,
      0,
      0,
      50,
      30,
    );
  });

  it('renders a PDF page with pdfjs-dist before cropping the normalized region', async () => {
    mockPdfRender.mockReturnValue({ promise: Promise.resolve() });
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(({ scale }) => ({ width: 300 * scale, height: 200 * scale })),
          render: mockPdfRender,
        }),
      }),
    });

    const result = await renderPdfPageRegion('data:application/pdf;base64,ZmFrZQ==', {
      page: 2,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.25,
      units: 'normalized',
    });

    expect(mockGetDocument).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
    });
    expect(mockPdfRender).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 300,
      height: 100,
    });
    expect(canvases).toHaveLength(2);
    expect(canvases[1]?.context.drawImage).toHaveBeenCalledWith(
      canvases[0],
      60,
      80,
      300,
      100,
      0,
      0,
      300,
      100,
    );
  });

  it('rejects invalid normalized regions', () => {
    expect(() => assertNormalizedRegion({
      page: 1,
      x: 0.9,
      y: 0.2,
      width: 0.2,
      height: 0.2,
      units: 'normalized',
    })).toThrow('"region" must be a normalized region object');
  });
});
