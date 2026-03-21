import { type Content } from '@google/genai';
import {
  AgentClientConfig,
  AgentLoopConfig,
  AgentMemory,
  AgentStep,
  ProgressCallback,
  AgentMemoryUpdate
} from './agentTypes';
import { AGENT_FUNCTIONS } from './agentTools';
import {
  executeAgentTurn,
  createAgentSystemPrompt,
  createUserPrompt,
  createFollowUpPrompt
} from './agentGemini';
import { getAgentReadiness } from './agentSchema';

/**
 * Default agent configuration (Gemini 3)
 */
const DEFAULT_AGENT_CONFIG: AgentLoopConfig = {
  maxIterations: 5,
  confidenceThreshold: 0.8,
  temperature: 1,
  maxTokens: 4096,
  enableThinking: true, // Always enabled for Gemini 3
};

/**
 * Create initial agent memory
 */
function createInitialMemory(sessionId: string, fileName: string): AgentMemory {
  return {
    sessionId,
    documentName: fileName,
    currentIteration: 0,
    extractedFields: {},
    processingHistory: [],
    documentAnalysis: {
      pageCount: 1,
      documentType: 'unknown',
      complexity: 'medium',
      specialFeatures: [],
    },
    confidence: 0,
    lastUpdated: Date.now(),
  };
}

/**
 * Apply updates to the agent memory
 */
export function applyMemoryUpdate(memory: AgentMemory, update?: AgentMemoryUpdate) {
  if (!update) return;

  if (update.extractedFields) {
    for (const [fieldName, incomingField] of Object.entries(update.extractedFields)) {
      const existingField = memory.extractedFields[fieldName];
      if (!existingField) {
        memory.extractedFields[fieldName] = incomingField;
        continue;
      }

      const incomingConfidence = incomingField.confidence ?? 0;
      const existingConfidence = existingField.confidence ?? 0;
      const incomingExtractedAt = incomingField.extractedAt ?? 0;
      const existingExtractedAt = existingField.extractedAt ?? 0;
      const shouldReplace = incomingConfidence > existingConfidence
        || (incomingConfidence === existingConfidence && incomingExtractedAt >= existingExtractedAt);

      memory.extractedFields[fieldName] = shouldReplace
        ? { ...existingField, ...incomingField }
        : { ...incomingField, ...existingField };
    }
  }

  if (update.documentAnalysis) {
    Object.assign(memory.documentAnalysis, update.documentAnalysis);
  }

  if (typeof update.confidence === 'number') {
    memory.confidence = update.confidence;
  }

  if (typeof update.lastUpdated === 'number') {
    memory.lastUpdated = update.lastUpdated;
  }

  if (update.processingHistoryItem) {
    memory.processingHistory.push(update.processingHistoryItem);
  }
}

/**
 * Autonomous agent loop that processes documents iteratively.
 * Maintains conversation history across iterations and supports
 * multi-turn function calling within each iteration.
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

    const supportedImageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
    const normalizedMimeType = supportedImageTypes.includes(file.type) ? file.type :
                               (file.type.startsWith('image/') ? 'image/jpeg' : file.type);

    const initialUserPrompt = createUserPrompt(file.name, 1);

    // Build initial user content with the image (only sent once)
    const initialContent: Content = {
      role: 'user',
      parts: [
        { text: initialUserPrompt },
        {
          inlineData: {
            data: base64Data,
            mimeType: normalizedMimeType
          }
        }
      ]
    };
    let previousInteractionId: string | undefined;

    while (iteration < agentConfig.maxIterations && !isComplete) {
      if (clientConfig.abortSignal?.aborted) {
        return memory;
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

        // Execute multi-turn function calling
        const turnResult = await executeAgentTurn(
          systemPrompt,
          iterationContent,
          AGENT_FUNCTIONS,
          fileData,
          file.type,
          memory,
          clientConfig,
          agentConfig,
          () => undefined,
          previousInteractionId,
        );
        previousInteractionId = turnResult.interactionId;

        // Yield all steps produced during the turn
        for (const step of turnResult.steps) {
          yield step;
        }

        if (turnResult.finished) {
          isComplete = true;
          yield {
            type: 'result',
            content: 'Document processing completed successfully',
            timestamp: Date.now(),
          };
          break;
        }

        // Check if we should stop based on confidence
        const readiness = getAgentReadiness(memory);
        if (
          readiness.fieldCount > 0
          && memory.confidence >= agentConfig.confidenceThreshold
          && readiness.missingRequiredFields.length === 0
        ) {
          yield {
            type: 'result',
            content: `Target confidence and required coverage reached: ${(memory.confidence || 0).toFixed(2)}`,
            timestamp: Date.now(),
          };
          isComplete = true;
          break;
        } else if (memory.confidence >= agentConfig.confidenceThreshold && readiness.missingRequiredFields.length > 0) {
          yield {
            type: 'thinking',
            content: `Confidence target reached, but required fields are still missing: ${readiness.missingRequiredFields.join(', ')}`,
            timestamp: Date.now(),
          };
        }

        // Update progress
        onProgress?.(
          20 + iteration * (60 / agentConfig.maxIterations),
          `Iteration ${iteration} completed`
        );

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Iteration failed';
        const loweredError = errorMessage.toLowerCase();
        if (clientConfig.abortSignal?.aborted || loweredError.includes('cancel') || loweredError.includes('abort')) {
          return memory;
        }

        yield {
          type: 'error',
          content: `Error in iteration ${iteration}: ${errorMessage}`,
          timestamp: Date.now(),
        };

        // Continue to next iteration unless it's a critical error
        if (errorMessage.includes('API key') || errorMessage.includes('quota')) {
          break;
        }
      }

      // Brief pause between iterations
      if (clientConfig.abortSignal?.aborted) {
        return memory;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Final status
    if (isComplete) {
      yield {
        type: 'result',
        content: `Processing completed after ${iteration} iterations with ${(memory.confidence || 0).toFixed(2)} confidence`,
        timestamp: Date.now(),
      };
      onProgress?.(100, 'Processing completed');
    } else if (iteration >= agentConfig.maxIterations) {
      yield {
        type: 'result',
        content: `Maximum iterations reached (${agentConfig.maxIterations}). Current confidence: ${(memory.confidence || 0).toFixed(2)}`,
        timestamp: Date.now(),
      };
      onProgress?.(100, 'Max iterations reached');
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Agent processing failed';
    const loweredError = errorMessage.toLowerCase();
    if (clientConfig.abortSignal?.aborted || loweredError.includes('cancel') || loweredError.includes('abort')) {
      return memory;
    }

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
