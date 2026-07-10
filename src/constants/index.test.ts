import { describe, it, expect } from 'vitest';
import * as constants from './index';
import { STORAGE_KEYS, FILE_CONSTRAINTS, UI_TIMING } from './index';

describe('constants', () => {
  it('keeps the constants still consumed by the app', () => {
    expect(FILE_CONSTRAINTS.MAX_SIZE).toBe(100 * 1024 * 1024);
    expect(FILE_CONSTRAINTS.MAX_IMAGE_SIZE).toBe(100 * 1024 * 1024);
    expect(FILE_CONSTRAINTS.MAX_PDF_SIZE).toBe(50 * 1024 * 1024);
    expect(UI_TIMING.COPY_NOTIFICATION_DURATION).toBe(2000);
  });

  it('drops the dead OCR_OPTIONS / AGENT_CONFIG / ROUTES exports (audit M-06)', () => {
    expect('OCR_OPTIONS' in constants).toBe(false);
    expect('AGENT_CONFIG' in constants).toBe(false);
    expect('ROUTES' in constants).toBe(false);
  });

  it('only retains the API_KEY storage key that the store consumes (audit U-13)', () => {
    expect(STORAGE_KEYS.API_KEY).toBe('gemini-api-key');
    // Stale, unreferenced keys were removed to prevent drift.
    expect(Object.keys(STORAGE_KEYS)).toEqual(['API_KEY']);
  });
});
