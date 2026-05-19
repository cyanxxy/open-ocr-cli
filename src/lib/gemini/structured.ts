import type { GeminiModel } from './types';

export function getTopKForModel(model: GeminiModel): number {
  switch (model) {
    case 'gemini-3-flash-preview':
    case 'gemini-3.5-flash':
      return 64;
    case 'gemini-3.1-pro-preview':
      return 40;
    default: {
      const unreachableModel: never = model;
      throw new Error(`Unsupported Gemini model: ${String(unreachableModel)}`);
    }
  }
}

export function extractJsonPayload(rawText: string, contextLabel: string): string {
  const trimmed = rawText.trim();

  if (!trimmed) {
    throw new Error(`${contextLabel} returned an empty response`);
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFenceMatch?.[1]) {
    return codeFenceMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    return objectMatch[0].trim();
  }

  throw new Error(`Could not locate JSON object in ${contextLabel.toLowerCase()} response`);
}

export function parseJsonPayload<T>(rawText: string, contextLabel: string): T {
  try {
    return JSON.parse(extractJsonPayload(rawText, contextLabel)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${contextLabel} returned invalid JSON: ${message}`);
  }
}
