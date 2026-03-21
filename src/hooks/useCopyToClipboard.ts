import { useState, useCallback, useEffect } from 'react';
import { logger } from '../lib/logger';
import { UI_TIMING } from '../constants';

interface UseCopyToClipboardResult {
  isCopied: boolean;
  copyToClipboard: (text: string) => Promise<boolean>;
  reset: () => void;
}

export function useCopyToClipboard(resetInterval = UI_TIMING.COPY_NOTIFICATION_DURATION): UseCopyToClipboardResult {
  const [isCopied, setIsCopied] = useState(false);

  const reset = useCallback(() => {
    setIsCopied(false);
  }, []);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (isCopied && resetInterval) {
      timeoutId = setTimeout(() => {
        setIsCopied(false);
      }, resetInterval);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isCopied, resetInterval]);

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (!navigator?.clipboard) {
      logger.warn('Clipboard API not available');
      return false;
    }

    try {
      const normalizedText = text == null ? '' : String(text);
      await navigator.clipboard.writeText(normalizedText);
      setIsCopied(true);
      return true;
    } catch (error) {
      logger.error('Failed to copy text to clipboard', error);
      setIsCopied(false);
      return false;
    }
  }, []);

  return { isCopied, copyToClipboard, reset };
}
