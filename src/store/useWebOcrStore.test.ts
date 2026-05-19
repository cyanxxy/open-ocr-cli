import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/gemini/urlOperations', () => ({
  extractTextFromUrlsProgressive: vi.fn(),
}));

import * as urlOperationsModule from '../lib/gemini/urlOperations';
import { initialBaseState } from './base/BaseOcrStore';
import { useSettingsStore } from './useSettingsStore';
import { useWebOcrStore } from './useWebOcrStore';

const mockExtractTextFromUrlsProgressive = vi.mocked(urlOperationsModule.extractTextFromUrlsProgressive);

describe('useWebOcrStore', () => {
  beforeEach(() => {
    useWebOcrStore.setState({
      ...initialBaseState,
      urls: ['https://example.com'],
      results: [],
      combinedContent: '',
      analysisMode: 'individual',
    });

    useSettingsStore.setState({
      apiKey: '',
      model: 'gemini-3.5-flash',
      thinkingConfig: { level: 'HIGH', includeThoughts: false },
      handwritingMode: false,
      theme: 'light',
      hasSeenOnboarding: false,
      hasHydrated: true,
    });

    vi.clearAllMocks();
  });

  it('keeps the latest URL run when an older run finishes later', async () => {
    const firstResponse = {
      results: [
        { url: 'https://first.example.com', content: 'stale result', type: 'webpage' as const },
      ],
    };
    const secondResponse = {
      results: [
        { url: 'https://second.example.com', content: 'fresh result', type: 'webpage' as const },
      ],
    };

    let resolveFirstRun: (() => void) | undefined;
    let invocationCount = 0;

    mockExtractTextFromUrlsProgressive.mockImplementation(async () => {
      invocationCount += 1;

      if (invocationCount === 1) {
        return await new Promise<typeof firstResponse>((resolve) => {
          resolveFirstRun = () => resolve(firstResponse);
        });
      }

      return secondResponse;
    });

    useWebOcrStore.setState({ urls: ['https://first.example.com'] });
    const firstRun = useWebOcrStore.getState().processUrls('test-api-key');

    useWebOcrStore.setState({ urls: ['https://second.example.com'] });
    await useWebOcrStore.getState().processUrls('test-api-key');

    resolveFirstRun?.();
    await firstRun;

    const state = useWebOcrStore.getState();
    expect(state.results).toEqual(secondResponse.results);
    expect(state.combinedContent).toContain('fresh result');
    expect(state.error).toBeNull();
    expect(state.isProcessing).toBe(false);
    expect(state.activeRunId).toBeNull();
  });

  it('rejects non-http URLs before calling grounded extraction', async () => {
    useWebOcrStore.setState({ urls: ['javascript:alert(1)'] });

    await useWebOcrStore.getState().processUrls('test-api-key');

    expect(mockExtractTextFromUrlsProgressive).not.toHaveBeenCalled();
    expect(useWebOcrStore.getState().error).toBe(
      'Only http:// and https:// URLs are supported: javascript:alert(1)',
    );
  });

  it('surfaces a comparison-mode error instead of silently succeeding', async () => {
    mockExtractTextFromUrlsProgressive.mockResolvedValue({
      combinedContent: 'wrong payload field',
    });

    useWebOcrStore.setState({
      urls: ['https://example.com', 'https://example.org'],
      analysisMode: 'comparison',
    });

    await useWebOcrStore.getState().processUrls('test-api-key');

    const state = useWebOcrStore.getState();
    expect(state.error).toBe('Grounded URL extraction did not return comparison analysis.');
    expect(state.combinedContent).toBe('');
    expect(state.results).toEqual([]);
    expect(state.isProcessing).toBe(false);
  });

  it.each([
    ['individual'],
    ['combined'],
    ['comparison'],
  ] as const)('fails closed when grounded retrieval is unavailable in %s mode', async (analysisMode) => {
    mockExtractTextFromUrlsProgressive.mockRejectedValueOnce(
      new Error('Grounded URL retrieval is unavailable for this API key, model, or region. Web OCR only returns verified URL-context results and will not guess content.'),
    );

    useWebOcrStore.setState({
      urls: ['https://example.com'],
      analysisMode,
    });

    await useWebOcrStore.getState().processUrls('test-api-key');

    const state = useWebOcrStore.getState();
    expect(state.error).toContain('Grounded URL retrieval is unavailable');
    expect(state.results).toEqual([]);
    expect(state.combinedContent).toBe('');
    expect(state.isProcessing).toBe(false);
    expect(state.activeRunId).toBeNull();
  });
});
