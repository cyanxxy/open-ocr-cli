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

  it('treats a response with no tool calls as natural completion once fields exist', async () => {
    mockRunModelInteraction.mockResolvedValue({
      id: 'interaction-1',
      outputs: [{
        type: 'text',
        text: 'No further tool use is needed.',
      }],
    });

    // Seed memory so a tool-call-free turn is a genuine completion, not an early bailout.
    const memory = createMemory();
    memory.extractedFields.invoice_number = { value: 'INV-1', confidence: 0.95 };

    const transcript: Array<{ role: 'user' | 'model'; content: unknown[] }> = [];
    const result = await executeAgentTurn(
      'system prompt',
      createInputContent(),
      transcript as never,
      functions,
      'data:application/pdf;base64,ZmFrZQ==',
      'application/pdf',
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
    expect(mockRunModelInteraction).toHaveBeenCalledTimes(1);
    expect(mockRunModelInteraction).toHaveBeenCalledWith(expect.objectContaining({
      store: false,
      input: transcript,
    }));
    expect(mockRunModelInteraction.mock.calls[0]?.[0]).not.toHaveProperty('previousInteractionId');
    expect(transcript).toHaveLength(2);
  });

  it('nudges the model to use its tools instead of finishing empty on a prose-only opener', async () => {
    // Model opens with prose and never calls a tool; with no extracted fields yet this
    // must NOT be treated as completion (regression guard for the empty-result bug).
    mockRunModelInteraction.mockResolvedValue({
      id: 'interaction-1',
      outputs: [{
        type: 'text',
        text: 'Let me analyze this document first.',
      }],
    });

    const transcript: Array<{ role: 'user' | 'model'; content: Array<{ type: string; text?: string }> }> = [];
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

    // It nudges once (a second model interaction) before giving up.
    expect(mockRunModelInteraction).toHaveBeenCalledTimes(2);
    expect(result.finished).toBe(true);

    const nudgeTurn = transcript.find((turn) =>
      turn.role === 'user'
      && turn.content.some((block) => block.type === 'text' && /call.*tools/i.test(block.text ?? '')),
    );
    expect(nudgeTurn).toBeDefined();
  });

  it('runs only the first tool per round and returns its result before the next decision', async () => {
    // The model batches two calls in one response. The runtime must execute only
    // the FIRST (analyze), send its result back, and let the model decide the
    // next tool with that result in hand (audit A-02). The replayed model turn
    // keeps only the first call so the single result correlates 1:1.
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
              fields: [{ field_name: 'invoice_number', field_value: 'INV-42', confidence: 0.99 }],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'interaction-2',
        outputs: [
          {
            type: 'function_call',
            id: 'call-3',
            name: 'extract_fields_batch',
            arguments: {
              fields: [{ field_name: 'invoice_number', field_value: 'INV-42', confidence: 0.99 }],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'interaction-3', outputs: [] });

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

    // Inspect the final transcript. Every model turn must carry at most ONE
    // function_call block (the batched second call was trimmed), and every
    // function_result turn must answer exactly one call — keeping calls and
    // results correlated 1:1 (audit A-02 / A-05).
    const turns = transcript as Array<{ role: 'user' | 'model'; content: Array<{ type: string; call_id?: string; name?: string }> }>;
    const modelCallCounts = turns
      .filter((t) => t.role === 'model')
      .map((t) => t.content.filter((b) => b.type === 'function_call').length);
    expect(modelCallCounts.every((n) => n <= 1)).toBe(true);

    const resultTurns = turns.filter(
      (t) => t.role === 'user' && t.content.some((b) => b.type === 'function_result'),
    );
    expect(resultTurns.every((t) => t.content.filter((b) => b.type === 'function_result').length === 1)).toBe(true);

    const firstResult = resultTurns[0]?.content.find((b) => b.type === 'function_result');
    expect(firstResult).toEqual(
      expect.objectContaining({ call_id: 'call-1', name: 'analyze_document_structure' }),
    );
  });
});
