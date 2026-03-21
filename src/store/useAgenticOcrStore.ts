// Top-level imports
import { create } from 'zustand';
import { useSettingsStore } from './useSettingsStore';
import { logger } from '../lib/logger';
import { AgentMemory, AgentStep } from '../lib/agentTypes';
import { createAbortController, createRunId } from './base/BaseOcrStore';

// --- Type Definitions ---

/**
 * Represents the result of a field extraction with confidence
 * Matches the structure from AgentMemory.extractedFields
 */
export interface FieldResult {
  value: string;
  confidence: number;
  iteration: number;
  validated: boolean;
  // Extended fields from agent memory
  validationRule?: string;
  location?: string;
  validationMessage?: string;
  extractedAt?: number;
}

/**
 * Represents a log entry from the agent
 */
export interface AgentLog {
  id: string;
  timestamp: number;
  type: 'info' | 'warning' | 'error' | 'function_call';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Represents the document memory that persists across agent iterations
 */
export interface DocumentMemory {
  sessionId: string;
  documentName: string;
  totalPages: number;
  processedPages: number[];
  extractedFields: Record<string, FieldResult>;
  globalContext: Record<string, unknown>;
  isComplete: boolean;
  confidence: number;
  lastUpdated: number;
}

/**
 * Represents the current status of the agent
 */
export type AgentStatus = 'idle' | 'initializing' | 'processing' | 'analyzing' | 'extracting' | 'validating' | 'completed' | 'error' | 'stopped';

/**
 * Represents a function call made by the agent
 */
export interface AgentFunctionCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp: number;
}

/**
 * Agent configuration options
 */
export interface AgentConfig {
  maxIterations: number;
  confidenceThreshold: number;
  enableFieldValidation: boolean;
  enableCrossPageContext: boolean;
  costOptimization: boolean;
  enableThinking: boolean;
}

/**
 * Defines the state and actions for the agentic OCR feature.
 * This store manages the autonomous document processing workflow,
 * including agent state, document memory, extracted fields, and logs.
 */
interface AgenticOcrState {
  // --- State ---
  /** Current status of the agent */
  status: AgentStatus;
  /** Current step description */
  currentStep: string;
  /** Current iteration number */
  currentIteration: number;
  /** Document memory that persists across iterations */
  documentMemory: DocumentMemory | null;
  /** Extracted fields with confidence scores */
  extractedFields: Record<string, FieldResult>;
  /** Agent execution logs */
  logs: AgentLog[];
  /** Processing progress (0-100) */
  progress: number;
  /** Any error that occurred */
  error: string;
  /** Whether the agent is currently running */
  isProcessing: boolean;
  /** Agent configuration */
  config: AgentConfig;
  /** Function calls made by the agent */
  functionCalls: AgentFunctionCall[];
  /** Whether content has been copied to clipboard */
  isCopied: boolean;
  /** Timeout ID for copy notification cleanup */
  copyTimeoutId: ReturnType<typeof setTimeout> | null;
  /** AbortController for cancelling agent operations */
  abortController: AbortController | null;
  /** Identifier for the currently active run */
  activeRunId: string | null;

  // --- Actions ---
  /**
   * Starts the agentic OCR process for a given file
   * @param file - The file to process
   * @param imageData - The base64 data URL of the file
   * @param config - Agent configuration options
   */
  startAgent: (file: File, imageData: string, config?: Partial<AgentConfig>) => Promise<void>;
  
  /**
   * Stops the currently running agent
   */
  stopAgent: () => void;
  
  /**
   * Updates the agent status and current step
   * @param status - New agent status
   * @param step - Description of current step
   */
  updateStatus: (status: AgentStatus, step: string) => void;
  
  /**
   * Updates the processing progress
   * @param progress - Progress percentage (0-100)
   */
  updateProgress: (progress: number) => void;
  
  /**
   * Adds a log entry
   * @param log - Log entry to add
   */
  addLog: (log: Omit<AgentLog, 'id' | 'timestamp'>) => void;
  
  /**
   * Updates document memory
   * @param updates - Partial updates to document memory
   */
  updateDocumentMemory: (updates: Partial<DocumentMemory>) => void;
  
  /**
   * Adds or updates an extracted field
   * @param key - Field key
   * @param result - Field result
   */
  updateField: (key: string, result: FieldResult) => void;
  
  /**
   * Records a function call made by the agent
   * @param functionCall - Function call details
   */
  recordFunctionCall: (functionCall: Omit<AgentFunctionCall, 'timestamp'>) => void;
  
  /**
   * Copies extracted content to clipboard
   */
  copyToClipboard: () => Promise<void>;
  
  /**
   * Resets the store to initial state
   */
  reset: () => void;
  
  /**
   * Updates agent configuration
   * @param config - New configuration options
   */
  updateConfig: (config: Partial<AgentConfig>) => void;
}

/**
 * Default agent configuration
 */
const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 5,
  confidenceThreshold: 0.8,
  enableFieldValidation: true,
  enableCrossPageContext: true,
  costOptimization: true,
  enableThinking: false,
};

/**
 * Generates a unique session ID
 */
const generateSessionId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

/**
 * Generates a unique log ID
 */
const generateLogId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

/**
 * Zustand store for managing the state of the agentic OCR feature.
 *
 * This store handles:
 * - Agent lifecycle management (start, stop, status updates)
 * - Document memory and context persistence
 * - Field extraction with confidence scoring
 * - Agent logs and function call tracking
 * - Progress monitoring and error handling
 */
export const useAgenticOcrStore = create<AgenticOcrState>((set, get) => ({
  // --- Initial State ---
  status: 'idle',
  currentStep: '',
  currentIteration: 0,
  documentMemory: null,
  extractedFields: {},
  logs: [],
  progress: 0,
  error: '',
  isProcessing: false,
  config: DEFAULT_CONFIG,
  functionCalls: [],
  isCopied: false,
  copyTimeoutId: null,
  abortController: null,
  activeRunId: null,

  startAgent: async (file: File, imageData: string, configOverrides?: Partial<AgentConfig>) => {
    const config = { ...DEFAULT_CONFIG, ...configOverrides };
    const previousAbortController = get().abortController;
    const abortController = createAbortController();
    const runId = createRunId();
    const isCurrentRun = () => get().activeRunId === runId;

    const documentMemory: DocumentMemory = {
      sessionId: generateSessionId(),
      documentName: file.name,
      totalPages: 1, // Will be updated for PDFs
      processedPages: [],
      extractedFields: {},
      globalContext: {},
      isComplete: false,
      confidence: 0,
      lastUpdated: Date.now(),
    };

    set({
      isProcessing: true,
      status: 'initializing',
      currentStep: 'Initializing agent...',
      currentIteration: 0,
      documentMemory,
      extractedFields: {},
      logs: [],
      progress: 0,
      error: '',
      config,
      functionCalls: [],
      abortController,
      activeRunId: runId,
    });
    previousAbortController?.abort();

    get().addLog({
      type: 'info',
      message: 'Agent started',
      details: { fileName: file.name, config },
    });

    try {
      const fileData = imageData;

      // Import agent loop dynamically to avoid circular dependencies
      const { agentLoop } = await import('../lib/agentLoop');

      const { apiKey, model: userModel, thinkingConfig } = useSettingsStore.getState();

      if (!apiKey) {
        throw new Error('Please set your API key in settings');
      }

      const generator = agentLoop(
        file,
        fileData,
        {
          apiKey,
          model: userModel,
          thinkingConfig,
          abortSignal: abortController.signal,
        },
        {
          maxIterations: config.maxIterations,
          confidenceThreshold: config.confidenceThreshold,
          temperature: 1,
          maxTokens: 4096,
          // Thinking is controlled by global settings, not per-agent config
        },
        (progress: number, message: string) => {
          if (!isCurrentRun() || abortController.signal.aborted) {
            return;
          }

          set({
            progress: Math.max(0, Math.min(100, progress)),
            currentStep: message,
          });
        }
      );

      // Manual iteration to capture both yielded steps AND return value
      let iteratorResult = await generator.next();

      while (!iteratorResult.done) {
        if (!isCurrentRun() || !get().isProcessing || abortController.signal.aborted) {
          logger.info('Agent stopped by user - exiting loop');
          return;
        }

        const step = iteratorResult.value as AgentStep;
        const logType = step.type === 'function_call'
          ? 'function_call'
          : step.type === 'error'
            ? 'error'
            : 'info';

        // Update state based on agent step
        get().addLog({
          type: logType,
          message: step.content,
          details: step.functionCall ? { functionCall: step.functionCall, result: step.functionResult } : undefined,
        });

        // Update status based on step type
        if (step.type === 'function_call') {
          set({
            status: 'processing',
            currentStep: step.content,
          });

          if (step.functionCall) {
            get().recordFunctionCall(step.functionCall);
          }
        } else if (step.type === 'thinking' && step.content.includes('Starting iteration')) {
          // Track iteration from agent loop's iteration announcements
          const match = step.content.match(/Starting iteration (\d+)/);
          if (match) {
            set({
              status: 'processing',
              currentStep: step.content,
              currentIteration: parseInt(match[1], 10),
            });
          }
        } else if (step.type === 'result') {
          set({
            status: 'processing',
            currentStep: step.content,
          });
        } else if (step.type === 'error') {
          set({
            status: 'error',
            currentStep: step.content,
            error: step.content,
          });
        } else {
          set({
            status: 'processing',
            currentStep: step.content,
          });
        }

        // Check again before getting next step (in case stop was called during processing)
        if (!isCurrentRun() || !get().isProcessing || abortController.signal.aborted) {
          logger.info('Agent stopped by user - exiting loop');
          return;
        }

        // Get next step
        iteratorResult = await generator.next();
      }

      if (!isCurrentRun()) {
        return;
      }

      // NOW we have the final memory from the generator's return value
      const finalMemory = iteratorResult.value as AgentMemory;

      // Sync extracted fields from final memory to store (SINGLE SOURCE OF TRUTH)
      if (finalMemory && finalMemory.extractedFields) {
        for (const [fieldName, fieldData] of Object.entries(finalMemory.extractedFields)) {
          if (!fieldData) continue;

          get().updateField(fieldName, {
            value: fieldData.value || '',
            confidence: fieldData.confidence ?? 0.9,
            iteration: finalMemory.currentIteration,
            validated: Boolean(fieldData.isValid ?? true),
            // Preserve extended field data from agent memory
            validationRule: fieldData.validation_rule,
            location: fieldData.location,
            validationMessage: fieldData.validationMessage,
            extractedAt: fieldData.extractedAt,
          });
        }
      }

      // Check if agent extracted any fields
      const finalFieldsCount = Object.keys(get().extractedFields).length;

      if (finalFieldsCount === 0 && get().status !== 'error') {
        // Agent didn't extract any fields - show clear error
        set({
          status: 'error',
          error: 'Agent did not extract any fields. The document may not contain structured data, or the agent needs different configuration. Try Simple OCR for full text extraction instead.',
          isProcessing: false,
          progress: 100,
          abortController: null,
          activeRunId: null,
        });

        get().addLog({
          type: 'warning',
          message: 'No fields extracted - agent may need different configuration or document may not be suitable for structured extraction',
        });
      }

      // Final completion
      if (get().status !== 'error' && get().status !== 'completed') {
        set({
          status: 'completed',
          currentStep: 'Agent processing completed',
          progress: 100,
          isProcessing: false,
          abortController: null,
          activeRunId: null,
        });
      }

      get().addLog({
        type: 'info',
        message: 'Agent processing completed',
      });

    } catch (error) {
      if (!isCurrentRun()) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Agent processing failed';
      if (abortController.signal.aborted || errorMessage.toLowerCase().includes('abort') || errorMessage.toLowerCase().includes('cancel')) {
        logger.info('Agent processing cancelled');
        return;
      }

      logger.error('Agent processing error:', error);
      set({
        status: 'error',
        currentStep: 'Processing failed',
        error: errorMessage,
        isProcessing: false,
        progress: 100,
        abortController: null,
        activeRunId: null,
      });

      get().addLog({
        type: 'error',
        message: 'Agent processing failed',
        details: { error: errorMessage },
      });
    }
  },

  stopAgent: () => {
    // Abort any pending operations
    const { abortController } = get();

    set({
      isProcessing: false,
      status: 'stopped',
      currentStep: 'Agent stopped by user',
      abortController: null,
      activeRunId: null,
    });
    abortController?.abort();

    get().addLog({
      type: 'warning',
      message: 'Agent stopped by user',
    });
  },

  updateStatus: (status: AgentStatus, step: string) => {
    set({ status, currentStep: step });
  },

  updateProgress: (progress: number) => {
    set({ progress: Math.max(0, Math.min(100, progress)) });
  },

  addLog: (log: Omit<AgentLog, 'id' | 'timestamp'>) => {
    const MAX_LOGS = 100; // Prevent unbounded memory growth

    const newLog: AgentLog = {
      ...log,
      id: generateLogId(),
      timestamp: Date.now(),
    };

    set(state => {
      // Keep only the most recent logs if we exceed the limit
      const updatedLogs = [...state.logs, newLog];
      return {
        logs: updatedLogs.length > MAX_LOGS
          ? updatedLogs.slice(-MAX_LOGS)
          : updatedLogs,
      };
    });
  },

  updateDocumentMemory: (updates: Partial<DocumentMemory>) => {
    set(state => ({
      documentMemory: state.documentMemory ? {
        ...state.documentMemory,
        ...updates,
        lastUpdated: Date.now(),
      } : null,
    }));
  },

  updateField: (key: string, result: FieldResult) => {
    set(state => ({
      extractedFields: {
        ...state.extractedFields,
        [key]: result,
      },
    }));

    get().addLog({
      type: 'info',
      message: `Field extracted: ${key}`,
      details: { key, result },
    });
  },

  recordFunctionCall: (functionCall: Omit<AgentFunctionCall, 'timestamp'>) => {
    const MAX_FUNCTION_CALLS = 200;
    const newFunctionCall: AgentFunctionCall = {
      ...functionCall,
      timestamp: Date.now(),
    };

    set(state => {
      const updated = [...state.functionCalls, newFunctionCall];
      return {
        functionCalls: updated.length > MAX_FUNCTION_CALLS
          ? updated.slice(-MAX_FUNCTION_CALLS)
          : updated,
      };
    });

    get().addLog({
      type: 'function_call',
      message: `Function called: ${functionCall.name}`,
      details: functionCall,
    });
  },

  copyToClipboard: async () => {
    const { extractedFields, copyTimeoutId } = get();

    if (Object.keys(extractedFields).length === 0) {
      return;
    }

    // Clear any existing timeout
    if (copyTimeoutId) {
      clearTimeout(copyTimeoutId);
    }

    // Format extracted fields for clipboard
    const content = Object.entries(extractedFields)
      .map(([key, result]) => `${key}: ${result.value} (confidence: ${result.confidence})`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(content);
      const newTimeoutId = setTimeout(() => {
        set({ isCopied: false, copyTimeoutId: null });
      }, 2000);
      set({ isCopied: true, copyTimeoutId: newTimeoutId });

      get().addLog({
        type: 'info',
        message: 'Content copied to clipboard',
      });
    } catch (err) {
      logger.error('Failed to copy:', err);
      get().addLog({
        type: 'error',
        message: 'Failed to copy content to clipboard',
        details: { error: err },
      });
    }
  },

  reset: () => {
    const { abortController, copyTimeoutId } = get();

    // Clean up timeout
    if (copyTimeoutId) {
      clearTimeout(copyTimeoutId);
    }

    // Abort any pending operations
    if (abortController) {
      abortController.abort();
    }

    set({
      status: 'idle',
      currentStep: '',
      currentIteration: 0,
      documentMemory: null,
      extractedFields: {},
      logs: [],
      progress: 0,
      error: '',
      isProcessing: false,
      config: DEFAULT_CONFIG,
      functionCalls: [],
      isCopied: false,
      copyTimeoutId: null,
      abortController: null,
      activeRunId: null,
    });
  },

  updateConfig: (configUpdates: Partial<AgentConfig>) => {
    set(state => ({
      config: { ...state.config, ...configUpdates },
    }));
  },
}));
