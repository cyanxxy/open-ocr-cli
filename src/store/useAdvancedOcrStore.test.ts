import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/fileUtils', () => ({
  readFileAsDataUrl: vi.fn(),
  validateFile: vi.fn(),
}));

vi.mock('../lib/gemini/extraction', () => ({
  extractTextFromFile: vi.fn(),
}));

import * as extractionModule from '../lib/gemini/extraction';
import * as fileUtilsModule from '../lib/fileUtils';
import type { ExtractedContent } from '../lib/gemini/types';
import { useAdvancedOcrStore } from './useAdvancedOcrStore';
import { useSettingsStore } from './useSettingsStore';

const mockExtractTextFromFile = vi.mocked(extractionModule.extractTextFromFile);
const mockReadFileAsDataUrl = vi.mocked(fileUtilsModule.readFileAsDataUrl);

describe('useAdvancedOcrStore', () => {
  beforeEach(() => {
    useAdvancedOcrStore.setState({
      files: [],
      processedResults: [],
      isProcessing: false,
      error: null,
      progress: 0,
      isCopied: false,
      copiedResults: {},
      copyTimeoutId: null,
      resultCopyTimeoutIds: {},
      abortController: null,
      activeRunId: null,
    });

    useSettingsStore.setState({
      apiKey: 'test-api-key',
      model: 'gemini-3-flash-preview',
      thinkingConfig: { level: 'HIGH', includeThoughts: false },
      handwritingMode: false,
      theme: 'light',
      hasHydrated: true,
    });

    vi.clearAllMocks();
    mockReadFileAsDataUrl.mockResolvedValue('data:image/png;base64,mock');
  });

  it('keeps the latest bulk-processing run when an older run finishes later', async () => {
    const firstContent: ExtractedContent = {
      title: 'First result',
      sections: [],
    };
    const secondContent: ExtractedContent = {
      title: 'Second result',
      sections: [],
    };

    let resolveFirstRun: (() => void) | undefined;
    let invocationCount = 0;

    mockExtractTextFromFile.mockImplementation(async () => {
      invocationCount += 1;

      if (invocationCount === 1) {
        return await new Promise<ExtractedContent>((resolve) => {
          resolveFirstRun = () => resolve(firstContent);
        });
      }

      return secondContent;
    });

    const firstFile = new File(['first'], 'first.png', { type: 'image/png' });
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' });

    useAdvancedOcrStore.setState({
      files: [{ id: 'file-1', file: firstFile }],
    });
    const firstRun = useAdvancedOcrStore.getState().processFiles();
    await vi.waitFor(() => {
      expect(mockExtractTextFromFile).toHaveBeenCalledTimes(1);
    });

    useAdvancedOcrStore.setState({
      files: [{ id: 'file-2', file: secondFile }],
    });
    await useAdvancedOcrStore.getState().processFiles();

    resolveFirstRun?.();
    await firstRun;

    const state = useAdvancedOcrStore.getState();
    expect(state.processedResults).toHaveLength(1);
    expect(state.processedResults[0]).toMatchObject({
      fileId: 'file-2',
      fileName: 'second.png',
      content: secondContent,
    });
    expect(state.error).toBeNull();
    expect(state.isProcessing).toBe(false);
    expect(state.activeRunId).toBeNull();
  });
});
