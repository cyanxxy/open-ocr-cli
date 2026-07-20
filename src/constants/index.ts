/**
 * Application-wide constants
 */

// File upload constraints (MIME-specific Gemini inline limits).
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
  /**
   * Absolute max across MIME types (images). Prefer MAX_IMAGE_SIZE / MAX_PDF_SIZE
   * for validation; kept for callers that need a single upper bound.
   */
  MAX_SIZE: 70 * 1024 * 1024,
  MAX_SIZE_LABEL: '70MB',
  SUPPORTED_IMAGE_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ],
  SUPPORTED_DOCUMENT_MIME_TYPES: ['application/pdf'],
  ACCEPTED_IMAGE_TYPES: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif'],
  ACCEPTED_DOCUMENT_TYPES: ['.pdf'],
  ACCEPTED_MIME_TYPES: {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/webp': ['.webp'],
    'image/gif': ['.gif'],
    'image/heic': ['.heic'],
    'image/heif': ['.heif'],
    'application/pdf': ['.pdf']
  },
} as const;

/** Max upload size for a given MIME type (PDF vs image). */
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

// UI timing constants
export const UI_TIMING = {
  COPY_NOTIFICATION_DURATION: 2000, // ms
  ERROR_DISPLAY_DURATION: 5000, // ms
  DEBOUNCE_DELAY: 300, // ms
  ANIMATION_DURATION: 200, // ms
  MODAL_ANIMATION_DURATION: 300 // ms
} as const;

// Storage keys. Only API_KEY is consumed today (useSettingsStore persists the
// rest of its state under the Zustand persist name 'gemini-settings' directly).
// Stale, unreferenced keys were removed to prevent drift (audit U-13).
export const STORAGE_KEYS = {
  API_KEY: 'gemini-api-key',
} as const;

// Export type helpers
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
