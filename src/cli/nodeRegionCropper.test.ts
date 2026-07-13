import { createCanvas } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { nodeRegionCropper } from './nodeRegionCropper';

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
    const previousGlobals = {
      DOMMatrix: globalThis.DOMMatrix,
      ImageData: globalThis.ImageData,
      Path2D: globalThis.Path2D,
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
    expect(globalThis.DOMMatrix).toBe(previousGlobals.DOMMatrix);
    expect(globalThis.ImageData).toBe(previousGlobals.ImageData);
    expect(globalThis.Path2D).toBe(previousGlobals.Path2D);
  });
});
