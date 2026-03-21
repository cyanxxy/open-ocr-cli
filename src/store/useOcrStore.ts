import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  extractTextFromFile,
  ExtractedContent,
  StreamingCallbacks,
} from '../lib/gemini/index';
import { useSettingsStore } from './useSettingsStore';
import { logger } from '../lib/logger';
import { validateFile } from '../lib/fileUtils';
import {
  BaseOcrStore,
  createBaseOcrSlice,
  createAbortController,
  createRunId,
  handleOcrError
} from './base/BaseOcrStore';
import { createSelectors } from './createSelectors';

/**
 * OCR-specific state extending the base store
 */
interface OcrSpecificState {
  /** Holds the content extracted by the OCR process */
  extractedContent: ExtractedContent | null;
  /** The name of the file currently being processed */
  fileName: string;
  /** The progress of the current extraction, from 0 to 1 */
  progress: number;
}

/**
 * OCR-specific actions
 */
interface OcrSpecificActions {
  /**
   * Processes a given file (image or PDF) for text extraction
   * @param file - The File object to process
   * @param apiKey - The Gemini API key
   * @param handwritingMode - Whether to use handwriting mode
   */
  processFile: (file: File, apiKey: string, handwritingMode: boolean) => Promise<void>;
  /** Cancels the current extraction process */
  cancelExtraction: () => void;
  /** Resets the OCR state to initial values */
  reset: () => void;
  /** Copies the extracted content to clipboard */
  copyExtractedContent: () => Promise<void>;
}

/**
 * Combined OCR store type
 */
type OcrState = BaseOcrStore & OcrSpecificState & OcrSpecificActions;

/**
 * Zustand store for managing the state of the basic OCR feature.
 * Now extends BaseOcrStore to eliminate duplicate code.
 *
 * This store handles:
 * - Storing the extracted text content from a single file
 * - Tracking processing status and errors (from BaseOcrStore)
 * - Copying to clipboard functionality (from BaseOcrStore)
 * - Providing actions to process a file
 */
const useOcrStoreBase = create<OcrState>()(
  devtools((set, get) => ({
  // Base store functionality
  ...createBaseOcrSlice(set, get),
  
  // OCR-specific state
  extractedContent: null,
  fileName: '',
  progress: 0,

  // OCR-specific actions
  processFile: async (file: File, apiKey: string, handwritingMode: boolean) => {
    const validation = validateFile(file);
    if (!validation.valid) {
      set({ error: validation.error || 'Invalid file', isProcessing: false });
      return;
    }

    // Get model and thinkingConfig from settings store
    const { model, thinkingConfig } = useSettingsStore.getState();
    const previousAbortController = get().abortController;
    const abortController = createAbortController();
    const runId = createRunId();
    const isCurrentRun = () => get().activeRunId === runId;

    set({
      isProcessing: true,
      error: null,
      fileName: file.name,
      progress: 0,
      extractedContent: null,
      abortController,
      activeRunId: runId,
    });
    previousAbortController?.abort();

    try {
      // Read file as data URL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      if (!isCurrentRun() || abortController.signal.aborted) {
        return;
      }

      // Streaming callbacks to update progress
      const callbacks: StreamingCallbacks = {
        onProgress: (chunk) => {
          // Check if cancelled before processing each chunk
          if (abortController.signal.aborted || !isCurrentRun()) {
            throw new Error('Extraction cancelled');
          }
          logger.debug('Received chunk:', chunk.length);
          set((state) => {
            if (state.activeRunId !== runId) {
              return {};
            }
            const remaining = 0.9 - state.progress;
            const increment = remaining * 0.15;
            return { progress: Math.min(state.progress + Math.max(increment, 0.005), 0.9) };
          });
        },
        onComplete: (content) => {
          // Check if cancelled before completing
          if (abortController.signal.aborted || !isCurrentRun()) {
            return;
          }
          logger.info('Text extraction completed');
          set({
            extractedContent: content,
            isProcessing: false,
            progress: 1,
            error: null,
            abortController: null,
            activeRunId: null,
          });
        },
        onError: (error) => {
          // Don't show error if it was an abort
          if (abortController.signal.aborted || !isCurrentRun()) {
            return;
          }
          const errorMessage = handleOcrError(error, 'Text extraction failed');
          set({
            error: errorMessage,
            isProcessing: false,
            progress: 0,
            abortController: null,
            activeRunId: null,
          });
        }
      };

      // Log extraction start
      logger.info('Starting text extraction');
      set({ progress: 0.1 });

      // Extract text from file with clientConfig
      const extractionOptions = {
        ...(handwritingMode ? { handwritingStyle: 'general' } : {}),
        abortSignal: abortController.signal
      };

      await extractTextFromFile(
        dataUrl,
        file.type,
        { apiKey, model, thinkingConfig },
        undefined, // instructions
        extractionOptions,
        callbacks
      );

    } catch (error) {
      if (!isCurrentRun()) {
        return;
      }

      // Check if it was cancelled
      if (abortController.signal.aborted || (error instanceof Error && error.message === 'Extraction cancelled')) {
        logger.info('Extraction cancelled by user');
        set({
          error: 'Extraction cancelled',
          isProcessing: false,
          progress: 0,
          abortController: null,
          activeRunId: null,
        });
      } else {
        const errorMessage = handleOcrError(error, 'Failed to process file');
        set({
          error: errorMessage,
          isProcessing: false,
          progress: 0,
          abortController: null,
          activeRunId: null,
        });
      }
    }
  },

  cancelExtraction: () => {
    const { abortController } = get();
    if (abortController) {
      set({
        isProcessing: false,
        error: 'Extraction cancelled',
        progress: 0,
        abortController: null,
        activeRunId: null,
      });
      abortController.abort();
      logger.info('Extraction cancelled');
    }
  },

  reset: () => {
    const { resetBase } = get();
    resetBase(); // Reset base state
    
    // Reset OCR-specific state
    set({
      extractedContent: null,
      fileName: '',
      progress: 0
    });
  },

  // Custom copy method for ExtractedContent
  copyExtractedContent: async () => {
    const { extractedContent } = get();
    if (!extractedContent) return;

    const content = [
      extractedContent.title,
      extractedContent.headings?.join('\n'),
      extractedContent.content,
      extractedContent.tables?.map(t => t.content).join('\n'),
      extractedContent.code?.join('\n'),
      extractedContent.lists?.map(l => l.items.join('\n')).join('\n')
    ].filter(Boolean).join('\n\n');

    // Use base copyToClipboard method
    await get().copyToClipboard(content);
  }
}), { name: 'OcrStore', enabled: import.meta.env.DEV }));

export const useOcrStore = createSelectors(useOcrStoreBase);
