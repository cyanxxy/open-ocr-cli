import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/fileUtils', () => ({
  readFileAsDataUrl: vi.fn(),
  validateFileForProcessing: vi.fn(),
}));

vi.mock('../lib/templates', () => ({
  getExtractionPreset: vi.fn(),
  runExtractionPreset: vi.fn(),
}));

import * as fileUtilsModule from '../lib/fileUtils';
import * as templatesModule from '../lib/templates';
import type { PresetRunResult } from '../lib/gemini/types';
import { initialBaseState } from './base/BaseOcrStore';
import { useSettingsStore } from './useSettingsStore';
import { useTemplateOcrStore } from './useTemplateOcrStore';

const mockReadFileAsDataUrl = vi.mocked(fileUtilsModule.readFileAsDataUrl);
const mockValidateFile = vi.mocked(fileUtilsModule.validateFileForProcessing);
const mockGetExtractionPreset = vi.mocked(templatesModule.getExtractionPreset);
const mockRunExtractionPreset = vi.mocked(templatesModule.runExtractionPreset);

const mockPreset = {
  id: 'invoice',
  label: 'Invoice',
  description: 'Capture billing fields and line items from invoices and vendor statements.',
  outputShape: 'table' as const,
  tableColumns: ['description', 'quantity', 'unit_price', 'line_total'],
  rules: [],
};

const mockResult: PresetRunResult = {
  presetId: 'invoice',
  markdown: '# Invoice Extraction',
  json: {
    presetId: 'invoice',
    documentType: 'Invoice',
    summary: 'Structured extraction for invoice.',
    fields: {},
    rows: [
      {
        description: 'Monthly retainer',
        quantity: '1',
        unit_price: '1200.00',
        line_total: '1200.00',
      },
    ],
  },
  csv: 'description,quantity,unit_price,line_total\nMonthly retainer,1,1200.00,1200.00',
};

describe('useTemplateOcrStore process flow', () => {
  const mockFile = new File(['pdf bytes'], 'invoice.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    useTemplateOcrStore.setState({
      ...initialBaseState,
      presetId: 'invoice',
      result: null,
      fileName: '',
      progress: 0,
    });

    useSettingsStore.setState({
      apiKey: '',
      model: 'gemini-3-flash-preview',
      thinkingConfig: { level: 'HIGH', includeThoughts: false },
      handwritingMode: false,
      theme: 'light',
    });

    mockValidateFile.mockResolvedValue({ valid: true });
    mockReadFileAsDataUrl.mockResolvedValue('data:application/pdf;base64,ZmFrZQ==');
    mockGetExtractionPreset.mockReturnValue(mockPreset);
    mockRunExtractionPreset.mockImplementation(async (_dataUrl, _mimeType, _config, _preset, _options, callbacks) => {
      callbacks?.onProgress?.('partial');
      callbacks?.onComplete?.(mockResult);
      return mockResult;
    });

    vi.clearAllMocks();
    mockValidateFile.mockResolvedValue({ valid: true });
    mockReadFileAsDataUrl.mockResolvedValue('data:application/pdf;base64,ZmFrZQ==');
    mockGetExtractionPreset.mockReturnValue(mockPreset);
    mockRunExtractionPreset.mockImplementation(async (_dataUrl, _mimeType, _config, _preset, _options, callbacks) => {
      callbacks?.onProgress?.('partial');
      callbacks?.onComplete?.(mockResult);
      return mockResult;
    });
  });

  it('processes a file and stores the preset artifacts', async () => {
    await useTemplateOcrStore.getState().processFile(mockFile, 'test-api-key');

    expect(mockValidateFile).toHaveBeenCalledWith(mockFile);
    expect(mockReadFileAsDataUrl).toHaveBeenCalledWith(mockFile);
    expect(mockGetExtractionPreset).toHaveBeenCalledWith('invoice');
    expect(mockRunExtractionPreset).toHaveBeenCalledWith(
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      expect.objectContaining({
        apiKey: 'test-api-key',
        model: 'gemini-3-flash-preview',
        thinkingConfig: { level: 'HIGH', includeThoughts: false },
      }),
      mockPreset,
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
      expect.objectContaining({
        onProgress: expect.any(Function),
        onComplete: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    const state = useTemplateOcrStore.getState();
    expect(state.result).toEqual(mockResult);
    expect(state.fileName).toBe('invoice.pdf');
    expect(state.progress).toBe(1);
    expect(state.error).toBeNull();
    expect(state.isProcessing).toBe(false);
    expect(state.abortController).toBeNull();
  });

  it('surfaces validation failures without calling the extraction engine', async () => {
    mockValidateFile.mockResolvedValue({ valid: false, error: 'File is too large' });

    await useTemplateOcrStore.getState().processFile(mockFile, 'test-api-key');

    const state = useTemplateOcrStore.getState();
    expect(state.error).toBe('File is too large');
    expect(state.isProcessing).toBe(false);
    expect(mockReadFileAsDataUrl).not.toHaveBeenCalled();
    expect(mockRunExtractionPreset).not.toHaveBeenCalled();
  });

  it('shows an artifact-specific error when CSV is unavailable', async () => {
    useTemplateOcrStore.setState({
      result: {
        ...mockResult,
        csv: undefined,
      },
    });

    await useTemplateOcrStore.getState().copyArtifact('csv');

    expect(useTemplateOcrStore.getState().error).toBe('CSV is not available for this template.');
  });
});
