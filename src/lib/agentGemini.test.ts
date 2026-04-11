import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Content, FunctionDeclaration } from '@google/genai';

const {
  mockRunModelInteraction,
  mockExecuteAnalyzeDocumentStructure,
  mockExecuteExtractFieldsBatch,
  mockExecuteReOcrRegion,
} = vi.hoisted(() => ({
  mockRunModelInteraction: vi.fn(),
  mockExecuteAnalyzeDocumentStructure: vi.fn(),
  mockExecuteExtractFieldsBatch: vi.fn(),
  mockExecuteReOcrRegion: vi.fn(),
}));

vi.mock('./gemini/interactions', async () => {
  const actual = await vi.importActual<typeof import('./gemini/interactions')>('./gemini/interactions');

  return {
    ...actual,
    runModelInteraction: mockRunModelInteraction,
  };
});

vi.mock('./agentTools', async () => {
  const actual = await vi.importActual<typeof import('./agentTools')>('./agentTools');

  return {
    ...actual,
    executeAnalyzeDocumentStructure: mockExecuteAnalyzeDocumentStructure,
    executeExtractFieldsBatch: mockExecuteExtractFieldsBatch,
    executeReOcrRegion: mockExecuteReOcrRegion,
  };
});

import { executeAgentTurn } from './agentGemini';
import type { AgentMemory } from './agentTypes';

function createMemory(): AgentMemory {
  return {
    sessionId: 'session-1',
    documentName: 'invoice.pdf',
    currentIteration: 1,
    extractedFields: {},
    processingHistory: [],
    documentAnalysis: {
      pageCount: 1,
      documentType: 'invoice',
      complexity: 'medium',
      specialFeatures: [],
    },
    confidence: 0,
    lastUpdated: 100,
  };
}

function createInputContent(): Content {
  return {
    role: 'user',
    parts: [{ text: 'Analyze this invoice.' }],
  };
}

const functions: FunctionDeclaration[] = [
  {
    name: 'analyze_document_structure',
    parametersJsonSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'extract_fields_batch',
    parametersJsonSchema: {
      type: 'object',
      properties: {},
    },
  },
];

describe('executeAgentTurn', () => {
  beforeEach(() => {
    mockRunModelInteraction.mockReset();
    mockExecuteAnalyzeDocumentStructure.mockReset();
    mockExecuteExtractFieldsBatch.mockReset();
    mockExecuteReOcrRegion.mockReset();
  });

  it('treats a response with no tool calls as natural completion', async () => {
    mockRunModelInteraction.mockResolvedValue({
      id: 'interaction-1',
      outputs: [{
        type: 'text',
        text: 'No further tool use is needed.',
      }],
    });

    const transcript: Array<{ role: 'user' | 'model'; content: unknown[] }> = [];
    const result = await executeAgentTurn(
      'system prompt',
      createInputContent(),
      transcript as never,
      functions,
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
      createMemory(),
      {
        apiKey: 'test-key',
        model: 'gemini-3-flash-preview',
      },
      {
        maxIterations: 4,
        confidenceThreshold: 0.8,
        temperature: 1,
        maxTokens: 1024,
      },
      vi.fn(),
    );

    expect(result.finished).toBe(true);
    expect(mockRunModelInteraction).toHaveBeenCalledWith(expect.objectContaining({
      store: false,
      input: transcript,
    }));
    expect(mockRunModelInteraction.mock.calls[0]?.[0]).not.toHaveProperty('previousInteractionId');
    expect(transcript).toHaveLength(2);
  });

  it('executes multiple tool calls serially and returns one function result block per call', async () => {
    mockRunModelInteraction
      .mockResolvedValueOnce({
        id: 'interaction-1',
        outputs: [
          {
            type: 'function_call',
            id: 'call-1',
            name: 'analyze_document_structure',
            arguments: {
              document_type: 'invoice',
              layout_analysis: { sections: 3 },
              extraction_strategy: 'form-based',
              confidence: 0.95,
            },
          },
          {
            type: 'function_call',
            id: 'call-2',
            name: 'extract_fields_batch',
            arguments: {
              fields: [
                {
                  field_name: 'invoice_number',
                  field_value: 'INV-42',
                  confidence: 0.99,
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'interaction-2',
        outputs: [],
      });

    mockExecuteAnalyzeDocumentStructure.mockResolvedValue({
      success: true,
      data: { document_type: 'invoice' },
      memoryUpdate: {
        documentAnalysis: {
          documentType: 'invoice',
          pageCount: 1,
          complexity: 'medium',
          specialFeatures: [],
        },
      },
    });
    mockExecuteExtractFieldsBatch.mockResolvedValue({
      success: true,
      data: { fieldCount: 1 },
      memoryUpdate: {
        extractedFields: {
          invoice_number: {
            value: 'INV-42',
            confidence: 0.99,
          },
        },
        confidence: 0.99,
      },
    });

    const memory = createMemory();
    const transcript: Array<{ role: 'user' | 'model'; content: unknown[] }> = [];
    const result = await executeAgentTurn(
      'system prompt',
      createInputContent(),
      transcript as never,
      functions,
      'data:image/png;base64,ZmFrZQ==',
      'image/png',
      memory,
      {
        apiKey: 'test-key',
        model: 'gemini-3-flash-preview',
      },
      {
        maxIterations: 4,
        confidenceThreshold: 0.8,
        temperature: 1,
        maxTokens: 1024,
      },
      vi.fn(),
    );

    expect(result.finished).toBe(true);
    expect(mockExecuteAnalyzeDocumentStructure).toHaveBeenCalledTimes(1);
    expect(mockExecuteExtractFieldsBatch).toHaveBeenCalledTimes(1);
    expect(memory.documentAnalysis.documentType).toBe('invoice');
    expect(memory.extractedFields.invoice_number?.value).toBe('INV-42');

    const secondCallInput = mockRunModelInteraction.mock.calls[1]?.[0]?.input as Array<{
      role: 'user' | 'model';
      content: Array<{ type: string; call_id?: string; name?: string }>;
    }>;
    const lastTurn = secondCallInput[secondCallInput.length - 1];
    expect(lastTurn?.role).toBe('user');
    expect(lastTurn?.content).toEqual([
      expect.objectContaining({ type: 'function_result', call_id: 'call-1', name: 'analyze_document_structure' }),
      expect.objectContaining({ type: 'function_result', call_id: 'call-2', name: 'extract_fields_batch' }),
    ]);
  });
});
