import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAgentLoop } = vi.hoisted(() => ({
  mockAgentLoop: vi.fn(),
}));

vi.mock('../lib/agentLoop', () => ({
  agentLoop: mockAgentLoop,
}));

import { useAgenticOcrStore } from './useAgenticOcrStore';
import { useSettingsStore } from './useSettingsStore';

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe('useAgenticOcrStore', () => {
  beforeEach(() => {
    mockAgentLoop.mockReset();
    useAgenticOcrStore.getState().reset();
    useSettingsStore.setState({
      apiKey: 'test-key',
      model: 'gemini-3-flash-preview',
      thinkingConfig: {
        level: 'MINIMAL',
        includeThoughts: false,
      },
    });
  });

  afterEach(() => {
    useAgenticOcrStore.getState().reset();
  });

  it('preserves partial extracted fields when the run is stopped', async () => {
    const pause = createDeferred();

    mockAgentLoop.mockImplementation(async function* () {
      yield {
        type: 'thinking',
        content: 'Starting iteration 1/5',
        timestamp: 1,
      };
      yield {
        type: 'result',
        content: 'extract_fields_batch completed',
        timestamp: 2,
        functionResult: {
          success: true,
          memoryUpdate: {
            extractedFields: {
              invoice_number: {
                value: 'INV-42',
                confidence: 0.98,
                location: {
                  page: 1,
                  x: 0.68,
                  y: 0.08,
                  width: 0.2,
                  height: 0.05,
                  units: 'normalized',
                },
              },
            },
            confidence: 0.98,
            lastUpdated: 2,
          },
        },
      };
      await pause.promise;

      return {
        sessionId: 'session-1',
        documentName: 'invoice.pdf',
        currentIteration: 1,
        extractedFields: {
          invoice_number: {
            value: 'INV-42',
            confidence: 0.98,
          },
        },
        processingHistory: [],
        documentAnalysis: {
          pageCount: 1,
          documentType: 'invoice',
          complexity: 'medium',
          specialFeatures: [],
        },
        confidence: 0.98,
        lastUpdated: 3,
      };
    });

    const startPromise = useAgenticOcrStore.getState().startAgent(
      new File(['fixture'], 'invoice.pdf', { type: 'application/pdf' }),
      'data:application/pdf;base64,ZmFrZQ==',
    );

    await flushPromises();
    await waitFor(() => {
      expect(useAgenticOcrStore.getState().extractedFields.invoice_number?.value).toBe('INV-42');
    });
    expect(useAgenticOcrStore.getState().documentMemory?.extractedFields.invoice_number?.location).toEqual({
      page: 1,
      x: 0.68,
      y: 0.08,
      width: 0.2,
      height: 0.05,
      units: 'normalized',
    });

    useAgenticOcrStore.getState().stopAgent();
    pause.resolve();
    await startPromise;

    const state = useAgenticOcrStore.getState();
    expect(state.status).toBe('stopped');
    expect(state.documentMemory?.isComplete).toBe(false);
    expect(state.extractedFields.invoice_number?.value).toBe('INV-42');
  });
});
