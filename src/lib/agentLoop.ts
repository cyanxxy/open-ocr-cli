import { type Content } from '@google/genai';
import {
  AgentClientConfig,
  AgentLoopConfig,
  AgentMemory,
  AgentStep,
  AgentStopReason,
  ProgressCallback,
} from './agentTypes';
import { AGENT_FUNCTIONS } from './agentTools';
import {
  executeAgentTurn,
  createAgentSystemPrompt,
  createUserPrompt,
  createFollowUpPrompt
} from './agentGemini';
import { createInitialMemory } from './agentMemory';
import { evaluateAgentCompletion } from './agentSchema';
import type { InteractionStep } from './gemini/interactions';
import { isFatalGeminiError, isRetryableGeminiError } from './gemini/client';

// Re-export the memory reducer from its neutral home so existing importers that
// reference `applyMemoryUpdate` from this module keep working (the function moved
// to agentMemory.ts to break the agentLoop <-> agentGemini import cycle — A-01).
export { applyMemoryUpdate } from './agentMemory';

/**
 * A cancellation is identified by the abort signal or a fetch-level AbortError —
 * never by substring-matching the message. The previous `includes('cancel')` /
 * `includes('abort')` check misclassified genuine errors that merely mentioned
 * those words as user cancellations and swallowed them with no error step.
 */
function wasAborted(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Default agent configuration (Gemini 3)
 */
const DEFAULT_AGENT_CONFIG: AgentLoopConfig = {
  maxIterations: 5,
  confidenceThreshold: 0.8,
  temperature: 1,
  maxTokens: 16384,
  maxDurationMs: 120000,
};

/** Bounded exponential backoff (with jitter) for transient API failures. */
const MAX_TRANSIENT_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 750;

/** Human-readable closing line for each terminal stop reason (audit A-16). */
function describeStopReason(reason: AgentStopReason, memory: AgentMemory): string {
  const fields = Object.keys(memory.extractedFields).length;
  const confidence = (memory.confidence || 0).toFixed(2);
  switch (reason) {
    case 'succeeded':
      return `Extraction complete: ${fields} field(s) at ${confidence} confidence met the readiness criteria.`;
    case 'partial':
      return `Stopped with partial results: ${fields} field(s) at ${confidence} confidence (below the readiness threshold or missing required fields).`;
    case 'max_iterations':
      return `Reached the maximum iterations: ${fields} field(s) at ${confidence} confidence, not yet meeting the readiness threshold.`;
    case 'tool_limit_reached':
      return `Reached the per-document tool-call limit: finalizing with ${fields} field(s) at ${confidence} confidence.`;
    case 'budget_exhausted':
      return `Reached the time budget for this document: finalizing with ${fields} field(s) at ${confidence} confidence.`;
    case 'failed':
      return `Stopped after repeated errors with ${fields} field(s) at ${confidence} confidence.`;
    case 'cancelled':
      return 'Processing cancelled.';
  }
}

/**
 * Autonomous agent loop that processes documents iteratively.
 * Maintains a local interaction transcript for stateless interactions.
 */
export async function* agentLoop(
  file: File,
  fileData: string,
  clientConfig: AgentClientConfig,
  config: Partial<AgentLoopConfig> = {},
  onProgress?: ProgressCallback
): AsyncGenerator<AgentStep, AgentMemory, unknown> {
  const agentConfig = { ...DEFAULT_AGENT_CONFIG, ...config };
  const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  const memory = createInitialMemory(sessionId, file.name);

  let iteration = 0;
  let isComplete = false;
  let stopReason: AgentStopReason | null = null;
  let transientRetries = 0;
  const deadline = Date.now() + (agentConfig.maxDurationMs ?? DEFAULT_AGENT_CONFIG.maxDurationMs!);

  try {
    // Initialize
    yield {
      type: 'thinking',
      content: 'Initializing autonomous document processing agent...',
      timestamp: Date.now(),
    };

    onProgress?.(10, 'Agent initialized');

    // Prepare file data for the initial content message
    const base64Data = fileData.split(',')[1];
    if (!base64Data) {
      throw new Error('Invalid file data format');
    }

    if (!file.type) {
      throw new Error('File MIME type is required for agent processing');
    }

    const initialUserPrompt = createUserPrompt(file.name, 1);

    // Build initial user content with the image (only sent once)
    const initialContent: Content = {
      role: 'user',
      parts: [
        { text: initialUserPrompt },
        {
          inlineData: {
            data: base64Data,
            mimeType: file.type
          }
        }
      ]
    };
    const interactionTranscript: InteractionStep[] = [];

    while (iteration < agentConfig.maxIterations) {
      if (clientConfig.abortSignal?.aborted) {
        stopReason = 'cancelled';
        break;
      }
      // Wall-clock safety net so a stuck/looping run cannot consume unbounded
      // time and cost even if it never converges (audit H-16).
      if (Date.now() > deadline) {
        stopReason = 'budget_exhausted';
        break;
      }

      iteration++;
      memory.currentIteration = iteration;

      yield {
        type: 'thinking',
        content: `Starting iteration ${iteration}/${agentConfig.maxIterations}`,
        timestamp: Date.now(),
      };

      onProgress?.(
        20 + (iteration - 1) * (60 / agentConfig.maxIterations),
        `Processing iteration ${iteration}`
      );

      try {
        const iterationContent: Content = iteration === 1
          ? initialContent
          : {
              role: 'user',
              parts: [{ text: createFollowUpPrompt(iteration, memory) }],
            };

        const systemPrompt = createAgentSystemPrompt(memory.documentAnalysis.documentType);

        yield {
          type: 'thinking',
          content: `Analyzing document with Gemini AI (iteration ${iteration})...`,
          timestamp: Date.now(),
        };

        const fieldCountBefore = Object.keys(memory.extractedFields).length;

        // Execute multi-turn function calling
        const turnResult = await executeAgentTurn(
          systemPrompt,
          iterationContent,
          interactionTranscript,
          AGENT_FUNCTIONS,
          fileData,
          file.type,
          memory,
          clientConfig,
          agentConfig,
          () => undefined,
        );

        // Yield all steps produced during the turn
        for (const step of turnResult.steps) {
          yield step;
        }

        // A successful turn resets the transient-retry budget.
        transientRetries = 0;

        // The RUNTIME — not the model — decides completion. A turn where the
        // model simply stopped calling tools is NOT success unless the
        // deterministic readiness criteria (required-field coverage + confidence
        // threshold + a valid field) are met (audit C-03 / Q-08 / A-16).
        const completion = evaluateAgentCompletion(
          memory,
          memory.confidence,
          agentConfig.confidenceThreshold,
        );

        if (completion.complete) {
          stopReason = 'succeeded';
          break;
        }

        if (!turnResult.finished) {
          // Inner loop hit MAX_INNER_ROUNDS; the transcript ends on a
          // function_result turn, so appending another follow-up user turn would
          // produce two consecutive user turns. Finalize honestly instead.
          stopReason = 'tool_limit_reached';
          break;
        }

        // Model stopped early without meeting criteria. If it made no progress
        // this iteration, iterating again would only spin — stop as partial.
        // Otherwise continue; the follow-up prompt targets the missing/
        // low-confidence fields.
        const fieldCountAfter = Object.keys(memory.extractedFields).length;
        if (fieldCountAfter === fieldCountBefore) {
          stopReason = 'partial';
          break;
        }

      } catch (error) {
        if (wasAborted(error, clientConfig.abortSignal)) {
          stopReason = 'cancelled';
          break;
        }

        const errorMessage = error instanceof Error ? error.message : 'Iteration failed';
        yield {
          type: 'error',
          content: `Error in iteration ${iteration}: ${errorMessage}`,
          timestamp: Date.now(),
        };

        // Terminal failures (bad key, permission) stop immediately.
        if (isFatalGeminiError(error)) {
          stopReason = 'failed';
          break;
        }

        // Transient failures (rate limit, 5xx, network) are retried with bounded
        // exponential backoff + jitter rather than treated as fatal (audit H-17).
        // executeAgentTurn already rolled its partial transcript turns back, so
        // reusing this iteration slot is safe.
        if (isRetryableGeminiError(error) && transientRetries < MAX_TRANSIENT_RETRIES) {
          transientRetries++;
          const baseDelay = agentConfig.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
          const backoff = baseDelay > 0
            ? baseDelay * 2 ** (transientRetries - 1) + Math.floor(Math.random() * 250)
            : 0;
          yield {
            type: 'thinking',
            content: `Transient error; retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${transientRetries}/${MAX_TRANSIENT_RETRIES}).`,
            timestamp: Date.now(),
          };
          iteration--;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        // Out of retries, or a non-retryable/non-fatal error: give up cleanly.
        stopReason = 'failed';
        break;
      }

      // Brief pause between iterations
      if (clientConfig.abortSignal?.aborted) {
        stopReason = 'cancelled';
        break;
      }
      await new Promise(resolve => setTimeout(resolve, agentConfig.iterationPauseMs ?? 500));
    }

    // Loop exited by the while condition (iterations exhausted) without an
    // explicit stop reason: re-check readiness for an honest terminal label.
    if (stopReason === null) {
      stopReason = evaluateAgentCompletion(
        memory,
        memory.confidence,
        agentConfig.confidenceThreshold,
      ).complete ? 'succeeded' : 'max_iterations';
    }

    if (stopReason === 'cancelled') {
      memory.stopReason = 'cancelled';
      return memory;
    }

    memory.stopReason = stopReason;
    isComplete = stopReason === 'succeeded';
    yield {
      type: 'result',
      content: describeStopReason(stopReason, memory),
      timestamp: Date.now(),
    };
    onProgress?.(100, isComplete ? 'Processing completed' : 'Processing finished');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Agent processing failed';
    if (wasAborted(error, clientConfig.abortSignal)) {
      memory.stopReason = 'cancelled';
      return memory;
    }

    memory.stopReason = 'failed';
    yield {
      type: 'error',
      content: `Agent processing failed: ${errorMessage}`,
      timestamp: Date.now(),
    };
    onProgress?.(100, 'Processing failed');
  }

  // Return final memory state
  return memory;
}
