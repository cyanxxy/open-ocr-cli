import type { Content, FunctionDeclaration } from '@google/genai';
import { getGenAIClient, normalizeThinkingLevel } from './client';
import type { GeminiModel, ThinkingConfig } from './types';

type InteractionToolChoice = 'auto' | 'any' | 'none' | 'validated';

type InteractionTextInput = {
  type: 'text';
  text: string;
};

type InteractionFunctionCallInput = {
  type: 'function_call';
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
};

type InteractionBinaryInput = {
  type: 'image' | 'audio' | 'video' | 'document';
  data: string;
  mime_type?: string;
  resolution?: 'low' | 'medium' | 'high';
};

export type InteractionFunctionResultInput = {
  type: 'function_result';
  call_id: string;
  name: string;
  result: Record<string, unknown>;
  is_error?: boolean;
};

/**
 * A model-generated reasoning block. Gemini 3 multi-turn function calling in
 * stateless mode (`store: false`) requires every model step — including
 * `thought` steps and their opaque `signature` — to be echoed back verbatim in
 * the replayed history. Dropping the signature breaks the reasoning chain on the
 * next tool round (audit C-02). The wire shape mirrors the SDK `ThoughtContent`.
 */
export type InteractionThoughtInput = {
  type: 'thought';
  signature?: string;
  summary?: Array<{ text?: string }>;
};

export type InteractionInputBlock =
  | InteractionTextInput
  | InteractionFunctionCallInput
  | InteractionBinaryInput
  | InteractionFunctionResultInput
  | InteractionThoughtInput;

export interface InteractionTurn {
  role: 'user' | 'model';
  content: InteractionInputBlock[];
}

export interface InteractionOutput {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  summary?: Array<{
    text?: string;
  }>;
  arguments?: Record<string, unknown>;
  call_id?: string;
  result?: unknown;
  is_error?: boolean;
  signature?: string;
}

export interface InteractionResult {
  id: string;
  status?: string;
  outputs?: InteractionOutput[];
}

export interface UrlContextResultSummary {
  hasToolError: boolean;
  results: Array<{
    status?: 'success' | 'error' | 'paywall' | 'unsafe';
    url?: string;
  }>;
}

interface InteractionRequest {
  apiKey: string;
  model: GeminiModel;
  input: string | InteractionInputBlock[] | InteractionTurn[];
  systemInstruction?: string;
  previousInteractionId?: string;
  tools?: Array<Record<string, unknown>>;
  generationConfig?: Record<string, unknown>;
  responseFormat?: Record<string, unknown>;
  responseMimeType?: string;
  abortSignal?: AbortSignal;
  store?: boolean;
}

export function createInteractionGenerationConfig(
  config: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    toolChoice?: InteractionToolChoice;
  },
  model: GeminiModel,
  thinkingConfig?: ThinkingConfig,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.maxOutputTokens !== undefined ? { max_output_tokens: config.maxOutputTokens } : {}),
    ...(config.topP !== undefined ? { top_p: config.topP } : {}),
    ...(config.toolChoice ? { tool_choice: config.toolChoice } : {}),
  };

  // Map the UI level to the model-gated lowercase wire value. MEDIUM/MINIMAL are
  // preserved here (the previous mapping collapsed everything to low/high, which
  // silently over-reasoned and over-billed on the Interactions path).
  generationConfig.thinking_level = normalizeThinkingLevel(thinkingConfig?.level, model);
  generationConfig.thinking_summaries = thinkingConfig?.includeThoughts ? 'auto' : 'none';

  return generationConfig;
}

export function createInteractionFunctionTools(
  functions: FunctionDeclaration[],
): Array<Record<string, unknown>> {
  return functions
    .filter((fn): fn is FunctionDeclaration & { name: string } => typeof fn.name === 'string' && fn.name.length > 0)
    .map((fn) => ({
      type: 'function',
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      ...(fn.parametersJsonSchema !== undefined
        ? { parameters: fn.parametersJsonSchema }
        : fn.parameters !== undefined
          ? { parameters: fn.parameters }
          : {}),
    }));
}

export function contentToInteractionInput(content: Pick<Content, 'parts'>): InteractionInputBlock[] {
  const input: InteractionInputBlock[] = [];

  for (const part of content.parts ?? []) {
    if ('text' in part && typeof part.text === 'string' && part.text.trim().length > 0) {
      input.push({
        type: 'text',
        text: part.text,
      });
    }

    if ('inlineData' in part && part.inlineData && typeof part.inlineData.data === 'string') {
      const mimeType = part.inlineData.mimeType || 'application/octet-stream';
      const baseInput = {
        data: part.inlineData.data,
        mime_type: mimeType,
      };

      if (mimeType.startsWith('image/')) {
        input.push({
          type: 'image',
          ...baseInput,
        });
      } else if (mimeType.startsWith('audio/')) {
        input.push({
          type: 'audio',
          ...baseInput,
        });
      } else if (mimeType.startsWith('video/')) {
        input.push({
          type: 'video',
          ...baseInput,
        });
      } else {
        input.push({
          type: 'document',
          ...baseInput,
        });
      }
    }
  }

  return input;
}

export function createInteractionTurn(
  role: InteractionTurn['role'],
  content: InteractionInputBlock[],
): InteractionTurn {
  return { role, content };
}

/**
 * Canonical correlation id for a model function call. Used by BOTH
 * outputsToModelTurn (building the replayed model turn) and
 * extractInteractionFunctionCalls (the calls we execute) so the id on the
 * model turn always matches the id on the function_result we send back. The
 * previous code derived these two ids differently (one consulted `call_id`,
 * the other did not), so a result could correlate to the wrong call (audit A-05).
 */
export function interactionCallId(output: InteractionOutput, index: number): string {
  return output.id || output.call_id || `${output.name}-${index + 1}`;
}

/** Reject arrays (which are `typeof === 'object'`) as a function-args object. */
function toArgsObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function outputsToModelTurn(outputs?: InteractionOutput[]): InteractionTurn | null {
  if (!outputs || outputs.length === 0) {
    return null;
  }

  const content: InteractionInputBlock[] = [];

  for (const [index, output] of outputs.entries()) {
    if (output.type === 'text' && typeof output.text === 'string' && output.text.trim().length > 0) {
      content.push({
        type: 'text',
        text: output.text,
      });
      continue;
    }

    // Preserve thought steps (and their signature) exactly as received. Required
    // for stateless multi-turn function calling; see InteractionThoughtInput.
    if (output.type === 'thought' && (output.signature || Array.isArray(output.summary))) {
      content.push({
        type: 'thought',
        ...(output.signature ? { signature: output.signature } : {}),
        ...(Array.isArray(output.summary) ? { summary: output.summary } : {}),
      });
      continue;
    }

    if (output.type === 'function_call' && typeof output.name === 'string' && output.name.length > 0) {
      content.push({
        type: 'function_call',
        id: interactionCallId(output, index),
        name: output.name,
        arguments: toArgsObject(output.arguments),
      });
    }
  }

  if (content.length === 0) {
    return null;
  }

  return createInteractionTurn('model', content);
}

export function extractInteractionText(outputs?: InteractionOutput[]): string {
  if (!outputs) {
    return '';
  }

  return outputs
    .filter((output) => output.type === 'text' && typeof output.text === 'string')
    .map((output) => output.text!.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function extractInteractionThoughtSummaries(outputs?: InteractionOutput[]): string[] {
  if (!outputs) {
    return [];
  }

  return outputs
    .filter((output) => output.type === 'thought' && Array.isArray(output.summary))
    .map((output) =>
      (output.summary || [])
        .map((part) => (typeof part.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}

export function extractInteractionFunctionCalls(outputs?: InteractionOutput[]): Array<{
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}> {
  if (!outputs) {
    return [];
  }

  return outputs.flatMap((output, index) => {
    if (output.type !== 'function_call' || typeof output.name !== 'string' || output.name.length === 0) {
      return [];
    }

    return [{
      id: interactionCallId(output, index),
      name: output.name,
      arguments: toArgsObject(output.arguments),
    }];
  });
}

export function summarizeUrlContextResults(outputs?: InteractionOutput[]): UrlContextResultSummary {
  if (!outputs) {
    return { hasToolError: false, results: [] };
  }

  return outputs.reduce<UrlContextResultSummary>((summary, output) => {
    if (output.type !== 'url_context_result') {
      return summary;
    }

    if (output.is_error) {
      summary.hasToolError = true;
    }

    if (Array.isArray(output.result)) {
      summary.results.push(
        ...(output.result as Array<{ status?: 'success' | 'error' | 'paywall' | 'unsafe'; url?: string }>)
          .filter((entry) => typeof entry === 'object' && entry !== null)
          .map((entry) => ({
            status: entry.status,
            url: entry.url,
          })),
      );
    }

    return summary;
  }, { hasToolError: false, results: [] });
}

export async function runModelInteraction({
  apiKey,
  model,
  input,
  systemInstruction,
  previousInteractionId,
  tools,
  generationConfig,
  responseFormat,
  responseMimeType,
  abortSignal,
  store,
}: InteractionRequest): Promise<InteractionResult> {
  const genAI = getGenAIClient(apiKey);
  const interactionsClient = genAI.interactions as unknown as {
    create: (
      params: Record<string, unknown>,
      options?: {
        signal?: AbortSignal;
      }
    ) => Promise<InteractionResult>;
  };

  const params: Record<string, unknown> = {
    model,
    input,
    ...(store !== undefined ? { store } : {}),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(generationConfig ? { generation_config: generationConfig } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(responseMimeType ? { response_mime_type: responseMimeType } : {}),
  };

  return interactionsClient.create(
    params,
    abortSignal ? { signal: abortSignal } : undefined,
  );
}
