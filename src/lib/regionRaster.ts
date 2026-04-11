import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import type { NormalizedRegion } from './agentTypes';

const PDF_RENDER_SCALE = 2;
const CROPPED_REGION_MIME_TYPE = 'image/png';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function ensureBrowserCanvas(): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Canvas rendering is only available in the browser runtime');
  }

  return document.createElement('canvas');
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a 2D canvas context');
  }

  return context;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getBase64Payload(fileData: string): string {
  return fileData.includes(',') ? fileData.split(',')[1] || '' : fileData;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return bytes;
}

function regionToPixelBox(region: NormalizedRegion, width: number, height: number) {
  const startX = clamp(Math.floor(region.x * width), 0, Math.max(width - 1, 0));
  const startY = clamp(Math.floor(region.y * height), 0, Math.max(height - 1, 0));
  const endX = clamp(Math.ceil((region.x + region.width) * width), startX + 1, width);
  const endY = clamp(Math.ceil((region.y + region.height) * height), startY + 1, height);

  return {
    x: startX,
    y: startY,
    width: Math.max(1, endX - startX),
    height: Math.max(1, endY - startY),
  };
}

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode image for region refinement'));
    image.src = dataUrl;
  });
}

function cropCanvasRegion(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  region: NormalizedRegion,
): { dataUrl: string; width: number; height: number } {
  const cropBox = regionToPixelBox(region, sourceWidth, sourceHeight);
  const targetCanvas = ensureBrowserCanvas();
  targetCanvas.width = cropBox.width;
  targetCanvas.height = cropBox.height;

  const targetContext = getCanvasContext(targetCanvas);
  targetContext.drawImage(
    source,
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height,
    0,
    0,
    cropBox.width,
    cropBox.height,
  );

  return {
    dataUrl: targetCanvas.toDataURL(CROPPED_REGION_MIME_TYPE),
    width: cropBox.width,
    height: cropBox.height,
  };
}

export function isNormalizedRegion(value: unknown): value is NormalizedRegion {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const region = value as Partial<NormalizedRegion>;
  const numericKeys: Array<keyof Pick<NormalizedRegion, 'page' | 'x' | 'y' | 'width' | 'height'>> = [
    'page',
    'x',
    'y',
    'width',
    'height',
  ];

  if (region.units !== 'normalized') {
    return false;
  }

  if (!Number.isInteger(region.page) || (region.page ?? 0) < 1) {
    return false;
  }

  if (numericKeys.some((key) => typeof region[key] !== 'number' || Number.isNaN(region[key]))) {
    return false;
  }

  if ((region.x ?? 0) < 0 || (region.y ?? 0) < 0 || (region.width ?? 0) <= 0 || (region.height ?? 0) <= 0) {
    return false;
  }

  if ((region.x ?? 0) >= 1 || (region.y ?? 0) >= 1) {
    return false;
  }

  if ((region.x ?? 0) + (region.width ?? 0) > 1 || (region.y ?? 0) + (region.height ?? 0) > 1) {
    return false;
  }

  return true;
}

export function assertNormalizedRegion(value: unknown, fieldName = 'region'): NormalizedRegion {
  if (!isNormalizedRegion(value)) {
    throw new TypeError(
      `"${fieldName}" must be a normalized region object with page, x, y, width, height, and units: "normalized".`,
    );
  }

  return value;
}

export async function cropImageRegion(
  fileData: string,
  region: NormalizedRegion,
): Promise<{ dataUrl: string; mimeType: string; width: number; height: number }> {
  const image = await loadImageElement(fileData);
  const cropped = cropCanvasRegion(
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    region,
  );

  return {
    ...cropped,
    mimeType: CROPPED_REGION_MIME_TYPE,
  };
}

export async function renderPdfPageRegion(
  fileData: string,
  region: NormalizedRegion,
): Promise<{ dataUrl: string; mimeType: string; width: number; height: number }> {
  const data = base64ToUint8Array(getBase64Payload(fileData));
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  if (region.page > pdf.numPages) {
    throw new RangeError(`Requested region page ${region.page} exceeds PDF page count ${pdf.numPages}.`);
  }

  const page = await pdf.getPage(region.page);
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const pageCanvas = ensureBrowserCanvas();
  pageCanvas.width = Math.max(1, Math.ceil(viewport.width));
  pageCanvas.height = Math.max(1, Math.ceil(viewport.height));

  const pageContext = getCanvasContext(pageCanvas);
  await page.render({
    canvas: pageCanvas,
    canvasContext: pageContext,
    viewport,
  }).promise;

  const cropped = cropCanvasRegion(pageCanvas, pageCanvas.width, pageCanvas.height, region);

  return {
    ...cropped,
    mimeType: CROPPED_REGION_MIME_TYPE,
  };
}

export async function cropDocumentRegion(
  fileData: string,
  mimeType: string,
  region: NormalizedRegion,
): Promise<{ dataUrl: string; mimeType: string; width: number; height: number }> {
  if (mimeType === 'application/pdf') {
    return renderPdfPageRegion(fileData, region);
  }

  if (mimeType.startsWith('image/')) {
    return cropImageRegion(fileData, region);
  }

  throw new Error(`Region refinement is not supported for MIME type "${mimeType}".`);
}
