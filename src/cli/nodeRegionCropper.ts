import { Buffer } from 'node:buffer';

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import sharp from 'sharp';

import type { NormalizedRegion, RegionCropResult, RegionCropper } from '../lib/agentTypes';

const PDF_RENDER_SCALE = 2;
const CANVAS_GLOBAL_NAMES = ['DOMMatrix', 'ImageData', 'Path2D'] as const;
type CanvasGlobalName = (typeof CANVAS_GLOBAL_NAMES)[number];
const canvasGlobalValues: Readonly<Record<CanvasGlobalName, unknown>> = { DOMMatrix, ImageData, Path2D };
let pdfRenderQueue: Promise<void> = Promise.resolve();

function base64Bytes(fileData: string): Buffer {
  const payload = fileData.includes(',') ? fileData.split(',')[1] || '' : fileData;
  if (!payload) throw new Error('Document data is missing its base64 payload');
  return Buffer.from(payload, 'base64');
}

function pixelBox(region: NormalizedRegion, width: number, height: number) {
  const left = Math.max(0, Math.min(width - 1, Math.floor(region.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(region.y * height)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil((region.x + region.width) * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil((region.y + region.height) * height)));
  return { left, top, width: right - left, height: bottom - top };
}

async function cropRaster(bytes: Buffer, region: NormalizedRegion): Promise<RegionCropResult> {
  const image = sharp(bytes, { failOn: 'error' });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Unable to determine document image dimensions');
  const box = pixelBox(region, metadata.width, metadata.height);
  const output = await image.extract(box).png().toBuffer();
  return {
    dataUrl: `data:image/png;base64,${output.toString('base64')}`,
    mimeType: 'image/png',
    width: box.width,
    height: box.height,
  };
}

async function renderPdfPage(bytes: Buffer, region: NormalizedRegion): Promise<Buffer> {
  let releaseQueue: () => void = () => undefined;
  const previousRender = pdfRenderQueue;
  const currentRender = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  pdfRenderQueue = previousRender.then(() => currentRender);
  await previousRender;

  // pdf.js constructs Path2D objects through globals. Point those globals at
  // the exact canvas implementation used by the rendering context; mixing the
  // DOM or a second native Path2D class makes ctx.fill(path) reject the value.
  const globals = globalThis as unknown as Record<CanvasGlobalName, unknown>;
  const previousGlobals = Object.fromEntries(
    CANVAS_GLOBAL_NAMES.map((name) => [name, {
      existed: Object.prototype.hasOwnProperty.call(globalThis, name),
      value: globals[name],
    }]),
  ) as Record<CanvasGlobalName, { existed: boolean; value: unknown }>;
  Object.assign(globalThis, canvasGlobalValues);
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    try {
      if (region.page > pdf.numPages) {
        throw new RangeError(`Requested region page ${region.page} exceeds PDF page count ${pdf.numPages}`);
      }
      const page = await pdf.getPage(region.page);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      const context = canvas.getContext('2d');
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      page.cleanup();
      return canvas.toBuffer('image/png');
    } finally {
      await pdf.destroy();
    }
  } finally {
    for (const name of CANVAS_GLOBAL_NAMES) {
      const previous = previousGlobals[name];
      if (previous.existed) globals[name] = previous.value;
      else Reflect.deleteProperty(globalThis, name);
    }
    releaseQueue();
  }
}

export const nodeRegionCropper: RegionCropper = async (fileData, mimeType, region) => {
  const bytes = base64Bytes(fileData);
  if (mimeType === 'application/pdf') {
    return cropRaster(await renderPdfPage(bytes, region), region);
  }
  if (mimeType.startsWith('image/')) {
    if (region.page !== 1) throw new RangeError(`Image documents only contain page 1, requested page ${region.page}`);
    return cropRaster(bytes, region);
  }
  throw new Error(`Region refinement is not supported for MIME type "${mimeType}"`);
};
