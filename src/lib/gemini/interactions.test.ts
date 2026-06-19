import { describe, expect, it } from 'vitest';

import { createInteractionGenerationConfig } from './interactions';

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
