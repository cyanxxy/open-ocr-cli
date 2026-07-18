import { describe, expect, it } from 'vitest';

import type { BatchSummary, OcrJobResult, ResolvedInput } from './types';
import {
  assertOcrJobEvent,
  assertOcrMachineResult,
  createOcrCapabilities,
  parseOcrJobRequest,
  toOcrRunFailure,
  toOcrRunResult,
} from './protocol';
import { ocrErrorPayload } from './errors';

const input: ResolvedInput = {
  absolutePath: '/workspace/invoice.jpg',
  displayPath: 'invoice.jpg',
  relativePath: 'invoice.jpg',
  name: 'invoice.jpg',
  mimeType: 'image/jpeg',
  size: 8,
  mtimeMs: 1,
};

const usage = {
  requests: 1,
  inputTokens: 100,
  outputTokens: 20,
  thoughtTokens: 0,
  toolTokens: 0,
  cachedTokens: 0,
  totalTokens: 120,
  estimatedCostUsd: 0.001,
};

function summaryFor(result: OcrJobResult): BatchSummary {
  return {
    version: 1,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    total: 1,
    succeeded: result.status === 'succeeded' ? 1 : 0,
    partial: result.status === 'partial' ? 1 : 0,
    failed: result.status === 'failed' ? 1 : 0,
    skipped: result.status === 'skipped' ? 1 : 0,
    mode: 'simple',
    provider: 'gemini',
    gateway: 'direct',
    model: 'gemini-3.5-flash',
    usage,
    costLimitReached: false,
    results: [result],
  };
}

describe('agent protocol v1', () => {
  it('accepts versioned requests and rejects unknown or conflicting fields', () => {
    expect(parseOcrJobRequest({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      delivery: { mode: 'reference' },
    }).operation).toBe('extract');
    expect(() => parseOcrJobRequest({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      unknown: true,
    })).toThrow('Invalid OCR request');
    expect(() => parseOcrJobRequest({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      extraction: { schema: {}, schemaPath: 'schema.json' },
    })).toThrow('mutually exclusive');
    try {
      parseOcrJobRequest({
        protocolVersion: 1,
        operation: 'extract',
        inputs: [{ type: 'path', path: 'invoice.jpg' }],
        extraction: { preset: 'invoice', schema: {} },
      });
      throw new Error('Expected the request to be rejected');
    } catch (error) {
      const payload = ocrErrorPayload(error);
      expect(payload.code).toBe('CONFIG_INVALID');
      expect(payload.category).toBe('configuration');
      expect(payload.message).toContain('extraction.preset');
      expect(payload.message).not.toContain('--schema');
    }
  });

  it('returns artifact references without embedding extracted document bodies', () => {
    const timestamp = new Date().toISOString();
    const result = toOcrRunResult('run-1', summaryFor({
      status: 'succeeded',
      input,
      provider: 'gemini',
      gateway: 'direct',
      mode: 'simple',
      model: 'gemini-3.5-flash',
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 5,
      attempts: 1,
      artifacts: { markdown: 'PRIVATE OCR BODY' },
      outputFiles: ['/workspace/output/invoice.md'],
    }));
    assertOcrMachineResult(result);
    expect(result.documents[0]?.artifacts).toEqual([{
      path: '/workspace/output/invoice.md',
      mediaType: 'text/markdown',
      kind: 'markdown',
    }]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE OCR BODY');
  });

  it('validates typed failures, events, and capability discovery', () => {
    const failure = toOcrRunFailure('run-2', {
      code: 'AUTH_MISSING',
      category: 'authentication',
      message: 'Credential is missing',
      retryable: false,
      hint: 'Set the configured environment variable.',
    });
    assertOcrMachineResult(failure);
    expect(() => assertOcrJobEvent({
      protocolVersion: 1,
      type: 'run.failed',
      runId: 'run-2',
      sequence: 0,
      timestamp: new Date().toISOString(),
      error: failure.error,
    })).not.toThrow();
    const capabilities = createOcrCapabilities('2.1.0');
    expect(capabilities.deliveryModes).toEqual(['reference']);
    expect(capabilities.schemas.request).toContain('request-v1.schema.json');
    expect(capabilities.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gemini' }),
    ]));
    expect(capabilities.schemaAccess).toEqual({
      command: 'open-ocr-cli schema <name>',
      packageDirectory: 'schemas',
      networkFetch: false,
    });
  });

  it('couples result ok to terminal status and exposes a dedicated partial event', () => {
    const timestamp = new Date().toISOString();
    const partial = toOcrRunResult('partial-run', summaryFor({
      status: 'partial',
      input,
      provider: 'gemini',
      gateway: 'direct',
      mode: 'simple',
      model: 'gemini-3.5-flash',
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 5,
      attempts: 1,
      outputFiles: ['/workspace/output/invoice.md'],
    }));
    expect(partial.ok).toBe(false);
    expect(() => assertOcrMachineResult({ ...partial, ok: true })).toThrow('Invalid OCR result');
    expect(() => assertOcrJobEvent({
      protocolVersion: 1,
      type: 'document.partial',
      runId: 'partial-run',
      sequence: 0,
      timestamp,
      document: partial.documents[0],
    })).not.toThrow();
    expect(() => assertOcrJobEvent({
      protocolVersion: 1,
      type: 'document.completed',
      runId: 'partial-run',
      sequence: 1,
      timestamp,
      document: partial.documents[0],
    })).toThrow('Invalid OCR event');
  });
});
