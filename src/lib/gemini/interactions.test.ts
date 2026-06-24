import { describe, expect, it } from 'vitest';

import {
  createInteractionGenerationConfig,
  extractInteractionFunctionCalls,
  outputsToModelTurn,
  type InteractionOutput,
} from './interactions';

describe('outputsToModelTurn — stateless replay fidelity (C-02 / A-05 / A-06)', () => {
  it('preserves thought blocks and their signature verbatim', () => {
    const outputs: InteractionOutput[] = [
      { type: 'thought', signature: 'sig-abc', summary: [{ text: 'reasoning' }] },
      { type: 'function_call', id: 'call-1', name: 'analyze_document_structure', arguments: { a: 1 } },
    ];
    const turn = outputsToModelTurn(outputs);
    const thought = turn?.content.find((b) => b.type === 'thought');
    expect(thought).toEqual({ type: 'thought', signature: 'sig-abc', summary: [{ text: 'reasoning' }] });
  });

  it('uses the same canonical id for the model turn and the executed call', () => {
    // Output carries call_id but no id: both paths must resolve to call_id so the
    // function_result we later send correlates to the right call (A-05).
    const outputs: InteractionOutput[] = [
      { type: 'function_call', call_id: 'cid-7', name: 'extract_fields_batch', arguments: {} },
    ];
    const turnCall = outputsToModelTurn(outputs)?.content.find((b) => b.type === 'function_call');
    const executed = extractInteractionFunctionCalls(outputs);
    expect((turnCall as { id?: string }).id).toBe('cid-7');
    expect(executed[0].id).toBe('cid-7');
  });

  it('rejects an array passed as function-call arguments', () => {
    const outputs: InteractionOutput[] = [
      { type: 'function_call', id: 'c1', name: 'f', arguments: ['not', 'an', 'object'] as unknown as Record<string, unknown> },
    ];
    expect(extractInteractionFunctionCalls(outputs)[0].arguments).toEqual({});
    const call = outputsToModelTurn(outputs)?.content.find((b) => b.type === 'function_call');
    expect((call as { arguments?: unknown }).arguments).toEqual({});
  });
});

describe('createInteractionGenerationConfig', () => {
  it('maps each thinking level to its model-gated lowercase wire value', () => {
    // The previous mapping collapsed MEDIUM/MINIMAL into high/low. These must be
    // preserved so the Interactions (Web OCR) path does not over- or under-reason.
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'MEDIUM' }).thinking_level,
    ).toBe('medium');
    expect(
      createInteractionGenerationConfig({}, 'gemini-3.1-pro-preview', { level: 'MEDIUM' }).thinking_level,
    ).toBe('medium');
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'MINIMAL' }).thinking_level,
    ).toBe('minimal');
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'LOW' }).thinking_level,
    ).toBe('low');
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'HIGH' }).thinking_level,
    ).toBe('high');
  });

  it('clamps MINIMAL to the model default when the model does not support it (Pro)', () => {
    expect(
      createInteractionGenerationConfig({}, 'gemini-3.1-pro-preview', { level: 'MINIMAL' }).thinking_level,
    ).toBe('high');
  });

  it('defaults to high reasoning with summaries disabled when no thinking config is given', () => {
    const config = createInteractionGenerationConfig({}, 'gemini-3-flash-preview');
    expect(config.thinking_level).toBe('high');
    expect(config.thinking_summaries).toBe('none');
  });

  it('enables thought summaries only when includeThoughts is set', () => {
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'HIGH', includeThoughts: true })
        .thinking_summaries,
    ).toBe('auto');
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'HIGH', includeThoughts: false })
        .thinking_summaries,
    ).toBe('none');
  });

  it('passes through generation parameters using the Interactions snake_case keys', () => {
    const config = createInteractionGenerationConfig(
      { temperature: 0.4, maxOutputTokens: 2048, topP: 0.8, toolChoice: 'validated' },
      'gemini-3-flash-preview',
    );
    expect(config.temperature).toBe(0.4);
    expect(config.max_output_tokens).toBe(2048);
    expect(config.top_p).toBe(0.8);
    expect(config.tool_choice).toBe('validated');
  });
});
