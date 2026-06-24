import { useEffect, useRef } from 'react';
import { logger } from '../lib/logger';

/**
 * Hook for cleaning up store state when components unmount.
 * Ensures consistent cleanup pattern across all pages and prevents memory leaks.
 * 
 * @param cleanupFunctions - Object containing cleanup functions to call on unmount
 * @param storeName - Optional name for debugging purposes
 * 
 * @example
 * ```tsx
 * // Single store cleanup
 * useStoreCleanup({
 *   reset: useOcrStore.getState().reset,
 *   cancelExtraction: useOcrStore.getState().cancelExtraction
 * }, 'OcrStore');
 * 
 * // Multiple stores cleanup
 * useStoreCleanup({
 *   resetOcr: useOcrStore.getState().reset,
 *   resetSettings: useSettingsStore.getState().reset
 * });
 * ```
 */
export function useStoreCleanup(
  cleanupFunctions: Record<string, (() => void) | undefined> = {},
  storeName?: string
): void {
  // Callers pass an inline object whose function references can change between
  // renders (e.g. after a store rebind). Keep the latest set in a ref so the
  // unmount cleanup fires the current functions, not the mount-time snapshot
  // captured by an empty-dep effect (audit U-01).
  const cleanupRef = useRef(cleanupFunctions);
  const storeNameRef = useRef(storeName);
  cleanupRef.current = cleanupFunctions;
  storeNameRef.current = storeName;

  useEffect(() => {
    return () => {
      const latest = cleanupRef.current;
      logger.debug(`Cleaning up ${storeNameRef.current || 'store'} on component unmount`);

      // Call all cleanup functions (check if cleanupFunctions exists)
      if (latest && typeof latest === 'object') {
        Object.entries(latest).forEach(([name, fn]) => {
          if (typeof fn === 'function') {
            try {
              fn();
              logger.debug(`Called cleanup function: ${name}`);
            } catch (error) {
              logger.error(`Error in cleanup function ${name}:`, error);
            }
          }
        });
      }
    };
    // Empty dependency array means this runs once on mount and cleanup on unmount;
    // the latest functions are read from the ref above (audit U-01).
  }, []);
}

/**
 * Specialized cleanup hook for OCR stores that have standard reset and cancelExtraction methods
 */
export function useOcrStoreCleanup<T extends { reset: () => void; cancelExtraction?: () => void }>(
  store: T,
  storeName?: string
): void {
  useStoreCleanup(
    {
      cancelExtraction: store.cancelExtraction,
      reset: store.reset
    },
    storeName
  );
}