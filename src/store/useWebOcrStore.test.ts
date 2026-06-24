import { beforeEach, describe, expect, it, vi } from 'vitest';

// audit W-02: the store now calls extractTextFromUrls directly (the no-op
// urlOperations.ts wrapper was removed). dedupeRequestedUrls is the real impl.
vi.mock('../lib/gemini/operations', async () => {
  const actual = await vi.importActual<typeof import('../lib/gemini/operations')>('../lib/gemini/operations');
  return {
    ...actual,
    extractTextFromUrls: vi.fn(),
  };
});

import * as operationsModule from '../lib/gemini/operations';
import { initialBaseState } from './base/BaseOcrStore';
import { useSettingsStore } from './useSettingsStore';
import { useWebOcrStore } from './useWebOcrStore';

const mockExtractTextFromUrls = vi.mocked(operationsModule.extractTextFromUrls);

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

    mockExtractTextFromUrls.mockImplementation(async () => {
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

    expect(mockExtractTextFromUrls).not.toHaveBeenCalled();
    const errorMessage = useWebOcrStore.getState().error ?? '';
    // audit H-08: the rejected URL must NOT be echoed verbatim into the error.
    expect(errorMessage).toContain('1 URL rejected');
    expect(errorMessage).not.toContain('javascript:alert(1)');
  });

  // audit H-08: rejects loopback / private / credentialed / tunnelling hosts.
  it('rejects unsafe hosts (loopback, private IP, credentials, tunnel) without echoing them', async () => {
    useWebOcrStore.setState({
      urls: [
        'http://localhost/admin',
        'http://192.168.1.1/',
        'http://user:pass@example.com/',
        'https://abc.ngrok.io/',
      ],
    });

    await useWebOcrStore.getState().processUrls('test-api-key');

    expect(mockExtractTextFromUrls).not.toHaveBeenCalled();
    const errorMessage = useWebOcrStore.getState().error ?? '';
    expect(errorMessage).toContain('4 URLs rejected');
    expect(errorMessage).not.toContain('localhost');
    expect(errorMessage).not.toContain('192.168');
    expect(errorMessage).not.toContain('ngrok');
  });

  // audit H-07: changing inputs clears stale output.
  it('clears stale results when setUrls is called', () => {
    useWebOcrStore.setState({
      urls: ['https://old.example.com'],
      results: [{ url: 'https://old.example.com', content: 'stale', type: 'webpage' }],
      combinedContent: '## stale',
      error: 'old error',
    });

    useWebOcrStore.getState().setUrls(['https://new.example.com']);

    const state = useWebOcrStore.getState();
    expect(state.urls).toEqual(['https://new.example.com']);
    expect(state.results).toEqual([]);
    expect(state.combinedContent).toBe('');
    expect(state.error).toBeNull();
  });

  // audit H-07: switching analysis mode clears stale output.
  it('clears stale results when setAnalysisMode is called', () => {
    useWebOcrStore.setState({
      analysisMode: 'individual',
      results: [{ url: 'https://example.com', content: 'stale', type: 'webpage' }],
      combinedContent: '## stale',
      error: 'old error',
    });

    useWebOcrStore.getState().setAnalysisMode('combined');

    const state = useWebOcrStore.getState();
    expect(state.analysisMode).toBe('combined');
    expect(state.results).toEqual([]);
    expect(state.combinedContent).toBe('');
    expect(state.error).toBeNull();
  });

  // audit W-06: duplicate URLs are collapsed before calling extraction.
  it('deduplicates URLs before calling grounded extraction', async () => {
    mockExtractTextFromUrls.mockResolvedValue({
      results: [{ url: 'https://example.com', content: 'content', type: 'webpage' as const }],
    });

    useWebOcrStore.setState({
      urls: ['https://example.com', 'https://example.com/', 'https://example.com'],
      analysisMode: 'individual',
    });

    await useWebOcrStore.getState().processUrls('test-api-key');

    expect(mockExtractTextFromUrls).toHaveBeenCalledTimes(1);
    const calledUrls = mockExtractTextFromUrls.mock.calls[0][0];
    expect(calledUrls).toEqual(['https://example.com']);
  });

  // audit W-07: cancelProcessing aborts the in-flight run and clears the flags
  // without resetting the URL list.
  it('cancels an in-flight run, leaving URLs intact and results empty', async () => {
    let resolveRun: (() => void) | undefined;
    mockExtractTextFromUrls.mockImplementation(
      () => new Promise(() => {
        // never resolves until aborted; keep a handle so we can release it
        resolveRun = () => {};
      }),
    );

    useWebOcrStore.setState({ urls: ['https://example.com'], analysisMode: 'individual' });
    const run = useWebOcrStore.getState().processUrls('test-api-key');

    // Allow processUrls to flip isProcessing on.
    await Promise.resolve();
    expect(useWebOcrStore.getState().isProcessing).toBe(true);

    useWebOcrStore.getState().cancelProcessing();

    const state = useWebOcrStore.getState();
    expect(state.isProcessing).toBe(false);
    expect(state.abortController).toBeNull();
    expect(state.activeRunId).toBeNull();
    expect(state.results).toEqual([]);
    expect(state.urls).toEqual(['https://example.com']);

    resolveRun?.();
    // Don't await the never-resolving run; cancellation already settled state.
    void run;
  });

  it('surfaces a comparison-mode error instead of silently succeeding', async () => {
    mockExtractTextFromUrls.mockResolvedValue({
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
    mockExtractTextFromUrls.mockRejectedValueOnce(
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
