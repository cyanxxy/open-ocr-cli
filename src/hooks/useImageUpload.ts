import { useState, useCallback, useRef } from 'react';
import { validateFile, readFileAsDataUrl } from '../lib/fileUtils';
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

  const reset = useCallback(() => {
    setFile(null);
    setImageData('');
    setError(null);
  }, []);

  const processFile = useCallback(async (file: File): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      // Validate file
      const validation = validateFile(file);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid file');
      }

      // Read file
      const data = await readFileAsDataUrl(file);

      // Set states
      setFile(file);
      setImageData(data);

      // Call success callback if provided
      if (optionsRef.current?.onSuccess) {
        optionsRef.current.onSuccess(data, file);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process file';
      logger.error('Error processing file:', errorMessage);
      setError(errorMessage);

      // Call error callback if provided
      if (optionsRef.current?.onError) {
        optionsRef.current.onError(errorMessage);
      }
    } finally {
      setIsLoading(false);
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