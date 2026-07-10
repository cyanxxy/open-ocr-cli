import { describe, expect, it } from 'vitest';

import {
  createInteractionGenerationConfig,
  extractInteractionFunctionCalls,
  extractInteractionText,
  getInteractionSteps,
  selectModelStepsForReplay,
  type InteractionStep,
} from './interactions';

describe('selectModelStepsForReplay — stateless replay fidelity (C-02 / A-05 / A-06)', () => {
  it('preserves thought steps and their signature verbatim', () => {
    const steps: InteractionStep[] = [
      { type: 'thought', signature: 'sig-abc', summary: [{ text: 'reasoning' }] },
      { type: 'function_call', id: 'call-1', name: 'analyze_document_structure', arguments: { a: 1 } },
    ];
    const replay = selectModelStepsForReplay(steps);
    const thought = replay.find((b) => b.type === 'thought');
    expect(thought).toEqual({ type: 'thought', signature: 'sig-abc', summary: [{ text: 'reasoning' }] });
  });

  it('uses the same canonical id for the model step and the executed call', () => {
    const steps: InteractionStep[] = [
      { type: 'function_call', call_id: 'cid-7', name: 'extract_fields_batch', arguments: {} } as InteractionStep,
    ];
    const replayCall = selectModelStepsForReplay(steps).find((b) => b.type === 'function_call');
    const executed = extractInteractionFunctionCalls(steps);
    expect((replayCall as { id?: string }).id).toBe('cid-7');
    expect(executed[0].id).toBe('cid-7');
  });

  it('preserves every parallel function_call for stateless history fidelity', () => {
    const steps: InteractionStep[] = [
      { type: 'function_call', id: 'c1', name: 'analyze_document_structure', arguments: {} },
      { type: 'function_call', id: 'c2', name: 'extract_fields_batch', arguments: {} },
    ];
    const replay = selectModelStepsForReplay(steps);
    const calls = replay.filter((s) => s.type === 'function_call');
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => (c as { id: string }).id)).toEqual(['c1', 'c2']);
  });

  it('rejects an array passed as function-call arguments', () => {
    const steps: InteractionStep[] = [
      { type: 'function_call', id: 'c1', name: 'f', arguments: ['not', 'an', 'object'] as unknown as Record<string, unknown> },
    ];
    expect(extractInteractionFunctionCalls(steps)[0].arguments).toEqual({});
    const call = selectModelStepsForReplay(steps).find((b) => b.type === 'function_call');
    expect((call as { arguments?: unknown }).arguments).toEqual({});
  });

  it('maps legacy flat text outputs into model_output steps', () => {
    const steps: InteractionStep[] = [
      { type: 'text', text: 'hello world' } as InteractionStep,
    ];
    const replay = selectModelStepsForReplay(steps);
    expect(replay).toEqual([{
      type: 'model_output',
      content: [{ type: 'text', text: 'hello world' }],
    }]);
  });
});

describe('extractInteractionText', () => {
  it('reads text from model_output steps', () => {
    expect(extractInteractionText([
      { type: 'model_output', content: [{ type: 'text', text: 'Verified comparison output' }] },
    ])).toBe('Verified comparison output');
  });

  it('falls back to output_text sugar', () => {
    expect(extractInteractionText([], '  sdk sugar  ')).toBe('sdk sugar');
  });
});

describe('getInteractionSteps', () => {
  it('prefers steps over legacy outputs', () => {
    expect(getInteractionSteps({
      id: 'i1',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'new' }] }],
      outputs: [{ type: 'text', text: 'old' } as InteractionStep],
    }).map((s) => s.type)).toEqual(['model_output']);
  });

  it('falls back to outputs for transitional mocks', () => {
    expect(getInteractionSteps({
      id: 'i1',
      outputs: [{ type: 'url_context_result', result: [] }],
    })).toHaveLength(1);
  });
});

describe('createInteractionGenerationConfig', () => {
  it('maps each thinking level to its model-gated lowercase wire value', () => {
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
      createInteractionGenerationConfig({}, 'gemini-3.1-flash-lite', { level: 'MINIMAL' }).thinking_level,
    ).toBe('minimal');
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'LOW' }).thinking_level,
    ).toBe('low');
    expect(
      createInteractionGenerationConfig({}, 'gemini-3-flash-preview', { level: 'HIGH' }).thinking_level,
    ).toBe('high');
  });

  it('clamps MINIMAL to a supported default when the model does not support it (Pro)', () => {
    expect(
      createInteractionGenerationConfig({}, 'gemini-3.1-pro-preview', { level: 'MINIMAL' }).thinking_level,
    ).toBe('high');
  });

  it('defaults thinking when no thinking config is given', () => {
    const flash = createInteractionGenerationConfig({}, 'gemini-3.5-flash');
    expect(flash.thinking_level).toBe('medium');
    expect(flash.thinking_summaries).toBe('none');

    const lite = createInteractionGenerationConfig({}, 'gemini-3.1-flash-lite');
    expect(lite.thinking_level).toBe('minimal');

    const pro = createInteractionGenerationConfig({}, 'gemini-3.1-pro-preview');
    expect(pro.thinking_level).toBe('high');
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

  it('passes through generation parameters using Interactions snake_case keys without top_p', () => {
    const config = createInteractionGenerationConfig(
      { temperature: 0.4, maxOutputTokens: 2048, topP: 0.8, toolChoice: 'validated' },
      'gemini-3-flash-preview',
    );
    expect(config.temperature).toBe(0.4);
    expect(config.max_output_tokens).toBe(2048);
    expect(config.top_p).toBeUndefined();
    expect(config.tool_choice).toBe('validated');
  });
});
