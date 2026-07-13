import { useState, useCallback, useRef } from 'react';
import { validateFileForProcessing, readFileAsDataUrl } from '../lib/fileUtils';
import { logger } from '../lib/logger';

interface UseImageUploadOptions {
  onSuccess?: (data: string, file: File) => void;
  onError?: (error: string) => void;
}

interface UseImageUploadResult {
  file: File | null;
  imageData: string;
  isLoading: boolean;
  error: string | null;
  handleFileChange: (files: FileList | null) => Promise<void>;
  handleDrop: (acceptedFiles: File[]) => Promise<void>;
  reset: () => void;
}

export function useImageUpload(options?: UseImageUploadOptions): UseImageUploadResult {
  const [file, setFile] = useState<File | null>(null);
  const [imageData, setImageData] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Keep callbacks in a ref so processFile (and the handlers built on it) keep a
  // stable identity even when callers pass a fresh inline `options` object each
  // render — otherwise every render would rebuild handleFileChange/handleDrop.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Monotonic request id. Each processFile call captures the current value;
  // after the async read it bails out unless it is still the latest request.
  // This prevents a slow read of an earlier file from overwriting state set by
  // a newer file (last-write-wins race), and lets reset()/unmount invalidate
  // any in-flight read (audit B-08).
  const requestIdRef = useRef(0);

  const reset = useCallback(() => {
    // Invalidate any pending read so its resolution is ignored (audit B-08).
    requestIdRef.current += 1;
    setFile(null);
    setImageData('');
    setError(null);
    setIsLoading(false);
  }, []);

  const processFile = useCallback(async (file: File): Promise<void> => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;

    setIsLoading(true);
    setError(null);

    try {
      // Validate file
      const validation = await validateFileForProcessing(file);
      if (!isCurrent()) {
        return;
      }
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid file');
      }

      // Read file
      const data = await readFileAsDataUrl(file);

      // A newer request (or a reset) started while this read was in flight —
      // drop the stale result without touching state (audit B-08).
      if (!isCurrent()) {
        return;
      }

      // Set states
      setFile(file);
      setImageData(data);

      // Call success callback if provided
      if (optionsRef.current?.onSuccess) {
        optionsRef.current.onSuccess(data, file);
      }
    } catch (err) {
      // Ignore errors from superseded requests so a stale failure cannot clobber
      // the state of the current file (audit B-08).
      if (!isCurrent()) {
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to process file';
      logger.error('Error processing file:', errorMessage);
      setError(errorMessage);

      // Call error callback if provided
      if (optionsRef.current?.onError) {
        optionsRef.current.onError(errorMessage);
      }
    } finally {
      // Only the latest request controls the loading flag.
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  }, []);

  const handleFileChange = useCallback(async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    await processFile(files[0]);
  }, [processFile]);

  const handleDrop = useCallback(async (acceptedFiles: File[]): Promise<void> => {
    if (acceptedFiles.length === 0) return;
    await processFile(acceptedFiles[0]);
  }, [processFile]);

  return {
    file,
    imageData,
    isLoading,
    error,
    handleFileChange,
    handleDrop,
    reset
  };
}
