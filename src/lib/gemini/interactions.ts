import type { Content, FunctionDeclaration } from '@google/genai';
import { getGenAIClient, normalizeThinkingLevel } from './client';
import type { GeminiModel, ThinkingConfig } from './types';

type InteractionToolChoice = 'auto' | 'any' | 'none' | 'validated';

/** Media / text content blocks accepted inside user_input / model_output steps. */
export type InteractionMediaContent =
  | { type: 'text'; text: string }
  | {
      type: 'image' | 'audio' | 'video' | 'document';
      data: string;
      mime_type?: string;
      resolution?: 'low' | 'medium' | 'high' | 'ultra_high';
    };

export type InteractionUserInputStep = {
  type: 'user_input';
  content: InteractionMediaContent[];
};

export type InteractionThoughtStep = {
  type: 'thought';
  signature?: string;
  summary?: Array<{ type?: string; text?: string }>;
};

export type InteractionFunctionCallStep = {
  type: 'function_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type InteractionFunctionResultStep = {
  type: 'function_result';
  call_id: string;
  name: string;
  result: Record<string, unknown> | string;
  is_error?: boolean;
};

export type InteractionModelOutputStep = {
  type: 'model_output';
  content: Array<{ type: 'text'; text: string }>;
};

export type InteractionUrlContextResultStep = {
  type: 'url_context_result';
  call_id?: string;
  is_error?: boolean;
  result?: Array<{
    status?: 'success' | 'error' | 'paywall' | 'unsafe' | string;
    url?: string;
  }>;
  signature?: string;
};

/**
 * A single step in a stateless Interactions transcript.
 * Matches the post–May 2026 Interactions `steps` schema.
 */
export type InteractionStep =
  | InteractionUserInputStep
  | InteractionThoughtStep
  | InteractionFunctionCallStep
  | InteractionFunctionResultStep
  | InteractionModelOutputStep
  | InteractionUrlContextResultStep
  | { type: string; [key: string]: unknown };

/** @deprecated Use InteractionStep — kept as a type alias for call-site migration. */
export type InteractionTurn = InteractionStep;

export interface InteractionResult {
  id: string;
  status?: string;
  steps?: InteractionStep[];
  /** Legacy field kept only for defensive fallback while migrating tests/mocks. */
  outputs?: InteractionStep[];
  output_text?: string;
}

export interface UrlContextResultSummary {
  hasToolError: boolean;
  results: Array<{
    status?: 'success' | 'error' | 'paywall' | 'unsafe' | string;
    url?: string;
  }>;
}

interface InteractionRequest {
  apiKey: string;
  model: GeminiModel;
  input: string | InteractionMediaContent[] | InteractionStep[];
  systemInstruction?: string;
  previousInteractionId?: string;
  tools?: Array<Record<string, unknown>>;
  generationConfig?: Record<string, unknown>;
  /** JSON Schema for structured text output (Interactions polymorphic response_format). */
  responseSchema?: Record<string, unknown>;
  responseMimeType?: 'application/json' | 'text/plain';
  abortSignal?: AbortSignal;
  store?: boolean;
}

/**
 * Pick Interactions media resolution for OCR quality.
 * Images: high (fine text). PDFs: medium (docs say quality saturates).
 */
export function mediaResolutionForMime(
  mimeType: string,
): 'low' | 'medium' | 'high' {
  if (mimeType === 'application/pdf' || mimeType.startsWith('application/')) {
    return 'medium';
  }
  return 'high';
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
  // Gemini 3.x docs recommend leaving temperature/top_p/top_k at defaults.
  // Only set temperature when callers intentionally override; omit top_p.
  const generationConfig: Record<string, unknown> = {
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.maxOutputTokens !== undefined ? { max_output_tokens: config.maxOutputTokens } : {}),
    ...(config.toolChoice ? { tool_choice: config.toolChoice } : {}),
  };

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

export function contentToInteractionInput(
  content: Pick<Content, 'parts'>,
): InteractionMediaContent[] {
  const input: InteractionMediaContent[] = [];

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
          resolution: mediaResolutionForMime(mimeType),
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

export function createUserInputStep(content: InteractionMediaContent[]): InteractionUserInputStep {
  return { type: 'user_input', content };
}

/** @deprecated Prefer createUserInputStep — role-based turns are no longer the Interactions wire shape. */
export function createInteractionTurn(
  _role: 'user' | 'model',
  content: InteractionMediaContent[] | InteractionStep[],
): InteractionStep {
  // Historical API: role user + content blocks → user_input step.
  // Model turns should use appendModelStepsFromInteraction instead.
  if (content.length > 0 && typeof content[0] === 'object' && content[0] !== null && 'type' in content[0]) {
    const first = content[0] as { type: string };
    if (
      first.type === 'function_result'
      || first.type === 'thought'
      || first.type === 'function_call'
      || first.type === 'model_output'
      || first.type === 'user_input'
    ) {
      return content[0] as InteractionStep;
    }
  }
  return createUserInputStep(content as InteractionMediaContent[]);
}

/**
 * Canonical correlation id for a model function call. Used by BOTH
 * model-step replay and extractInteractionFunctionCalls so the id on the
 * model step always matches the id on the function_result we send back.
 */
export function interactionCallId(
  step: { id?: string; call_id?: string; name?: string },
  index: number,
): string {
  return step.id || step.call_id || `${step.name || 'call'}-${index + 1}`;
}

function toArgsObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Normalize steps from either the new `steps` field or legacy `outputs` mocks. */
export function getInteractionSteps(interaction: InteractionResult | null | undefined): InteractionStep[] {
  if (!interaction) return [];
  if (Array.isArray(interaction.steps) && interaction.steps.length > 0) {
    return interaction.steps;
  }
  if (Array.isArray(interaction.outputs)) {
    return interaction.outputs;
  }
  return [];
}

/**
 * Convert model-generated steps into a replayable transcript slice for
 * stateless Interactions mode.
 *
 * Gemini requires every model-generated step — including ALL parallel
 * function_call steps and thought signatures — to be echoed back verbatim.
 * Never drop parallel calls from history (even if the runtime only executes
 * one); declined calls must still appear here and get a matching function_result.
 */
export function selectModelStepsForReplay(steps?: InteractionStep[]): InteractionStep[] {
  if (!steps || steps.length === 0) {
    return [];
  }

  const replay: InteractionStep[] = [];

  for (const [index, step] of steps.entries()) {
    if (!step || typeof step !== 'object' || typeof step.type !== 'string') {
      continue;
    }

    if (step.type === 'thought') {
      const thought = step as InteractionThoughtStep;
      if (thought.signature || Array.isArray(thought.summary)) {
        replay.push({
          type: 'thought',
          ...(thought.signature ? { signature: thought.signature } : {}),
          ...(Array.isArray(thought.summary) ? { summary: thought.summary } : {}),
        });
      }
      continue;
    }

    if (step.type === 'function_call') {
      const fc = step as InteractionFunctionCallStep & { name?: string; arguments?: unknown };
      if (typeof fc.name !== 'string' || fc.name.length === 0) {
        continue;
      }
      replay.push({
        type: 'function_call',
        id: interactionCallId(fc, index),
        name: fc.name,
        arguments: toArgsObject(fc.arguments),
      });
      continue;
    }

    if (step.type === 'model_output') {
      const mo = step as InteractionModelOutputStep;
      const textBlocks = (mo.content || [])
        .filter((block): block is { type: 'text'; text: string } =>
          !!block && block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0)
        .map((block) => ({ type: 'text' as const, text: block.text }));
      if (textBlocks.length > 0) {
        replay.push({ type: 'model_output', content: textBlocks });
      }
      continue;
    }

    // Legacy flat text shapes (tests and transitional mocks).
    if (step.type === 'text') {
      const legacyText = (step as Record<string, unknown>).text;
      if (typeof legacyText === 'string' && legacyText.trim()) {
        replay.push({ type: 'model_output', content: [{ type: 'text', text: legacyText.trim() }] });
      }
      continue;
    }
  }

  return replay;
}

/** @deprecated Use selectModelStepsForReplay */
export function outputsToModelTurn(outputs?: InteractionStep[]): InteractionStep | null {
  const steps = selectModelStepsForReplay(outputs);
  return steps[0] ?? null;
}

export function extractInteractionText(
  steps?: InteractionStep[],
  fallbackOutputText?: string,
): string {
  if (steps && steps.length > 0) {
    const parts: string[] = [];
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      if (step.type === 'model_output') {
        const mo = step as InteractionModelOutputStep;
        for (const block of mo.content || []) {
          if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            parts.push(block.text.trim());
          }
        }
      } else if (step.type === 'text') {
        const legacyText = (step as Record<string, unknown>).text;
        if (typeof legacyText === 'string' && legacyText.trim()) {
          parts.push(legacyText.trim());
        }
      }
    }
    if (parts.length > 0) {
      return parts.join('\n').trim();
    }
  }

  return typeof fallbackOutputText === 'string' ? fallbackOutputText.trim() : '';
}

export function extractInteractionThoughtSummaries(steps?: InteractionStep[]): string[] {
  if (!steps) {
    return [];
  }

  return steps
    .filter((step): step is InteractionThoughtStep => step?.type === 'thought' && Array.isArray((step as InteractionThoughtStep).summary))
    .map((step) =>
      (step.summary || [])
        .map((part) => (typeof part.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}

export function extractInteractionFunctionCalls(steps?: InteractionStep[]): Array<{
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}> {
  if (!steps) {
    return [];
  }

  return steps.flatMap((step, index) => {
    if (step?.type !== 'function_call') {
      return [];
    }
    const fc = step as InteractionFunctionCallStep & { name?: string; arguments?: unknown };
    if (typeof fc.name !== 'string' || fc.name.length === 0) {
      return [];
    }

    return [{
      id: interactionCallId(fc, index),
      name: fc.name,
      arguments: toArgsObject(fc.arguments),
    }];
  });
}

export function summarizeUrlContextResults(steps?: InteractionStep[]): UrlContextResultSummary {
  if (!steps) {
    return { hasToolError: false, results: [] };
  }

  return steps.reduce<UrlContextResultSummary>((summary, step) => {
    if (step?.type !== 'url_context_result') {
      return summary;
    }

    const urlStep = step as InteractionUrlContextResultStep;
    if (urlStep.is_error) {
      summary.hasToolError = true;
    }

    if (Array.isArray(urlStep.result)) {
      summary.results.push(
        ...urlStep.result
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

function buildResponseFormat(
  responseSchema?: Record<string, unknown>,
  responseMimeType?: 'application/json' | 'text/plain',
): Record<string, unknown> | undefined {
  if (!responseSchema && !responseMimeType) {
    return undefined;
  }

  return {
    type: 'text',
    ...(responseMimeType ? { mime_type: responseMimeType } : {}),
    ...(responseSchema ? { schema: responseSchema } : {}),
  };
}

export async function runModelInteraction({
  apiKey,
  model,
  input,
  systemInstruction,
  previousInteractionId,
  tools,
  generationConfig,
  responseSchema,
  responseMimeType,
  abortSignal,
  store,
}: InteractionRequest): Promise<InteractionResult> {
  const genAI = getGenAIClient(apiKey);
  const responseFormat = buildResponseFormat(responseSchema, responseMimeType);

  const params: Record<string, unknown> = {
    model,
    input,
    ...(store !== undefined ? { store } : {}),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(generationConfig ? { generation_config: generationConfig } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };

  const options = abortSignal
    ? { fetch_options: { signal: abortSignal } }
    : undefined;

  const interactionsClient = genAI.interactions as unknown as {
    create: (
      createParams: Record<string, unknown>,
      createOptions?: { fetch_options?: { signal?: AbortSignal } },
    ) => Promise<InteractionResult>;
  };

  return interactionsClient.create(params, options);
}
