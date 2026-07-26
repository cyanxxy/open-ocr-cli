import { createCanvas } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { nodeRegionCropper } from './nodeRegionCropper';

// pdf.js may detach the buffer it is handed, so every call needs its own copy.
function malformedPdfBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from('%PDF-1.4 broken'));
}

describe('Node region cropper', () => {
  it('crops image regions for agentic re-OCR', async () => {
    const canvas = createCanvas(100, 80);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 100, 80);
    context.fillStyle = '#000';
    context.fillRect(50, 40, 50, 40);
    const dataUrl = `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
    const result = await nodeRegionCropper(dataUrl, 'image/png', {
      page: 1,
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
      units: 'normalized',
    });
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(50);
    expect(result.height).toBe(40);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects invalid pages and MIME types', async () => {
    await expect(nodeRegionCropper('data:image/png;base64,AA==', 'image/png', {
      page: 2, x: 0, y: 0, width: 1, height: 1, units: 'normalized',
    })).rejects.toThrow('only contain page 1');
    await expect(nodeRegionCropper('data:text/plain;base64,QQ==', 'text/plain', {
      page: 1, x: 0, y: 0, width: 1, height: 1, units: 'normalized',
    })).rejects.toThrow('not supported');
  });

  it('renders and crops PDF pages for agentic re-OCR', async () => {
    // The cropper installs @napi-rs/canvas classes as globals while pdf.js
    // renders; these names are not declared in the CLI's DOM-free lib set.
    const canvasGlobals = globalThis as unknown as Record<'DOMMatrix' | 'ImageData' | 'Path2D', unknown>;
    const previousGlobals = {
      DOMMatrix: canvasGlobals.DOMMatrix,
      ImageData: canvasGlobals.ImageData,
      Path2D: canvasGlobals.Path2D,
    };
    const bytes = await readFile(path.resolve(process.cwd(), 'evals/corpus/invoice.pdf'));
    const result = await nodeRegionCropper(
      `data:application/pdf;base64,${bytes.toString('base64')}`,
      'application/pdf',
      { page: 1, x: 0.5, y: 0.5, width: 0.25, height: 0.25, units: 'normalized' },
    );
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(100);
    expect(canvasGlobals.DOMMatrix).toBe(previousGlobals.DOMMatrix);
    expect(canvasGlobals.ImageData).toBe(previousGlobals.ImageData);
    expect(canvasGlobals.Path2D).toBe(previousGlobals.Path2D);
  });

  it('pins pdf.js verbosity so rendering cannot re-enable stderr warnings', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // Verbosity is module-global in pdf.js, so a render that omitted it would
      // leave warnings enabled for every later document in the same process.
      await pdfjs.getDocument({
        data: malformedPdfBytes(),
        verbosity: pdfjs.VerbosityLevel.WARNINGS,
      }).promise.catch(() => undefined);
      expect(consoleWarn).toHaveBeenCalled();

      const bytes = await readFile(path.resolve(process.cwd(), 'evals/corpus/invoice.pdf'));
      await nodeRegionCropper(
        `data:application/pdf;base64,${bytes.toString('base64')}`,
        'application/pdf',
        { page: 1, x: 0, y: 0, width: 1, height: 1, units: 'normalized' },
      );

      consoleWarn.mockClear();
      await pdfjs.getDocument({ data: malformedPdfBytes() }).promise.catch(() => undefined);
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
