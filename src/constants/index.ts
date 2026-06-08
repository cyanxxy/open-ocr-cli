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

// OCR processing options (Gemini 3 only)
export const OCR_OPTIONS = {
  DEFAULT_MODEL: 'gemini-3.5-flash',
  MODELS: [
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Ultra-fast frontier-level intelligence (recommended)' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Fast with advanced reasoning' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Maximum reasoning and performance' }
  ],
  DEFAULT_TEMPERATURE: 1.0, // Gemini 3 requires temperature at 1.0
  DEFAULT_MAX_TOKENS: 65536 // Gemini 3 Flash supports up to 65,536 output tokens
} as const;

// Agent OCR configuration
export const AGENT_CONFIG = {
  MAX_ITERATIONS: 10,
  DEFAULT_MAX_ITERATIONS: 5,
  ITERATION_TIMEOUT: 30000, // 30 seconds
  MEMORY_TTL: 3600000, // 1 hour
  DEFAULT_CONFIDENCE_THRESHOLD: 0.8
} as const;

// UI timing constants
export const UI_TIMING = {
  COPY_NOTIFICATION_DURATION: 2000, // ms
  ERROR_DISPLAY_DURATION: 5000, // ms
  DEBOUNCE_DELAY: 300, // ms
  ANIMATION_DURATION: 200, // ms
  MODAL_ANIMATION_DURATION: 300 // ms
} as const;

// Storage keys
export const STORAGE_KEYS = {
  API_KEY: 'gemini-api-key',
  SETTINGS: 'ocr-settings',
  THEME: 'theme-preference',
  ONBOARDING_COMPLETED: 'onboarding-completed',
  ADVANCED_RULES: 'advanced-ocr-rules',
  AGENT_CONFIG: 'agent-config',
  RECENT_FILES: 'recent-files'
} as const;

// Route paths
export const ROUTES = {
  HOME: '/',
  SIMPLE: '/simple',
  ADVANCED: '/advanced',
  BULK: '/bulk',
  AGENTIC: '/agentic'
} as const;

// Export type helpers
export type OcrModel = typeof OCR_OPTIONS.MODELS[number]['value'];
export type RouteKey = keyof typeof ROUTES;
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
