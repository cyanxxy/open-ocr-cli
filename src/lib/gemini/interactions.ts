import type { Content, FunctionDeclaration } from '@google/genai';
import { getGenAIClient } from './client';
import type { GeminiModel, ThinkingConfig } from './types';

type InteractionToolChoice = 'auto' | 'any' | 'none' | 'validated';

type InteractionTextInput = {
  type: 'text';
  text: string;
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

export type InteractionInputBlock =
  | InteractionTextInput
  | InteractionBinaryInput
  | InteractionFunctionResultInput;

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

interface InteractionRequest {
  apiKey: string;
  model: GeminiModel;
  input: string | InteractionInputBlock[];
  systemInstruction?: string;
  previousInteractionId?: string;
  tools?: Array<Record<string, unknown>>;
  generationConfig?: Record<string, unknown>;
  responseFormat?: Record<string, unknown>;
  responseMimeType?: string;
  abortSignal?: AbortSignal;
  store?: boolean;
}

function mapThinkingLevel(level?: ThinkingConfig['level']): 'low' | 'high' {
  return level === 'HIGH' || level === 'MEDIUM' ? 'high' : 'low';
}

export function createInteractionGenerationConfig(
  config: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    toolChoice?: InteractionToolChoice;
  },
  thinkingConfig?: ThinkingConfig,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.maxOutputTokens !== undefined ? { max_output_tokens: config.maxOutputTokens } : {}),
    ...(config.topP !== undefined ? { top_p: config.topP } : {}),
    ...(config.toolChoice ? { tool_choice: config.toolChoice } : {}),
  };

  const effectiveThinkingConfig = thinkingConfig ?? { level: 'HIGH', includeThoughts: false };
  generationConfig.thinking_level = mapThinkingLevel(effectiveThinkingConfig.level);
  generationConfig.thinking_summaries = effectiveThinkingConfig.includeThoughts ? 'auto' : 'none';

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

  for (const part of content.parts) {
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
      id: output.id || `${output.name}-${index + 1}`,
      name: output.name,
      arguments: typeof output.arguments === 'object' && output.arguments !== null ? output.arguments : {},
    }];
  });
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
