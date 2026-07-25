import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMemory, AgentStep } from '../../../src/lib/agentTypes';

const { mockAgentLoop } = vi.hoisted(() => ({
  mockAgentLoop: vi.fn(),
}));

vi.mock('../../../src/lib/agentLoop', () => ({
  agentLoop: mockAgentLoop,
}));

import { resolveCliOptions } from './config';
import { discoverInputs } from './inputs';
import { runBatch } from './runner';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
let directory: string;

function partialAgentRun(documentName: string): AsyncGenerator<AgentStep, AgentMemory, void> {
  return (async function* (): AsyncGenerator<AgentStep, AgentMemory, void> {
    await Promise.resolve();
    yield { type: 'thinking', content: 'Inspecting document', timestamp: 1 };
    yield {
      type: 'thinking', source: 'model_output', id: 'completion-1', delta: true,
      content: 'Invoice ', timestamp: 2,
    };
    yield {
      type: 'thinking', source: 'model_output', id: 'completion-1', delta: true,
      content: 'recognized.', timestamp: 3,
    };
    return {
      sessionId: 'session-1',
      documentName,
      currentIteration: 2,
      extractedFields: {
        invoice_number: { value: 'INV-42', confidence: 0.72, extractedAt: 1 },
      },
      processingHistory: [],
      documentAnalysis: {
        pageCount: 1,
        documentType: 'invoice',
        complexity: 'medium',
        specialFeatures: [],
      },
      confidence: 0.72,
      lastUpdated: 1,
      stopReason: 'max_iterations',
    };
  })();
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gemini-ocr-agentic-runner-'));
  process.env.GEMINI_API_KEY = 'test-key';
  mockAgentLoop.mockReset();
  mockAgentLoop.mockImplementation((input: { name: string }) => partialAgentRun(input.name));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
});

describe('CLI agentic batch orchestration', () => {
  it('writes useful partial artifacts and resumes them safely', async () => {
    await writeFile(path.join(directory, 'one.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'two.jpg'), JPEG_BYTES);
    const output = path.join(directory, 'results');
    const options = resolveCliOptions(
      { mode: 'agentic', format: 'all', output, quiet: true },
      {},
      directory,
    );
    const inputs = await discoverInputs(['*.jpg'], options);

    const first = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(mockAgentLoop.mock.calls[0]?.[3]).toEqual(expect.objectContaining({ throwOnFailure: true }));
    expect(first).toMatchObject({ total: 2, succeeded: 0, partial: 2, failed: 0 });
    expect(await readFile(path.join(output, 'one.md'), 'utf8')).toContain('INV-42');
    expect(await readFile(path.join(output, 'one.json'), 'utf8')).toContain('max_iterations');
    const trace = JSON.parse(await readFile(path.join(output, 'one.steps.json'), 'utf8')) as AgentStep[];
    expect(trace).toEqual([
      expect.objectContaining({ content: 'Inspecting document' }),
      expect.objectContaining({
        id: 'completion-1', source: 'model_output', content: 'Invoice recognized.',
      }),
    ]);
    expect(trace[1]).not.toHaveProperty('delta');

    const resumed = await runBatch(inputs, options, {
      abortController: new AbortController(), writeStdout: () => undefined, writeStderr: () => undefined,
    });
    expect(resumed).toMatchObject({ total: 2, partial: 0, failed: 0, skipped: 2 });
    expect(mockAgentLoop).toHaveBeenCalledTimes(2);
  });
});
