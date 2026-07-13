import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOcrStore } from './useOcrStore';
import { useSettingsStore } from './useSettingsStore';
import type { ExtractedContent } from '../lib/gemini';
import * as geminiModule from '../lib/gemini';
import * as fileUtilsModule from '../lib/fileUtils';

// Mock the gemini module
vi.mock('../lib/gemini', () => ({
  extractTextFromFile: vi.fn(),
}));

vi.mock('../lib/fileUtils', async () => {
  const actual = await vi.importActual<typeof import('../lib/fileUtils')>('../lib/fileUtils');
  return {
    ...actual,
    validateFileForProcessing: vi.fn(),
  };
});

const mockExtractTextFromFile = vi.mocked(geminiModule.extractTextFromFile);
const mockValidateFileForProcessing = vi.mocked(fileUtilsModule.validateFileForProcessing);

// Create a proper FileReader mock class
class MockFileReader {
  result: string | ArrayBuffer | null = 'data:image/png;base64,mockbase64data';
  error: DOMException | null = null;
  readyState: number = 0;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL() {
    this.readyState = 1;
    setTimeout(() => {
      this.readyState = 2;
      if (this.onload) {
        this.onload({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    }, 0);
  }

  abort() {
    this.readyState = 2;
    if (this.onabort) {
      this.onabort({ target: this } as unknown as ProgressEvent<FileReader>);
    }
  }

  static readonly EMPTY = 0;
  static readonly LOADING = 1;
  static readonly DONE = 2;
}

// Store original FileReader
const originalFileReader = globalThis.FileReader;

describe('useOcrStore', () => {
  const mockExtractedContent: ExtractedContent = {
    title: 'Test Document',
    sections: [
      {
        heading: 'Section 1',
        content: ['Line 1', 'Line 2'],
      },
    ],
  };

  const mockFile = new File(['test content'], 'test.png', {
    type: 'image/png',
  });

  beforeEach(() => {
    mockValidateFileForProcessing.mockResolvedValue({ valid: true });
    // Setup FileReader mock
    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
    Object.defineProperty(window, 'FileReader', {
      value: MockFileReader,
      writable: true,
      configurable: true,
    });

    // Reset store state
    useOcrStore.setState({
      extractedContent: null,
      isProcessing: false,
      fileName: '',
      progress: 0,
      error: null,
      isCopied: false,
      abortController: null,
    });

    useSettingsStore.setState({
      apiKey: '',
      model: 'gemini-3-flash-preview',
      thinkingConfig: { level: 'HIGH', includeThoughts: false },
      handwritingMode: false,
      theme: 'light',
    });

    vi.clearAllMocks();

    // Setup default mock implementation
    mockExtractTextFromFile.mockImplementation(
      async (
        _fileData,
        _mimeType,
        _config,
        _instructions,
        _options,
        callbacks
      ) => {
        if (callbacks?.onComplete) {
          callbacks.onComplete(mockExtractedContent);
        }
        return mockExtractedContent;
      }
    );

    // Reset the existing clipboard mock
    vi.mocked(navigator.clipboard.writeText).mockClear();
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Restore original FileReader
    globalThis.FileReader = originalFileReader;
    Object.defineProperty(window, 'FileReader', {
      value: originalFileReader,
      writable: true,
      configurable: true,
    });
  });

  describe('initial state', () => {
    it('should have correct default values', () => {
      const state = useOcrStore.getState();

      expect(state.extractedContent).toBeNull();
      expect(state.isProcessing).toBe(false);
      expect(state.fileName).toBe('');
      expect(state.progress).toBe(0);
      expect(state.error).toBeNull();
      expect(state.isCopied).toBe(false);
    });
  });

  describe('processFile', () => {
    it('should process file successfully', async () => {
      const apiKey = 'test-api-key';
      const handwritingMode = false;

      await useOcrStore.getState().processFile(mockFile, apiKey, handwritingMode);

      const state = useOcrStore.getState();
      expect(state.extractedContent).toEqual(mockExtractedContent);
      expect(state.fileName).toBe('test.png');
      expect(state.isProcessing).toBe(false);
      expect(state.progress).toBe(1);
      expect(state.error).toBeNull();
    });

    it('should set processing state during file processing', async () => {
      let processingState = false;

      mockExtractTextFromFile.mockImplementation(async () => {
        processingState = useOcrStore.getState().isProcessing;
        return mockExtractedContent;
      });

      await useOcrStore.getState().processFile(mockFile, 'test-key', false);

      expect(processingState).toBe(true);
    });

    it('should handle extraction errors', async () => {
      const errorMessage = 'Extraction failed';
      mockExtractTextFromFile.mockRejectedValue(new Error(errorMessage));

      await useOcrStore.getState().processFile(mockFile, 'test-key', false);

      const state = useOcrStore.getState();
      expect(state.error).toContain('Extraction failed');
      expect(state.isProcessing).toBe(false);
      expect(state.extractedContent).toBeNull();
    });

    it('should handle file reading errors', async () => {
      // Create a mock that fails on read
      class FailingFileReader {
        result = null;
        onload: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        readyState = 0;

        readAsDataURL() {
          this.readyState = 1;
          setTimeout(() => {
            if (this.onerror) {
              this.onerror({ target: this });
            }
          }, 0);
        }
      }

      globalThis.FileReader = FailingFileReader as unknown as typeof FileReader;

      await useOcrStore.getState().processFile(mockFile, 'test-key', false);

      const state = useOcrStore.getState();
      expect(state.error).toContain('Failed to read file');
      expect(state.isProcessing).toBe(false);
    });

    it('should pass handwriting mode and config to extraction function', async () => {
      await useOcrStore.getState().processFile(mockFile, 'test-key', true);

      expect(mockExtractTextFromFile).toHaveBeenCalledWith(
        expect.stringContaining('data:image/png;base64,'),
        'image/png',
        expect.objectContaining({
          apiKey: 'test-key',
          model: 'gemini-3-flash-preview',
        }),
        undefined,
        expect.objectContaining({
          handwritingStyle: 'general',
          abortSignal: expect.any(Object),
        }),
        expect.any(Object) // callbacks
      );
    });

    it('should handle streaming callbacks', async () => {
      let onProgressCalled = false;
      let onCompleteCalled = false;

      mockExtractTextFromFile.mockImplementation(
        async (_fileData, _mimeType, _config, _instructions, _options, callbacks) => {
          if (callbacks) {
            callbacks.onProgress?.('partial text');
            onProgressCalled = true;

            callbacks.onComplete?.(mockExtractedContent);
            onCompleteCalled = true;
          }
          return mockExtractedContent;
        }
      );

      await useOcrStore.getState().processFile(mockFile, 'test-key', false);

      expect(onProgressCalled).toBe(true);
      expect(onCompleteCalled).toBe(true);
    });
  });

  describe('copyToClipboard', () => {
    beforeEach(() => {
      useOcrStore.setState({ extractedContent: mockExtractedContent });
    });

    it('should copy content to clipboard successfully', async () => {
      await useOcrStore.getState().copyToClipboard('test content');

      const state = useOcrStore.getState();
      expect(state.isCopied).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('should reset isCopied state after delay', async () => {
      vi.useFakeTimers();

      await useOcrStore.getState().copyToClipboard('test content');

      expect(useOcrStore.getState().isCopied).toBe(true);

      vi.advanceTimersByTime(2000);

      expect(useOcrStore.getState().isCopied).toBe(false);

      vi.useRealTimers();
    });

    it('should handle clipboard write errors', async () => {
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Clipboard error')
      );

      await useOcrStore.getState().copyToClipboard('test content');

      const state = useOcrStore.getState();
      expect(state.isCopied).toBe(false);
    });

    it('should not copy if no extracted content exists', async () => {
      useOcrStore.setState({ extractedContent: null });

      await useOcrStore.getState().copyExtractedContent();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(useOcrStore.getState().isCopied).toBe(false);
    });

    it('should copy formatted extracted content', async () => {
      const contentWithAllFields: ExtractedContent = {
        title: 'Document Title',
        headings: ['Heading 1', 'Heading 2'],
        content: 'Main content text',
        tables: [{ headers: [], rows: [], content: 'Table data' }],
        code: ['const x = 1;'],
        lists: [{ type: 'unordered', items: ['Item 1', 'Item 2'] }],
        sections: [],
      };
      useOcrStore.setState({ extractedContent: contentWithAllFields });

      await useOcrStore.getState().copyExtractedContent();

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      const clipboardContent = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
      expect(clipboardContent).toContain('Document Title');
      expect(clipboardContent).toContain('Heading 1');
      expect(clipboardContent).toContain('Main content text');
      expect(clipboardContent).toContain('Table data');
      expect(clipboardContent).toContain('const x = 1;');
      expect(clipboardContent).toContain('Item 1');
    });
  });

  describe('cancelExtraction', () => {
    it('should cancel ongoing extraction', async () => {
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');

      useOcrStore.setState({
        isProcessing: true,
        abortController,
      });

      useOcrStore.getState().cancelExtraction();

      expect(abortSpy).toHaveBeenCalled();
      expect(useOcrStore.getState().isProcessing).toBe(false);
      expect(useOcrStore.getState().error).toBe('Extraction cancelled');
      expect(useOcrStore.getState().progress).toBe(0);
      expect(useOcrStore.getState().abortController).toBeNull();
    });

    it('should do nothing if no extraction is in progress', () => {
      useOcrStore.setState({
        isProcessing: false,
        abortController: null,
      });

      // Should not throw
      useOcrStore.getState().cancelExtraction();

      expect(useOcrStore.getState().isProcessing).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset store to initial state', () => {
      // Set some state first
      useOcrStore.setState({
        extractedContent: mockExtractedContent,
        isProcessing: true,
        fileName: 'test.png',
        progress: 0.5,
        error: 'Some error',
        isCopied: true,
      });

      useOcrStore.getState().reset();

      const state = useOcrStore.getState();
      expect(state.extractedContent).toBeNull();
      expect(state.isProcessing).toBe(false);
      expect(state.fileName).toBe('');
      expect(state.progress).toBe(0);
      expect(state.error).toBeNull();
      expect(state.isCopied).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockExtractTextFromFile.mockRejectedValue(new Error('Network error'));

      await useOcrStore.getState().processFile(mockFile, 'test-key', false);

      const state = useOcrStore.getState();
      expect(state.error).toContain('Network error');
      expect(state.isProcessing).toBe(false);
    });

    it('should handle API key errors', async () => {
      mockExtractTextFromFile.mockRejectedValue(new Error('Invalid API key'));

      await useOcrStore.getState().processFile(mockFile, 'invalid-key', false);

      const state = useOcrStore.getState();
      expect(state.error).toContain('Invalid API key');
    });

    it('should handle timeout errors', async () => {
      mockExtractTextFromFile.mockRejectedValue(new Error('Request timeout'));

      await useOcrStore.getState().processFile(mockFile, 'test-key', false);

      const state = useOcrStore.getState();
      expect(state.error).toContain('Request timeout');
    });
  });

  describe('progress tracking', () => {
    it('should update progress during processing', async () => {
      const progressUpdates: number[] = [];

      const unsubscribe = useOcrStore.subscribe((state) => {
        progressUpdates.push(state.progress);
      });

      mockExtractTextFromFile.mockImplementation(
        async (_fileData, _mimeType, _config, _instructions, _options, callbacks) => {
          if (callbacks) {
            callbacks.onProgress?.('chunk 1');
            callbacks.onProgress?.('chunk 2');
            callbacks.onComplete?.(mockExtractedContent);
          }
          return mockExtractedContent;
        }
      );

      await useOcrStore.getState().processFile(mockFile, 'test-key', false);

      unsubscribe();

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(1);
    });
  });

  describe('subscription and reactivity', () => {
    it('should notify subscribers when state changes', () => {
      const subscriber = vi.fn();
      const unsubscribe = useOcrStore.subscribe(subscriber);

      useOcrStore.setState({ isProcessing: true });

      expect(subscriber).toHaveBeenCalled();

      unsubscribe();
    });

    it('should handle multiple subscribers', () => {
      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();

      const unsubscribe1 = useOcrStore.subscribe(subscriber1);
      const unsubscribe2 = useOcrStore.subscribe(subscriber2);

      useOcrStore.setState({ progress: 0.5 });

      expect(subscriber1).toHaveBeenCalled();
      expect(subscriber2).toHaveBeenCalled();

      unsubscribe1();
      unsubscribe2();
    });
  });
});
