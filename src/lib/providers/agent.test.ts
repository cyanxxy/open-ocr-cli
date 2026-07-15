import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentStep } from '../agentTypes';
import { providerAgentLoop } from './agent';
import type { ProviderRuntimeConfig } from './types';

function response(message: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('provider agent loop', () => {
  it('chains tool results and preserves Kimi reasoning content', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        role: 'assistant',
        content: null,
        reasoning_content: 'I should identify the document first.',
        tool_calls: [{
          id: 'analysis-1',
          type: 'function',
          function: {
            name: 'analyze_document_structure',
            arguments: JSON.stringify({
              document_type: 'invoice',
              layout_analysis: { sections: ['header', 'totals'] },
              extraction_strategy: 'form-based',
              confidence: 0.98,
            }),
          },
        }],
      }))
      .mockResolvedValueOnce(response({
        role: 'assistant',
        content: null,
        reasoning_content: 'Now I can extract canonical invoice fields.',
        tool_calls: [{
          id: 'fields-1',
          type: 'function',
          function: {
            name: 'extract_fields_batch',
            arguments: JSON.stringify({ fields: [
              { field_name: 'vendor_name', field_value: 'Acme BV', confidence: 0.98 },
              { field_name: 'invoice_number', field_value: 'INV-100', confidence: 0.98 },
              { field_name: 'invoice_date', field_value: '2026-07-15', confidence: 0.98 },
              { field_name: 'customer_name', field_value: 'Example NV', confidence: 0.98 },
              { field_name: 'total_amount', field_value: '100.00', confidence: 0.98 },
            ] }),
          },
        }],
      }))
      .mockResolvedValueOnce(response({ role: 'assistant', content: 'Extraction is complete.' }));
    vi.stubGlobal('fetch', fetchMock);

    const config: ProviderRuntimeConfig = {
      provider: 'kimi',
      gateway: 'direct',
      apiKey: 'secret',
      apiKeyEnv: 'MOONSHOT_API_KEY',
      model: 'kimi-k2.6',
      baseUrl: 'https://api.moonshot.ai/v1',
      thinkingConfig: { level: 'HIGH', includeThoughts: true },
    };
    const generator = providerAgentLoop(
      { name: 'invoice.png', type: 'image/png' },
      'data:image/png;base64,AA==',
      config,
      { maxIterations: 2, confidenceThreshold: 0.8, maxTokens: 4096 },
      () => Promise.resolve({ dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 1, height: 1 }),
    );
    let state = await generator.next();
    const steps: AgentStep[] = [];
    while (!state.done) {
      steps.push(state.value);
      state = await generator.next();
    }

    expect(state.value.stopReason).toBe('succeeded');
    expect(state.value.extractedFields.invoice_number.value).toBe('INV-100');
    expect(steps.some((step) => step.content.includes('canonical invoice fields'))).toBe(true);
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    if (typeof secondInit?.body !== 'string') throw new Error('Expected a string request body');
    const secondRequest = JSON.parse(secondInit.body) as { messages: unknown[] };
    expect(secondRequest.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', reasoning_content: 'I should identify the document first.' }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'analysis-1' }),
    ]));
  });

  it('runs region re-OCR through the compatible structured extractor end to end', async () => {
    const region = { page: 1, x: 0.7, y: 0.75, width: 0.2, height: 0.1, units: 'normalized' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'analysis-1',
          type: 'function',
          function: {
            name: 'analyze_document_structure',
            arguments: JSON.stringify({
              document_type: 'form',
              layout_analysis: { sections: ['account details'] },
              extraction_strategy: 'form-based',
              confidence: 0.95,
            }),
          },
        }],
      }))
      .mockResolvedValueOnce(response({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'region-1',
          type: 'function',
          function: {
            name: 're_ocr_region',
            arguments: JSON.stringify({ region, focus: 'account number', confidence_threshold: 0.8 }),
          },
        }],
      }))
      .mockResolvedValueOnce(response({
        role: 'assistant',
        content: JSON.stringify({
          fields: [{ field_name: 'account_number', field_value: 'AC-42', confidence: 0.99 }],
        }),
      }))
      .mockResolvedValueOnce(response({ role: 'assistant', content: 'The region is recovered.' }));
    vi.stubGlobal('fetch', fetchMock);
    const cropper = vi.fn(() => Promise.resolve({
      dataUrl: 'data:image/png;base64,AQ==',
      mimeType: 'image/png',
      width: 200,
      height: 100,
    }));
    const config: ProviderRuntimeConfig = {
      provider: 'openrouter',
      gateway: 'direct',
      apiKey: 'secret',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      model: 'moonshotai/kimi-k2.6',
      baseUrl: 'https://openrouter.ai/api/v1',
      thinkingConfig: { level: 'MEDIUM', includeThoughts: false },
    };
    const generator = providerAgentLoop(
      { name: 'form.png', type: 'image/png' },
      'data:image/png;base64,AA==',
      config,
      { maxIterations: 1, confidenceThreshold: 0.8, maxTokens: 4096 },
      cropper,
    );
    let state = await generator.next();
    while (!state.done) state = await generator.next();

    expect(cropper).toHaveBeenCalledWith('data:image/png;base64,AA==', 'image/png', region);
    expect(state.value.stopReason).toBe('succeeded');
    expect(state.value.extractedFields.account_number).toMatchObject({
      value: 'AC-42',
      confidence: 0.99,
      location: region,
    });
    const regionInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    if (typeof regionInit?.body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(regionInit.body) as unknown).toMatchObject({
      response_format: {
        json_schema: {
          name: 'region_ocr_fields',
          strict: false,
        },
      },
    });
  });
});
