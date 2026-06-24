import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockExecuteAgentTurn } = vi.hoisted(() => ({
  mockExecuteAgentTurn: vi.fn(),
}));

vi.mock('./agentGemini', () => ({
  executeAgentTurn: mockExecuteAgentTurn,
  createAgentSystemPrompt: vi.fn(() => 'system prompt'),
  createUserPrompt: vi.fn(() => 'initial prompt'),
  createFollowUpPrompt: vi.fn(() => 'follow-up prompt'),
}));

import { agentLoop, applyMemoryUpdate } from './agentLoop';
import type { AgentMemory, AgentStep } from './agentTypes';

async function drainLoop(generator: AsyncGenerator<AgentStep, AgentMemory>) {
  const steps: AgentStep[] = [];
  let current = await generator.next();
  while (!current.done) {
    steps.push(current.value);
    current = await generator.next();
  }
  return { steps, memory: current.value };
}

const FIXTURE_FILE = () => new File(['fixture'], 'invoice.pdf', { type: 'application/pdf' });
const FIXTURE_DATA = 'data:application/pdf;base64,ZmFrZQ==';
// Zero out the backoff/pause so retry behavior is exercised without real waits.
const BASE_CONFIG = {
  confidenceThreshold: 0.8,
  temperature: 1,
  maxTokens: 1024,
  retryBaseDelayMs: 0,
  iterationPauseMs: 0,
};

function createMemory(): AgentMemory {
  return {
    sessionId: 'session-1',
    documentName: 'invoice.pdf',
    currentIteration: 1,
    extractedFields: {
      invoice_number: {
        value: 'INV-1',
        confidence: 0.8,
      },
    },
    processingHistory: [],
    documentAnalysis: {
      pageCount: 1,
      documentType: 'invoice',
      complexity: 'medium',
      specialFeatures: [],
    },
    confidence: 0.8,
    lastUpdated: 100,
  };
}

describe('applyMemoryUpdate', () => {
  it('merges extracted fields, document analysis, and history items', () => {
    const memory = createMemory();

    applyMemoryUpdate(memory, {
      extractedFields: {
        total: {
          value: '1471.50',
          confidence: 0.95,
        },
      },
      documentAnalysis: {
        pageCount: 2,
        specialFeatures: ['table'],
      },
      confidence: 0.91,
      lastUpdated: 200,
      processingHistoryItem: {
        type: 'result',
        content: 'Applied update',
        timestamp: 123,
      },
    });

    expect(memory.extractedFields.total?.value).toBe('1471.50');
    expect(memory.documentAnalysis.pageCount).toBe(2);
    expect(memory.documentAnalysis.specialFeatures).toEqual(['table']);
    expect(memory.confidence).toBe(0.91);
    expect(memory.lastUpdated).toBe(200);
    expect(memory.processingHistory).toHaveLength(1);
  });

  it('does nothing when no update is provided', () => {
    const memory = createMemory();

    applyMemoryUpdate(memory);

    expect(memory.extractedFields.invoice_number?.value).toBe('INV-1');
    expect(memory.processingHistory).toHaveLength(0);
  });

  it('keeps the higher-confidence version of a field when updates collide', () => {
    const memory = createMemory();

    applyMemoryUpdate(memory, {
      extractedFields: {
        invoice_number: {
          value: 'INV-1-low',
          confidence: 0.4,
          extractedAt: 200,
        },
      },
    });

    expect(memory.extractedFields.invoice_number?.value).toBe('INV-1');

    applyMemoryUpdate(memory, {
      extractedFields: {
        invoice_number: {
          value: 'INV-1-final',
          confidence: 0.95,
          extractedAt: 300,
        },
      },
    });

    expect(memory.extractedFields.invoice_number?.value).toBe('INV-1-final');
    expect(memory.extractedFields.invoice_number?.confidence).toBe(0.95);
  });
});

describe('agentLoop', () => {
  beforeEach(() => {
    mockExecuteAgentTurn.mockReset();
  });

  it('reports success only when readiness criteria are met', async () => {
    // The model stops calling tools AND the runtime's deterministic criteria
    // (a valid field + confidence >= threshold) are satisfied (audit C-03).
    mockExecuteAgentTurn.mockImplementation(async (...args: unknown[]) => {
      const memory = args[6] as AgentMemory;
      memory.extractedFields.note = { value: 'hello', confidence: 0.9, isValid: true, extractedAt: 1 };
      memory.confidence = 0.9;
      return {
        finished: true,
        steps: [{ type: 'thinking', content: 'No more tool calls are needed.', timestamp: 1 }],
      };
    });

    const { steps, memory } = await drainLoop(agentLoop(
      FIXTURE_FILE(),
      FIXTURE_DATA,
      { apiKey: 'test-key', model: 'gemini-3-flash-preview' },
      { maxIterations: 3, ...BASE_CONFIG },
    ));

    expect(mockExecuteAgentTurn).toHaveBeenCalledTimes(1);
    expect(memory.stopReason).toBe('succeeded');
    expect(steps.some((s) => s.type === 'result' && s.content.includes('Extraction complete'))).toBe(true);
    expect(memory.currentIteration).toBe(1);
  });

  it('does NOT report success when the model stops early with zero fields', async () => {
    // finished:true but no extraction must be a partial result, never a success
    // (the previous loop mapped any finished turn to "completed successfully").
    mockExecuteAgentTurn.mockResolvedValue({
      finished: true,
      steps: [{ type: 'thinking', content: 'Looks done to me.', timestamp: 1 }],
    });

    const { steps, memory } = await drainLoop(agentLoop(
      FIXTURE_FILE(),
      FIXTURE_DATA,
      { apiKey: 'test-key', model: 'gemini-3-flash-preview' },
      { maxIterations: 3, ...BASE_CONFIG },
    ));

    expect(memory.stopReason).toBe('partial');
    expect(steps.some((s) => s.type === 'result' && /partial/i.test(s.content))).toBe(true);
    expect(steps.some((s) => s.content === 'Document processing completed successfully')).toBe(false);
  });

  it('finalizes instead of looping when the inner tool-call rounds are exhausted', async () => {
    mockExecuteAgentTurn.mockResolvedValue({ finished: false, steps: [] });

    const { steps, memory } = await drainLoop(agentLoop(
      FIXTURE_FILE(),
      FIXTURE_DATA,
      { apiKey: 'test-key', model: 'gemini-3-flash-preview' },
      { maxIterations: 3, ...BASE_CONFIG },
    ));

    // Terminal: a single turn that exhausts its rounds must NOT start a new
    // iteration on top of a dangling function_result turn.
    expect(mockExecuteAgentTurn).toHaveBeenCalledTimes(1);
    expect(memory.stopReason).toBe('tool_limit_reached');
    expect(steps.some((s) => s.type === 'result' && s.content.includes('tool-call limit'))).toBe(true);
  });

  it('breaks immediately on a terminal (auth) API error and emits an error step', async () => {
    mockExecuteAgentTurn.mockRejectedValue(new Error('API key invalid'));

    const { steps, memory } = await drainLoop(agentLoop(
      FIXTURE_FILE(),
      FIXTURE_DATA,
      { apiKey: 'test-key', model: 'gemini-3-flash-preview' },
      { maxIterations: 3, ...BASE_CONFIG },
    ));

    expect(mockExecuteAgentTurn).toHaveBeenCalledTimes(1);
    expect(memory.stopReason).toBe('failed');
    expect(steps.some((s) => s.type === 'error')).toBe(true);
  });

  it('retries a transient error with backoff before giving up', async () => {
    mockExecuteAgentTurn.mockRejectedValue(new Error('503 service unavailable'));

    const { steps, memory } = await drainLoop(agentLoop(
      FIXTURE_FILE(),
      FIXTURE_DATA,
      { apiKey: 'test-key', model: 'gemini-3-flash-preview' },
      { maxIterations: 3, ...BASE_CONFIG },
    ));

    // A transient error is retried (more than the single initial attempt) and
    // only then gives up — it is NOT treated as immediately fatal (audit H-17).
    expect(mockExecuteAgentTurn.mock.calls.length).toBeGreaterThan(1);
    expect(steps.some((s) => s.type === 'thinking' && /retrying/i.test(s.content))).toBe(true);
    expect(memory.stopReason).toBe('failed');
  });

  it('returns immediately without calling the model when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const { steps, memory } = await drainLoop(agentLoop(
      FIXTURE_FILE(),
      FIXTURE_DATA,
      { apiKey: 'test-key', model: 'gemini-3-flash-preview', abortSignal: controller.signal },
      { maxIterations: 3, ...BASE_CONFIG },
    ));

    expect(mockExecuteAgentTurn).not.toHaveBeenCalled();
    expect(steps.some((s) => s.type === 'error')).toBe(false);
    expect(memory.extractedFields).toEqual({});
  });
});
