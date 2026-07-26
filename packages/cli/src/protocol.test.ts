import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import type { BatchSummary, OcrJobResult, ResolvedInput } from './types';
import {
  agentProtocolStep,
  assertOcrCapabilities,
  assertOcrJobEvent,
  assertOcrMachineResult,
  createOcrCapabilities,
  OCR_PROTOCOL_SCHEMAS,
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

describe('agent protocols', () => {
  it('keeps v1 immutable and exposes modern agent controls only in v2', () => {
    expect(parseOcrJobRequest({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      delivery: { mode: 'reference' },
    }).inputs[0]).toMatchObject({ type: 'path', path: 'invoice.jpg' });
    expect(() => parseOcrJobRequest({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'stdin', name: 'scan.png', mimeType: 'image/png' }],
      noConfig: true,
    })).toThrow('Invalid OCR request v1');
    expect(() => parseOcrJobRequest({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      extraction: { mode: 'agentic', includeThoughts: true },
    })).toThrow('Invalid OCR request v1');
    const modern = parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'stdin', name: 'scan.png', mimeType: 'image/png' }],
      noConfig: true,
      extraction: { mode: 'agentic', progress: 'detailed', thinking: 'max' },
      delivery: { mode: 'inline' },
    });
    expect(modern.inputs[0]).toMatchObject({ type: 'stdin', name: 'scan.png' });
    expect(modern.extraction?.progress).toBe('detailed');
    expect(parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'stdin', name: 'animation.gif', mimeType: 'image/gif' }],
      delivery: { mode: 'inline' },
    }).inputs[0]).toMatchObject({
      type: 'stdin',
      name: 'animation.gif',
      mimeType: 'image/gif',
    });
    expect(parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'url', url: 'https://example.com/report.pdf' }],
      web: { analysis: 'individual' },
      extraction: { mode: 'simple', contentFormat: 'json' },
      delivery: { mode: 'inline' },
    }).inputs[0]).toEqual({ type: 'url', url: 'https://example.com/report.pdf' });
    expect(() => parseOcrJobRequest({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'url', url: 'https://example.com' }],
    })).toThrow('Invalid OCR request v1');
    expect(() => parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [
        { type: 'url', url: 'https://example.com' },
        { type: 'path', path: 'invoice.jpg' },
      ],
    })).toThrow('cannot be mixed');
    expect(() => parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'url', url: 'https://example.com' }],
      extraction: { mode: 'agentic' },
    })).toThrow('simple mode');
    expect(() => parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      unknown: true,
    })).toThrow('Invalid OCR request');
    expect(() => parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      extraction: { schema: {}, schemaPath: 'schema.json' },
    })).toThrow('mutually exclusive');
    expect(() => parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      configPath: 'config.json',
      noConfig: true,
    })).toThrow('noConfig and configPath are mutually exclusive');
    expect(() => parseOcrJobRequest({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [
        { type: 'stdin' },
        { type: 'path', path: 'invoice.jpg' },
      ],
    })).toThrow('only input');
    try {
      parseOcrJobRequest({
        protocolVersion: 2,
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

  it('publishes every v2 runtime request constraint without mutating v1', () => {
    const validateV2 = new Ajv2020({ strict: true, strictRequired: false })
      .compile(OCR_PROTOCOL_SCHEMAS.request);
    const validateV1 = new Ajv2020({ strict: true, strictRequired: false })
      .compile(OCR_PROTOCOL_SCHEMAS['request-v1']);
    expect(validateV2({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      configPath: 'config.json',
      noConfig: true,
    })).toBe(false);
    expect(validateV2({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      configPath: 'config.json',
      noConfig: false,
    })).toBe(true);
    expect(validateV2({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [
        { type: 'stdin' },
        { type: 'path', path: 'invoice.jpg' },
      ],
    })).toBe(false);
    expect(validateV2({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [
        { type: 'path', path: '-' },
        { type: 'path', path: 'invoice.jpg' },
      ],
    })).toBe(false);
    expect(validateV2({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'stdin' }],
      noConfig: true,
    })).toBe(true);
    expect(validateV2({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'url', url: 'https://example.com' }],
      web: { analysis: 'combined' },
      extraction: { contentFormat: 'markdown' },
    })).toBe(true);
    expect(validateV2({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'url', url: 'https://example.com' }],
      extraction: { mode: 'agentic' },
    })).toBe(false);
    expect(validateV1({
      protocolVersion: 1,
      operation: 'extract',
      inputs: [{ type: 'stdin' }],
    })).toBe(false);
  });

  it('returns artifact references without embedding extracted document bodies', () => {
    const timestamp = new Date().toISOString();
    const summary = summaryFor({
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
    });
    const v1 = toOcrRunResult('run-1', summary, 1, 'reference');
    assertOcrMachineResult(v1);
    expect(v1.documents[0]?.artifacts).toEqual([{
      path: '/workspace/output/invoice.md',
      mediaType: 'text/markdown',
      kind: 'markdown',
    }]);
    expect(JSON.stringify(v1)).not.toContain('PRIVATE OCR BODY');

    const v2 = toOcrRunResult('run-2', summary, 2, 'inline', 'markdown');
    assertOcrMachineResult(v2);
    expect(v2.documents[0]?.content).toEqual({ markdown: 'PRIVATE OCR BODY' });

    const tracedSummary = summaryFor({
      ...summary.results[0],
      artifacts: {
        markdown: 'PRIVATE OCR BODY',
        json: { invoice: 'INV-1' },
        agentSteps: [
          {
            type: 'thinking', source: 'reasoning', content: 'raw reasoning', timestamp: 1,
          },
          {
            type: 'function_call',
            source: 'tool_call',
            content: 'Calling inspect',
            functionCall: { id: 'call-1', name: 'inspect', arguments: { region: 'totals' } },
            timestamp: 2,
          },
        ],
      },
    });
    const standard = toOcrRunResult('run-3', tracedSummary, 2, 'inline', 'all', 'standard');
    expect(standard.documents[0]?.content?.agentSteps).toEqual([
      expect.objectContaining({ kind: 'tool_call', callId: 'call-1', name: 'inspect' }),
    ]);
    expect(standard.documents[0]?.content?.agentSteps?.[0]).not.toHaveProperty('arguments');
    const detailed = toOcrRunResult('run-4', tracedSummary, 2, 'inline', 'all', 'detailed');
    expect(detailed.documents[0]?.content?.agentSteps).toEqual([
      expect.objectContaining({ kind: 'reasoning', text: 'raw reasoning' }),
      expect.objectContaining({
        kind: 'tool_call', callId: 'call-1', arguments: { region: 'totals' },
      }),
    ]);
  });

  it('validates typed failures, events, and capability discovery', () => {
    const failure = toOcrRunFailure('run-2', {
      code: 'AUTH_INVALID',
      category: 'authentication',
      message: 'Credential was rejected',
      retryable: false,
      hint: 'Replace the configured credential.',
    });
    assertOcrMachineResult(failure);
    expect(() => assertOcrJobEvent({
      protocolVersion: 2,
      type: 'run.completed',
      runId: 'run-2',
      sequence: 0,
      timestamp: new Date().toISOString(),
      result: failure,
    })).toThrow(/Invalid OCR event/u);
    const timestamp = new Date().toISOString();
    const success = toOcrRunResult('run-2', summaryFor({
      status: 'succeeded',
      input,
      provider: 'gemini',
      gateway: 'direct',
      mode: 'simple',
      model: 'gemini-3.5-flash',
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 1,
      attempts: 1,
      artifacts: { markdown: 'done' },
    }));
    expect(() => assertOcrJobEvent({
      protocolVersion: 2,
      type: 'run.completed',
      runId: 'run-2',
      sequence: 0,
      timestamp,
      result: success,
      error: failure.error,
    })).toThrow(/Invalid OCR event/u);
    expect(() => assertOcrJobEvent({
      protocolVersion: 2,
      type: 'run.failed',
      runId: 'run-2',
      sequence: 0,
      timestamp,
      error: failure.error,
      result: success,
    })).toThrow(/Invalid OCR event/u);
    expect(() => assertOcrJobEvent({
      protocolVersion: 2,
      type: 'document.progress',
      runId: 'run-2',
      sequence: 0,
      timestamp: new Date().toISOString(),
      documentId: 'doc-1',
      index: 0,
      total: 1,
      source: 'invoice.jpg',
      step: {
        kind: 'model_output',
        status: 'in_progress',
        stepId: 'model-output-0',
        text: 'partial OCR output',
        delta: true,
      },
    })).not.toThrow();
    expect(() => assertOcrJobEvent({
      protocolVersion: 2,
      type: 'document.progress',
      runId: 'run-2',
      sequence: 1,
      timestamp: new Date().toISOString(),
      documentId: 'doc-1',
      index: 0,
      total: 1,
      source: 'invoice.jpg',
      step: {
        kind: 'model_output', status: 'in_progress', text: 'unaddressable delta', delta: true,
      },
    })).toThrow(/stepId/u);
    expect(() => agentProtocolStep({
      type: 'thinking',
      source: 'model_output',
      delta: true,
      content: 'unaddressable delta',
      timestamp: 1,
    }, 'standard')).toThrow(/stable step ID/u);
    expect(() => agentProtocolStep({
      type: 'function_call',
      source: 'tool_call',
      content: 'Inspecting a region',
      timestamp: 1,
      functionCall: { name: 'inspect', arguments: {} },
    } as unknown as Parameters<typeof agentProtocolStep>[0], 'standard')).toThrow(/call ID and function name/u);
    expect(() => agentProtocolStep({
      type: 'result',
      source: 'tool_result',
      content: 'Inspection complete',
      timestamp: 1,
      functionCall: { id: 'call-1', arguments: {} },
      functionResult: { success: true },
    } as unknown as Parameters<typeof agentProtocolStep>[0], 'standard')).toThrow(/call ID and function name/u);
    const v1Failure = toOcrRunFailure('legacy-run', failure.error, 1);
    expect(v1Failure.error.code).toBe('AUTH_MISSING');
    const capabilities = createOcrCapabilities('2.1.0');
    expect(capabilities.protocolVersion).toBe(2);
    expect(capabilities.supportedProtocolVersions).toEqual([1, 2]);
    expect(capabilities.inputKinds).toEqual(['path', 'stdin', 'url']);
    expect(capabilities.exitCodes).toMatchObject({ incomplete: 1, invalid: 2 });
    expect(capabilities.deliveryModes).toEqual(['inline', 'reference']);
    expect(capabilities.features).toContain('typed-streaming-agent-progress');
    expect(capabilities.features).toContain('url-input');
    expect(capabilities.features).toContain('mcp-stdio');
    expect(capabilities.progressStepKinds).toContain('tool_result');
    expect(capabilities.schemas.request).toContain('request-v2.schema.json');
    expect(capabilities.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'gemini',
        inputImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
      }),
      expect.objectContaining({
        id: 'kimi',
        inputImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      }),
      expect.objectContaining({
        id: 'muse',
        inputImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        capabilities: expect.objectContaining({ pdfs: true }),
      }),
    ]));
    expect(capabilities.schemaAccess).toEqual({
      command: 'open-ocr-cli schema <name>',
      packageDirectory: 'schemas',
      networkFetch: false,
    });
    expect(() => assertOcrCapabilities({
      ...capabilities,
      providers: [{ id: 'gemini' }],
    })).toThrow(/Invalid OCR capabilities/u);
  });

  it('does not label a failed document plus fail-fast skips as partial', () => {
    const timestamp = new Date().toISOString();
    const failed: OcrJobResult = {
      status: 'failed',
      input,
      provider: 'gemini',
      gateway: 'direct',
      mode: 'simple',
      model: 'gemini-3.5-flash',
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 1,
      attempts: 1,
      error: 'Input failed',
      errorDetails: {
        code: 'INPUT_INVALID', category: 'input', message: 'Input failed', retryable: false,
      },
    };
    const skippedInput = { ...input, absolutePath: '/workspace/skipped.jpg', name: 'skipped.jpg' };
    const skipped: OcrJobResult = {
      ...failed,
      status: 'skipped',
      input: skippedInput,
      attempts: 0,
      skipReason: 'fail-fast',
      error: 'Not started because --fail-fast stopped the batch',
    };
    const result = toOcrRunResult('fail-fast-run', {
      ...summaryFor(failed),
      total: 2,
      failed: 1,
      skipped: 1,
      results: [failed, skipped],
    });
    expect(result.status).toBe('failed');
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
    }), 1, 'reference');
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

describe('protocol validation messages', () => {
  function rejection(request: unknown): { message: string; clauses: string[] } {
    try {
      parseOcrJobRequest(request);
    } catch (error) {
      const message = ocrErrorPayload(error).message;
      return { message, clauses: message.split('; ') };
    }
    throw new Error('Expected the OCR request to be rejected');
  }

  it('collapses a failed input union into one clause naming the wrong key and the fix', () => {
    const { message, clauses } = rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ kind: 'path', path: 'invoice.jpg' }],
    });
    expect(message).toBe(
      'Invalid OCR request v2: '
      + "inputs[0]: unknown field 'kind' — did you mean 'type'? (type must be one of: path, stdin, url)",
    );
    // Every oneOf branch fails at once; only one of them is worth reporting.
    expect(clauses).toHaveLength(1);
    expect(message).not.toContain('oneOf');
    expect(message).not.toContain('must NOT have additional properties');
  });

  it('reports only the branch the discriminator selects when a field is missing', () => {
    const { message, clauses } = rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path' }],
    });
    expect(message).toBe("Invalid OCR request v2: inputs[0]: missing required field 'path'");
    expect(clauses).toHaveLength(1);
    // The stdin and url branches also failed, and neither is relevant here.
    expect(message).not.toContain('url');
  });

  it('lists the discriminator values a schema declares rather than a copy of them', () => {
    expect(rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'file', path: 'invoice.jpg' }],
    }).message).toBe('Invalid OCR request v2: inputs[0]: type must be one of: path, stdin, url');
    expect(rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ path: 'invoice.jpg' }],
    }).message).toBe(
      "Invalid OCR request v2: inputs[0]: missing required field 'type' — must be one of: path, stdin, url",
    );
    const declared = OCR_PROTOCOL_SCHEMAS.request.properties.inputs.items.oneOf
      .map((branch) => branch.properties.type.const);
    expect(declared).toEqual(['path', 'stdin', 'url']);
  });

  it('names the allowed values for a bad enum and the offending key for an unknown field', () => {
    expect(rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      extraction: { mode: 'turbo' },
    }).message).toBe(
      'Invalid OCR request v2: extraction.mode: must be one of: simple, template, agentic',
    );
    const unknownField = rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      unknown: true,
    });
    expect(unknownField.clauses).toHaveLength(1);
    expect(unknownField.message).toContain("unknown field 'unknown' — allowed fields: protocolVersion");
  });

  it('keeps nested and non-union failures readable', () => {
    expect(rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      discovery: { exclude: ['build', 3] },
    }).message).toBe('Invalid OCR request v2: discovery.exclude[1]: must be string');
    expect(rejection({
      protocolVersion: 2,
      operation: 'extract',
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
      execution: { timeoutSeconds: 99_999 },
    }).message).toBe('Invalid OCR request v2: execution.timeoutSeconds: must be <= 3600');
    expect(rejection({
      protocolVersion: 2,
      inputs: [{ type: 'path', path: 'invoice.jpg' }],
    }).message).toBe("Invalid OCR request v2: missing required field 'operation'");
  });

  it('stays single-line and short while preserving the request error contract', () => {
    const payload = (() => {
      try {
        parseOcrJobRequest({
          protocolVersion: 1,
          operation: 'extract',
          inputs: [{ type: 'stdin', name: 'scan.png', mimeType: 'image/png' }],
          noConfig: true,
        });
      } catch (error) {
        return ocrErrorPayload(error);
      }
      throw new Error('Expected the OCR request to be rejected');
    })();
    expect(payload.code).toBe('CONFIG_INVALID');
    expect(payload.category).toBe('configuration');
    expect(payload.retryable).toBe(false);
    expect(payload.hint).toBe(
      'Compare the request with a supported schema using open-ocr-cli schema request-v1 or request-v2.',
    );
    expect(payload.message).not.toMatch(/[\n\r]/u);
    expect(payload.message.length).toBeLessThan(400);
    expect(payload.message.split('; ').length).toBeLessThanOrEqual(5);
    expect(payload.message).toContain("unknown field 'noConfig'");
    expect(payload.message).toContain("inputs[0]: unknown fields 'name', 'mimeType'");
  });
});
