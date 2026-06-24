import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/fileUtils', () => ({
  readFileAsDataUrl: vi.fn(),
  validateFile: vi.fn(),
  validateFileMagicBytes: vi.fn(),
  generateUuid: vi.fn(),
  BULK_LIMITS: {
    MAX_FILES: 200,
    MAX_TOTAL_BYTES: 500 * 1024 * 1024,
    MAX_TOTAL_BYTES_LABEL: '500MB',
  },
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
const mockValidateFile = vi.mocked(fileUtilsModule.validateFile);
const mockValidateFileMagicBytes = vi.mocked(fileUtilsModule.validateFileMagicBytes);
const mockGenerateUuid = vi.mocked(fileUtilsModule.generateUuid);

const makeFile = (name: string, size = 100): File => {
  const file = new File(['content'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

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
    mockValidateFile.mockReturnValue({ valid: true });
    mockValidateFileMagicBytes.mockResolvedValue({ valid: true });

    // Deterministic, unique ids per call.
    let counter = 0;
    mockGenerateUuid.mockImplementation(() => `uuid-${++counter}`);
  });

  describe('addFiles', () => {
    it('is synchronous and returns undefined (audit B-03)', () => {
      const result = useAdvancedOcrStore.getState().addFiles([makeFile('a.png')]);
      expect(result).toBeUndefined();
      expect(useAdvancedOcrStore.getState().files).toHaveLength(1);
    });

    it('assigns unique crypto ids to each file (audit B-01)', () => {
      useAdvancedOcrStore.getState().addFiles([makeFile('a.png'), makeFile('b.png')]);
      const ids = useAdvancedOcrStore.getState().files.map((f) => f.id);
      expect(new Set(ids).size).toBe(2);
      expect(mockGenerateUuid).toHaveBeenCalled();
    });

    it('rejects duplicate files by name+size+lastModified (audit B-02)', () => {
      const file = makeFile('dup.png');
      useAdvancedOcrStore.getState().addFiles([file]);
      useAdvancedOcrStore.getState().addFiles([file]);

      const state = useAdvancedOcrStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.error).toContain('already added');
    });

    it('rejects duplicates within the same call', () => {
      const file = makeFile('dup.png');
      useAdvancedOcrStore.getState().addFiles([file, file]);

      const state = useAdvancedOcrStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.error).toContain('already added');
    });

    it('enforces the max-files batch budget (audit H-10)', () => {
      const files = Array.from({ length: 201 }, (_, i) => makeFile(`f${i}.png`, 10));
      useAdvancedOcrStore.getState().addFiles(files);

      const state = useAdvancedOcrStore.getState();
      expect(state.files).toHaveLength(200);
      expect(state.error).toContain('Maximum of 200 files');
    });

    it('enforces the total-byte batch budget (audit H-10)', () => {
      // Two files of 300MB each exceed the 500MB ceiling.
      const big = 300 * 1024 * 1024;
      useAdvancedOcrStore.getState().addFiles([makeFile('big1.png', big), makeFile('big2.png', big)]);

      const state = useAdvancedOcrStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.error).toContain('Total batch size limit');
    });

    it('records validation errors and skips invalid files', () => {
      mockValidateFile.mockImplementation((file) =>
        file && (file as File).name === 'bad.png'
          ? { valid: false, error: 'File "bad.png" is empty.' }
          : { valid: true }
      );

      useAdvancedOcrStore.getState().addFiles([makeFile('good.png'), makeFile('bad.png')]);

      const state = useAdvancedOcrStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0].file.name).toBe('good.png');
      expect(state.error).toContain('empty');
    });
  });

  describe('processFiles status discrimination (audit H-09)', () => {
    it('stores a failed result with the error when extraction rejects', async () => {
      mockExtractTextFromFile.mockRejectedValue(new Error('boom'));

      useAdvancedOcrStore.setState({
        files: [{ id: 'file-1', file: makeFile('x.png') }],
      });

      await useAdvancedOcrStore.getState().processFiles();

      const state = useAdvancedOcrStore.getState();
      expect(state.processedResults).toHaveLength(1);
      expect(state.processedResults[0].status).toBe('failed');
      expect(state.processedResults[0].error).toBe('boom');
      expect(state.processedResults[0].content.sections).toHaveLength(0);
      expect(state.error).toContain('1 of 1 files failed');
    });

    it('marks a result failed when magic-byte validation fails (audit B-04)', async () => {
      mockValidateFileMagicBytes.mockResolvedValue({
        valid: false,
        error: 'File "x.png" does not match its declared type (image/png).',
      });

      useAdvancedOcrStore.setState({
        files: [{ id: 'file-1', file: makeFile('x.png') }],
      });

      await useAdvancedOcrStore.getState().processFiles();

      const state = useAdvancedOcrStore.getState();
      expect(state.processedResults[0].status).toBe('failed');
      expect(state.processedResults[0].error).toContain('does not match');
      expect(mockExtractTextFromFile).not.toHaveBeenCalled();
    });

    it('stores a success result with extracted content', async () => {
      const content: ExtractedContent = { title: 'ok', sections: [] };
      mockExtractTextFromFile.mockResolvedValue(content);

      useAdvancedOcrStore.setState({
        files: [{ id: 'file-1', file: makeFile('x.png') }],
      });

      await useAdvancedOcrStore.getState().processFiles();

      const state = useAdvancedOcrStore.getState();
      expect(state.processedResults[0].status).toBe('success');
      expect(state.processedResults[0].content).toEqual(content);
      expect(state.error).toBeNull();
    });
  });

  describe('copyToClipboard', () => {
    it('omits failed results from the combined copy (audit H-09)', async () => {
      useAdvancedOcrStore.setState({
        processedResults: [
          {
            fileId: 'a',
            fileName: 'a.png',
            content: { title: 'A', sections: [{ heading: 'H', content: ['line'] }] },
            status: 'success',
          },
          {
            fileId: 'b',
            fileName: 'b.png',
            content: { sections: [] },
            status: 'failed',
            error: 'boom',
          },
        ],
      });

      await useAdvancedOcrStore.getState().copyToClipboard();

      const writeText = vi.mocked(navigator.clipboard.writeText);
      expect(writeText).toHaveBeenCalledTimes(1);
      const copied = writeText.mock.calls[0][0];
      expect(copied).toContain('a.png');
      expect(copied).not.toContain('b.png');
    });
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
      status: 'success',
    });
    expect(state.error).toBeNull();
    expect(state.isProcessing).toBe(false);
    expect(state.activeRunId).toBeNull();
  });
});
