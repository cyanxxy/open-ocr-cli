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
import type { InteractionStep } from './gemini/interactions';

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
      status: 'completed',
      steps: [{
        type: 'model_output',
        content: [{ type: 'text', text: 'No further tool use is needed.' }],
      }],
    });

    const memory = createMemory();
    memory.extractedFields.invoice_number = { value: 'INV-1', confidence: 0.95 };

    const transcript: InteractionStep[] = [];
    const result = await executeAgentTurn(
      'system prompt',
      createInputContent(),
      transcript,
      functions,
      '[PDF attachment removed — 0 KB]',
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
    // user_input + model_output
    expect(transcript).toHaveLength(2);
    expect(transcript[0]?.type).toBe('user_input');
    expect(transcript[1]?.type).toBe('model_output');
  });

  it('nudges the model to use its tools instead of finishing empty on a prose-only opener', async () => {
    mockRunModelInteraction.mockResolvedValue({
      id: 'interaction-1',
      status: 'completed',
      steps: [{
        type: 'model_output',
        content: [{ type: 'text', text: 'Let me analyze this document first.' }],
      }],
    });

    const transcript: InteractionStep[] = [];
    const result = await executeAgentTurn(
      'system prompt',
      createInputContent(),
      transcript,
      functions,
      '[PDF attachment removed — 0 KB]',
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

    expect(mockRunModelInteraction).toHaveBeenCalledTimes(2);
    expect(result.finished).toBe(true);

    const nudge = transcript.find((step) =>
      step.type === 'user_input'
      && Array.isArray((step as { content?: Array<{ text?: string }> }).content)
      && (step as { content: Array<{ text?: string }> }).content.some(
        (block) => /call.*tools|Begin now by calling/i.test(block.text ?? ''),
      ),
    );
    expect(nudge).toBeDefined();
  });

  it('runs only the first tool per round and returns its result before the next decision', async () => {
    mockRunModelInteraction
      .mockResolvedValueOnce({
        id: 'interaction-1',
        status: 'requires_action',
        steps: [
          {
            type: 'thought',
            signature: 'sig-1',
            summary: [{ text: 'analyzing' }],
          },
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
        status: 'requires_action',
        steps: [
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
      .mockResolvedValueOnce({ id: 'interaction-3', status: 'completed', steps: [] });

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
    const transcript: InteractionStep[] = [];
    const result = await executeAgentTurn(
      'system prompt',
      createInputContent(),
      transcript,
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
    // Parallel second call is declined with an error result, not executed.
    expect(mockExecuteExtractFieldsBatch).toHaveBeenCalledTimes(1);
    expect(memory.documentAnalysis.documentType).toBe('invoice');
    expect(memory.extractedFields.invoice_number?.value).toBe('INV-42');

    // Stateless history: every function_call must remain in the transcript and
    // have exactly one matching function_result (including declined parallels).
    const functionCalls = transcript.filter((s) => s.type === 'function_call');
    const functionResults = transcript.filter((s) => s.type === 'function_result');
    expect(functionCalls.map((c) => (c as { id: string }).id)).toEqual(
      expect.arrayContaining(['call-1', 'call-2']),
    );
    expect(functionResults).toHaveLength(functionCalls.length);
    expect(functionResults[0]).toEqual(
      expect.objectContaining({ call_id: 'call-1', name: 'analyze_document_structure', is_error: false }),
    );
    expect(functionResults.find((r) => (r as { call_id?: string }).call_id === 'call-2')).toEqual(
      expect.objectContaining({
        call_id: 'call-2',
        name: 'extract_fields_batch',
        is_error: true,
      }),
    );
    // Thought signature was preserved in the transcript
    expect(transcript.some((s) => s.type === 'thought' && (s as { signature?: string }).signature === 'sig-1')).toBe(true);
  });
});
