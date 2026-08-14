/**
 * Engine-wide constants
 */

// File input constraints (MIME-specific Gemini inline limits).
// Images: 70MB raw, leaving room for base64 expansion plus prompt/JSON overhead
// under the current 100MB inline payload ceiling. PDFs: 50MB / 1,000 pages.
export const FILE_CONSTRAINTS = {
  /** Absolute max for any single non-PDF file (images). */
  MAX_IMAGE_SIZE: 70 * 1024 * 1024,
  MAX_IMAGE_SIZE_LABEL: '70MB',
  /** PDF document limit per Gemini document-processing guidance. */
  MAX_PDF_SIZE: 50 * 1024 * 1024,
  MAX_PDF_SIZE_LABEL: '50MB',
  MAX_PDF_PAGES: 1000,
  SUPPORTED_IMAGE_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ],
  SUPPORTED_DOCUMENT_MIME_TYPES: ['application/pdf'],
} as const;

/** Max input size for a given MIME type (PDF vs image). */
export function maxFileSizeForMime(mimeType: string): { bytes: number; label: string } {
  if (mimeType === 'application/pdf') {
    return {
      bytes: FILE_CONSTRAINTS.MAX_PDF_SIZE,
      label: FILE_CONSTRAINTS.MAX_PDF_SIZE_LABEL,
    };
  }
  return {
    bytes: FILE_CONSTRAINTS.MAX_IMAGE_SIZE,
    label: FILE_CONSTRAINTS.MAX_IMAGE_SIZE_LABEL,
  };
}
