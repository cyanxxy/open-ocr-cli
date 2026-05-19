import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  isGemini3Model: vi.fn(() => true),
}));

vi.mock('./interactions', async () => {
  const actual = await vi.importActual<typeof import('./interactions')>('./interactions');
  return {
    ...actual,
    runModelInteraction: vi.fn(),
  };
});

import { extractTextFromUrls } from './operations';
import * as interactionsModule from './interactions';

const mockRunModelInteraction = vi.mocked(interactionsModule.runModelInteraction);

describe('extractTextFromUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns comparison analysis only when every URL retrieval is verified', async () => {
    mockRunModelInteraction.mockResolvedValueOnce({
      id: 'interaction-1',
      status: 'completed',
      outputs: [
        {
          type: 'url_context_result',
          result: [
            { status: 'success', url: 'https://example.com' },
            { status: 'success', url: 'https://example.org' },
          ],
        },
        {
          type: 'text',
          text: 'Verified comparison output',
        },
      ],
    });

    await expect(
      extractTextFromUrls(
        ['https://example.com', 'https://example.org'],
        'test-api-key',
        'comparison',
        'gemini-3-flash-preview',
      ),
    ).resolves.toEqual({
      comparisonAnalysis: 'Verified comparison output',
    });
  });

  it('fails closed when URL-context results are missing', async () => {
    mockRunModelInteraction.mockResolvedValueOnce({
      id: 'interaction-2',
      status: 'completed',
      outputs: [
        {
          type: 'text',
          text: 'This should not be trusted',
        },
      ],
    });

    await expect(
      extractTextFromUrls(
        ['https://example.com'],
        'test-api-key',
        'combined',
        'gemini-3-flash-preview',
      ),
    ).rejects.toThrow(
      'Grounded URL retrieval could not be verified for this response. Web OCR only returns verified URL-context results and will not guess content.',
    );
  });

  it('fails closed when any URL retrieval reports an error status', async () => {
    mockRunModelInteraction.mockResolvedValueOnce({
      id: 'interaction-3',
      status: 'completed',
      outputs: [
        {
          type: 'url_context_result',
          result: [
            { status: 'success', url: 'https://example.com' },
            { status: 'error', url: 'https://example.org' },
          ],
        },
        {
          type: 'text',
          text: 'Model guessed anyway',
        },
      ],
    });

    await expect(
      extractTextFromUrls(
        ['https://example.com', 'https://example.org'],
        'test-api-key',
        'comparison',
        'gemini-3-flash-preview',
      ),
    ).rejects.toThrow(
      'Grounded URL retrieval failed for https://example.org (error). Web OCR only returns verified URL-context results and will not guess content.',
    );
  });

  it('fails closed when individual mode does not return a complete per-URL payload', async () => {
    mockRunModelInteraction.mockResolvedValueOnce({
      id: 'interaction-4',
      status: 'completed',
      outputs: [
        {
          type: 'url_context_result',
          result: [
            { status: 'success', url: 'https://example.com' },
            { status: 'success', url: 'https://example.org' },
          ],
        },
        {
          type: 'text',
          text: JSON.stringify({
            results: [
              {
                url: 'https://example.com',
                type: 'webpage',
                content: 'Only one result',
              },
            ],
          }),
        },
      ],
    });

    await expect(
      extractTextFromUrls(
        ['https://example.com', 'https://example.org'],
        'test-api-key',
        'individual',
        'gemini-3-flash-preview',
      ),
    ).rejects.toThrow(
      'Grounded URL extraction did not return a complete result for every requested URL. Web OCR only returns verified URL-context results and will not guess content.',
    );
  });
});
