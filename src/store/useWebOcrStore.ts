import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  BaseOcrStore,
  createAbortController,
  createBaseOcrSlice,
  createRunId,
  handleOcrError,
  formatContentForClipboard
} from './base/BaseOcrStore';
// audit W-01/W-02: import the engine directly from operations.ts (the no-op
// urlOperations.ts wrapper was removed) and re-export the shared UrlResult type
// from the domain layer so the store no longer owns a lib-level type.
import { dedupeRequestedUrls, extractTextFromUrls, type UrlResult } from '../lib/gemini/operations';
import { useSettingsStore } from './useSettingsStore';
import { logger } from '../lib/logger';
import { getUnsupportedUrls } from '../lib/urlValidation';
import { createSelectors } from './createSelectors';

export type { UrlResult };

interface WebOcrState extends BaseOcrStore {
  urls: string[];
  results: UrlResult[];
  combinedContent: string;
  analysisMode: 'individual' | 'combined' | 'comparison';
}

interface WebOcrActions {
  setUrls: (urls: string[]) => void;
  processUrls: (apiKey: string) => Promise<void>;
  cancelProcessing: () => void;
  setAnalysisMode: (mode: WebOcrState['analysisMode']) => void;
  clearResults: () => void;
  copyUrlResults: () => Promise<void>;
  reset: () => void;
}

type WebOcrStore = WebOcrState & WebOcrActions;

const initialState: Omit<WebOcrState, keyof BaseOcrStore> = {
  urls: [''],
  results: [],
  combinedContent: '',
  analysisMode: 'individual'
};

const useWebOcrStoreBase = create<WebOcrStore>()(
  devtools(
  persist(
    (set, get) => ({
      ...createBaseOcrSlice(set, get),
      ...initialState,
      
      setUrls: (urls: string[]) => {
        // audit H-07: changing the input invalidates any prior output. Clear
        // stale results/combinedContent/error so the UI never shows extraction
        // belonging to a different URL set.
        set({ urls, results: [], combinedContent: '', error: null });
      },

      processUrls: async (apiKey: string) => {
        const { urls, analysisMode } = get();

        // Get model and thinkingConfig from settings store
        const { model, thinkingConfig } = useSettingsStore.getState();

        // Filter out empty URLs
        const trimmedUrls = urls.map(url => url.trim()).filter(Boolean);

        if (trimmedUrls.length === 0) {
          set({ error: 'Please enter at least one valid URL' });
          return;
        }

        const invalidUrls = getUnsupportedUrls(trimmedUrls);

        if (invalidUrls.length > 0) {
          // audit H-08: do not echo the rejected URLs verbatim back into the
          // error UI (avoids reflecting user-supplied content and possibly
          // sensitive paths/credentials). Report a count instead.
          set({
            error: `Only publicly-accessible http:// and https:// URLs are supported (${invalidUrls.length} URL${invalidUrls.length !== 1 ? 's' : ''} rejected).`
          });
          return;
        }

        // audit W-06: collapse duplicate URLs before sending. Without this, two
        // identical inputs collide in the per-URL match Map and trigger a
        // spurious "unexpected URL" failure (and waste API budget).
        const { urls: validUrls, duplicateCount } = dedupeRequestedUrls(trimmedUrls);
        if (duplicateCount > 0) {
          logger.warn(`Removed ${duplicateCount} duplicate URL${duplicateCount !== 1 ? 's' : ''} before processing`);
        }

        // audit H-08: Gemini URL Context allows at most 20 URLs per request.
        if (validUrls.length > 20) {
          set({ error: 'Maximum 20 URLs allowed per request' });
          return;
        }

        const previousAbortController = get().abortController;
        const controller = createAbortController();
        const runId = createRunId();
        const isCurrentRun = () => get().activeRunId === runId;
        set({
          isProcessing: true,
          error: null,
          results: [],
          combinedContent: '',
          abortController: controller,
          activeRunId: runId,
        });
        previousAbortController?.abort();

        try {
          logger.info(`Processing ${validUrls.length} URLs in ${analysisMode} mode`);

          // Grounded URL extraction. Fails closed (throws) when URL-context
          // retrieval cannot be verified — the caller surfaces the error below.
          const response = await extractTextFromUrls(
            validUrls,
            apiKey,
            analysisMode,
            model,
            thinkingConfig,
            controller.signal
          );

          if (controller.signal.aborted || !isCurrentRun()) {
            throw new Error('Operation cancelled');
          }

          // Parse results based on analysis mode
          let results: UrlResult[] = [];
          let combinedContent = '';

          if (analysisMode === 'individual') {
            results = response.results || [];
            if (results.length === 0) {
              throw new Error('Grounded URL extraction did not return any per-URL results.');
            }

            combinedContent = results
              .filter(r => !r.error)
              .map(r => `## ${r.url}\n\n${r.content}`)
              .join('\n\n---\n\n');
          } else if (analysisMode === 'combined') {
            combinedContent = response.combinedContent?.trim() || '';
            if (!combinedContent) {
              throw new Error('Grounded URL extraction did not return combined content.');
            }
          } else if (analysisMode === 'comparison') {
            combinedContent = response.comparisonAnalysis?.trim() || '';
            if (!combinedContent) {
              throw new Error('Grounded URL extraction did not return comparison analysis.');
            }
          }

          set({
            results,
            combinedContent,
            isProcessing: false,
            abortController: null,
            activeRunId: null,
          });

          logger.info('URL processing completed successfully');
        } catch (error) {
          if (!isCurrentRun()) {
            return;
          }

          const errorMessage = handleOcrError(error, 'URL processing failed');
          set({
            error: errorMessage,
            isProcessing: false,
            abortController: null,
            activeRunId: null,
          });
        }
      },

      // audit W-07: dedicated cancel action that aborts the in-flight request
      // and clears the processing flags WITHOUT resetting the URL list (the
      // generic reset() is too heavy). The processUrls run guard (isCurrentRun)
      // and signal.aborted check honour the abort.
      cancelProcessing: () => {
        const { abortController, isProcessing } = get();
        if (!isProcessing) {
          return;
        }
        abortController?.abort();
        set({
          isProcessing: false,
          abortController: null,
          activeRunId: null,
        });
      },

      setAnalysisMode: (mode: WebOcrState['analysisMode']) => {
        // audit H-07: switching analysis mode invalidates the prior output
        // (individual vs combined vs comparison produce incompatible shapes).
        set({ analysisMode: mode, results: [], combinedContent: '', error: null });
      },
      
      clearResults: () => {
        set({
          results: [],
          combinedContent: '',
          error: null
        });
      },
      
      copyUrlResults: async () => {
        const { results, combinedContent, analysisMode, copyToClipboard } = get();
        
        let contentToCopy = '';
        
        if (analysisMode === 'individual' && results.length > 0) {
          contentToCopy = formatContentForClipboard(
            results.map(r => ({
              title: r.url,
              content: r.error || r.content
            }))
          );
        } else if (combinedContent) {
          contentToCopy = combinedContent;
        }
        
        if (contentToCopy) {
          await copyToClipboard(contentToCopy);
        }
      },
      
      reset: () => {
        const { resetBase } = get();
        resetBase();
        set(initialState);
      }
    }),
    {
      name: 'web-ocr-storage',
      partialize: (state) => ({
        urls: state.urls,
        analysisMode: state.analysisMode
      })
    }
  ),
  { name: 'WebOcrStore', enabled: import.meta.env.DEV })
);

export const useWebOcrStore = createSelectors(useWebOcrStoreBase);
