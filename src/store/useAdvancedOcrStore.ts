import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { extractTextFromFile } from '../lib/gemini/extraction';
import type { ExtractedContent } from '../lib/gemini/types';
import { validateFile, validateFileMagicBytes, readFileAsDataUrl, BULK_LIMITS, generateUuid } from '../lib/fileUtils';
import { useSettingsStore } from './useSettingsStore';
import { logger } from '../lib/logger';
import { createSelectors } from './createSelectors';
import { createRunId } from './base/BaseOcrStore';

/**
 * Defines the state and actions for the Advanced OCR feature.
 * This store manages multiple files, their processing status, extracted content,
 * and provides actions for managing the bulk processing workflow.
 */
/**
 * Represents a file with a unique ID for stable tracking
 */
interface TrackedFile {
  id: string;
  file: File;
}

/**
 * Outcome of processing a single bulk file (audit H-09). A discriminated status
 * lets the UI render failed/cancelled items distinctly instead of treating an
 * error stub as a 0-section success.
 */
type ProcessedResultStatus = 'success' | 'failed' | 'cancelled' | 'partial';

/**
 * Represents a processed result linked to a file by ID
 */
interface ProcessedResult {
  fileId: string;
  fileName: string;
  content: ExtractedContent;
  /** Outcome of the extraction for this file. */
  status: ProcessedResultStatus;
  /** Human-readable error message when status is 'failed' or 'cancelled'. */
  error?: string;
}

interface AdvancedOcrState {
  /** An array of tracked files added by the user for bulk processing. */
  files: TrackedFile[];
  /**
   * An array of processed results, each linked to a file by its unique ID.
   */
  processedResults: ProcessedResult[];
  /** A boolean indicating whether the bulk processing operation is currently active. */
  isProcessing: boolean;
  /** Stores any error message that occurred during file validation or processing. Null if no error. */
  error: string | null;
  /** Processing progress from 0 to 1. */
  progress: number;
  /** AbortController for cancelling in-flight API requests. */
  abortController: AbortController | null;
  /**
   * A boolean indicating if the combined results of all processed files have been
   * recently copied to the clipboard. Used for UI feedback.
   */
  isCopied: boolean;
  /**
   * A dictionary mapping file ID to a boolean.
   * True if that specific result has been recently copied to the clipboard. Used for UI feedback.
   */
  copiedResults: { [fileId: string]: boolean };
  /** Timeout ID for the copy feedback, to allow cleanup. */
  copyTimeoutId: ReturnType<typeof setTimeout> | null;
  /** Dictionary of timeout IDs for individual result copy feedback, to allow cleanup. */
  resultCopyTimeoutIds: { [fileId: string]: ReturnType<typeof setTimeout> | undefined };
  /** Identifier for the currently active processing run */
  activeRunId: string | null;

  /**
   * Adds new files to the list for bulk processing.
   * Validates each file for size, type, emptiness, and duplicates, and enforces
   * batch budgets (max file count and combined byte size). Updates `error` state
   * if validation fails for any file. Synchronous — no I/O is performed here.
   * @param newFiles - An array of {@link File} objects to add.
   */
  addFiles: (newFiles: File[]) => void;
  /**
   * Removes a file (and its corresponding processed result, if any) from the list by its file ID.
   * @param fileId - The unique ID of the file to remove.
   */
  removeFile: (fileId: string) => void;
  /**
   * Cancels the current bulk processing operation.
   */
  cancelProcessing: () => void;
  /**
   * Processes all files currently in the `files` array.
   * Updates `processedResults` with the content extracted from each file.
   * Sets `isProcessing` to true during operation and updates `error` state if issues occur.
   */
  processFiles: () => Promise<void>;
  /**
   * Copies the combined content of all successfully processed files to the clipboard.
   * Each file's content is prefixed by its name.
   * Sets `isCopied` to true for a short duration for UI feedback.
   */
  copyToClipboard: () => Promise<void>;
  /**
   * Copies the extracted content of a single processed file (identified by its file ID) to the clipboard.
   * Sets `copiedResults[fileId]` to true for a short duration for UI feedback.
   * @param fileId - The unique ID of the file whose result to copy.
   */
  copyResultToClipboard: (fileId: string) => Promise<void>;
  /** Resets the entire bulk OCR state (files, results, errors, etc.) to initial values. */
  reset: () => void;
}

/**
 * Zustand store for managing the state of the Advanced OCR feature.
 *
 * This store handles:
 * - Managing a list of files to be processed.
 * - Storing the extracted content for each processed file.
 * - Tracking the overall processing status and any errors.
 * - Providing actions to add/remove files, process them, and copy results.
 * - UI feedback states for copy operations.
 */
/**
 * Generates a globally-unique file ID. Uses crypto.randomUUID() so two files
 * dropped in the same millisecond cannot collide (audit B-01).
 */
const generateFileId = (): string => {
  return generateUuid();
};

/**
 * Builds a stable fingerprint used to detect the same file being added twice
 * (audit B-02). name+size+lastModified is sufficient to identify a re-drop of
 * the identical file the user already queued.
 */
const fileFingerprint = (file: File): string => {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
};

const getResultText = (content: ExtractedContent): string => {
  if (content.markdown) return content.markdown;
  const parts: string[] = [];
  if (content.title) parts.push('# ' + content.title);
  for (const section of content.sections) {
    if (section.heading) parts.push('## ' + section.heading);
    const text = Array.isArray(section.content) ? section.content.join('\n') : section.content;
    if (text) parts.push(text);
  }
  if (parts.length === 0 && content.content) return content.content;
  return parts.join('\n\n');
};

const useAdvancedOcrStoreBase = create<AdvancedOcrState>()(
  devtools((set, get) => ({
  files: [],
  processedResults: [],
  isProcessing: false,
  error: null,
  progress: 0,
  abortController: null,
  isCopied: false,
  copiedResults: {},
  copyTimeoutId: null,
  resultCopyTimeoutIds: {},
  activeRunId: null,

  addFiles: (newFiles) => {
    // Synchronous: only validation and set() run here (audit B-03). Magic-byte
    // and other async checks happen at process time.
    const { files } = get();

    const validTrackedFiles: TrackedFile[] = [];
    const errors: string[] = [];

    // Running totals so the budgets account for both already-queued files and
    // the ones added earlier in this same call (audit H-10).
    let runningCount = files.length;
    let runningBytes = files.reduce((sum, tf) => sum + tf.file.size, 0);

    // Track fingerprints of files already queued (and added in this call) so a
    // re-drop of the same file is rejected as a duplicate (audit B-02).
    const seenFingerprints = new Set(files.map((tf) => fileFingerprint(tf.file)));

    for (const file of newFiles) {
      const validation = validateFile(file);
      if (!validation.valid) {
        errors.push(validation.error || 'Invalid file');
        continue;
      }

      const fingerprint = fileFingerprint(file);
      if (seenFingerprints.has(fingerprint)) {
        errors.push(`File "${file.name}" was already added.`);
        continue;
      }

      // Enforce the batch file-count ceiling (audit H-10).
      if (runningCount >= BULK_LIMITS.MAX_FILES) {
        errors.push(`Maximum of ${BULK_LIMITS.MAX_FILES} files per batch exceeded; "${file.name}" was skipped.`);
        continue;
      }

      // Enforce the combined byte ceiling so the queue cannot hold an
      // unbounded amount of data for the sequential read loop (audit H-10).
      if (runningBytes + file.size > BULK_LIMITS.MAX_TOTAL_BYTES) {
        errors.push(`Total batch size limit of ${BULK_LIMITS.MAX_TOTAL_BYTES_LABEL} exceeded; "${file.name}" was skipped.`);
        continue;
      }

      seenFingerprints.add(fingerprint);
      runningCount += 1;
      runningBytes += file.size;
      validTrackedFiles.push({
        id: generateFileId(),
        file
      });
    }

    set((state) => ({
      files: [...state.files, ...validTrackedFiles],
      error: errors.length > 0 ? errors.join('\n') : null
    }));
  },

  removeFile: (fileId: string) => {
    set((state) => ({
      files: state.files.filter((f) => f.id !== fileId),
      processedResults: state.processedResults.filter((r) => r.fileId !== fileId),
      error: null
    }));
  },

  cancelProcessing: () => {
    logger.info('Bulk processing cancelled by user');
    const { abortController } = get();
    set({ isProcessing: false, abortController: null, activeRunId: null });
    if (abortController) abortController.abort();
  },

  processFiles: async () => {
    const { files } = get();

    // Get API config from settings store
    const { apiKey, model, thinkingConfig } = useSettingsStore.getState();

    if (!apiKey) {
      set({ error: 'Please configure your Gemini API key in settings', isProcessing: false });
      return;
    }

    const previousAbortController = get().abortController;
    const abortController = new AbortController();
    const runId = createRunId();
    const isCurrentRun = () => get().activeRunId === runId;

    set({
      isProcessing: true,
      error: null,
      processedResults: [],
      progress: 0,
      abortController,
      activeRunId: runId,
    });
    previousAbortController?.abort();

    // NOTE (audit B-05): `fileData` (a base64 data URL ~33% larger than the raw
    // bytes) is read inside the loop and is local to each iteration — it is NOT
    // accumulated, so peak memory is one file's data URL at a time, not the sum
    // of the whole batch. The combined-byte budget enforced in addFiles bounds
    // the worst case further (audit H-10).
    const resultsAccumulator: ProcessedResult[] = [];
    let failedCount = 0;

    for (const trackedFile of files) {
      if (!isCurrentRun() || !get().isProcessing || abortController.signal.aborted) {
        logger.info('Processing stopped - cancelled by user');
        return;
      }

      try {
        // Verify the bytes match the declared type before spending an API call
        // (audit B-04). A spoofed file is recorded as a failed result.
        const magicCheck = await validateFileMagicBytes(trackedFile.file);
        if (!isCurrentRun() || abortController.signal.aborted) {
          return;
        }
        if (!magicCheck.valid) {
          throw new Error(magicCheck.error || 'File failed content validation');
        }

        const fileData = await readFileAsDataUrl(trackedFile.file);
        if (!isCurrentRun() || abortController.signal.aborted) {
          return;
        }

        const content = await extractTextFromFile(
          fileData,
          trackedFile.file.type,
          { apiKey, model, thinkingConfig },
          undefined,
          { abortSignal: abortController.signal }
        );
        resultsAccumulator.push({
          fileId: trackedFile.id,
          fileName: trackedFile.file.name,
          content,
          status: 'success',
        });
      } catch (error: unknown) {
        // extractTextFromFile now rejects on error/cancellation (contract
        // change), so the per-file failure is captured here as a discriminated
        // result instead of a 0-section "success" stub (audit H-09).
        const aborted =
          abortController.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError');
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (aborted) {
          // Cancellation is not a processing failure — record it distinctly and
          // stop the run if this is still the active one.
          logger.info(`Processing cancelled for file ${trackedFile.file.name}`);
          resultsAccumulator.push({
            fileId: trackedFile.id,
            fileName: trackedFile.file.name,
            content: { sections: [] },
            status: 'cancelled',
            error: 'Cancelled',
          });
          if (!isCurrentRun() || abortController.signal.aborted) {
            return;
          }
        } else {
          logger.error(`Error processing file ${trackedFile.file.name}:`, error);
          failedCount += 1;
          resultsAccumulator.push({
            fileId: trackedFile.id,
            fileName: trackedFile.file.name,
            content: { sections: [] },
            status: 'failed',
            error: errorMessage,
          });
        }
      }

      if (!isCurrentRun()) {
        return;
      }

      set({
        processedResults: [...resultsAccumulator],
        progress: resultsAccumulator.length / files.length,
      });
    }

    if (!isCurrentRun()) {
      return;
    }

    set({
      isProcessing: false,
      abortController: null,
      activeRunId: null,
      error: failedCount > 0 ? `${failedCount} of ${files.length} files failed to process` : null,
    });
  },

  copyToClipboard: async () => {
    const { processedResults, copyTimeoutId } = get();

    // Clear any existing timeout
    if (copyTimeoutId) {
      clearTimeout(copyTimeoutId);
    }

    // Only include successfully-extracted files in the combined copy; failed and
    // cancelled items carry no usable content (audit H-09).
    const text = processedResults
      .filter(r => r.status === 'success')
      .map(r => `${r.fileName}:\n${getResultText(r.content)}`)
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
      set({ isCopied: true });
      const timeoutId = setTimeout(() => {
        set((state) => ({
          isCopied: false,
          copyTimeoutId: state.copyTimeoutId === timeoutId ? null : state.copyTimeoutId
        }));
      }, 2000);
      set({ copyTimeoutId: timeoutId });
    } catch {
      set({ error: 'Failed to copy to clipboard' });
    }
  },

  copyResultToClipboard: async (fileId: string) => {
    const { processedResults, resultCopyTimeoutIds } = get();
    const result = processedResults.find(r => r.fileId === fileId);

    if (!result) return;

    // Clear any existing timeout for this fileId
    if (resultCopyTimeoutIds[fileId]) {
      clearTimeout(resultCopyTimeoutIds[fileId]);
    }

    try {
      const contentText = getResultText(result.content);
      await navigator.clipboard.writeText(contentText);

      set((state) => ({
        copiedResults: { ...state.copiedResults, [fileId]: true }
      }));

      const timeoutId = setTimeout(() => {
        set((state) => ({
          copiedResults: { ...state.copiedResults, [fileId]: false },
          resultCopyTimeoutIds: {
            ...state.resultCopyTimeoutIds,
            [fileId]: undefined
          }
        }));
      }, 2000);

      set((state) => ({
        resultCopyTimeoutIds: {
          ...state.resultCopyTimeoutIds,
          [fileId]: timeoutId
        }
      }));
    } catch {
      set({ error: 'Failed to copy result' });
    }
  },

  reset: () => {
    const { copyTimeoutId, resultCopyTimeoutIds, abortController } = get();

    // Abort any in-flight requests
    if (abortController) abortController.abort();

    // Clean up all timeouts
    if (copyTimeoutId) {
      clearTimeout(copyTimeoutId);
    }

    Object.values(resultCopyTimeoutIds).forEach(timeoutId => {
      if (timeoutId) clearTimeout(timeoutId);
    });

    set({
      files: [],
      processedResults: [],
      isProcessing: false,
      error: null,
      progress: 0,
      abortController: null,
      activeRunId: null,
      isCopied: false,
      copiedResults: {},
      copyTimeoutId: null,
      resultCopyTimeoutIds: {},
    });
  }
}), { name: 'AdvancedOcrStore', enabled: import.meta.env.DEV }));

export const useAdvancedOcrStore = createSelectors(useAdvancedOcrStoreBase);
