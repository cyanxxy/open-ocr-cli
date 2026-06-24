/**
 * Application-wide constants
 */

// File upload constraints
export const FILE_CONSTRAINTS = {
  MAX_SIZE: 20 * 1024 * 1024, // 20MB
  MAX_SIZE_LABEL: '20MB',
  SUPPORTED_IMAGE_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'image/heif',
  ],
  SUPPORTED_DOCUMENT_MIME_TYPES: ['application/pdf'],
  ACCEPTED_IMAGE_TYPES: ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'],
  ACCEPTED_DOCUMENT_TYPES: ['.pdf'],
  ACCEPTED_MIME_TYPES: {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/webp': ['.webp'],
    'image/heic': ['.heic'],
    'image/heif': ['.heif'],
    'application/pdf': ['.pdf']
  },
} as const;

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
