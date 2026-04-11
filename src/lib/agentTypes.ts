import type { GeminiModel, ThinkingConfig } from './gemini/types';

/**
 * Types and interfaces for the agentic OCR system
 */

// Note: FunctionCallingConfigMode is imported from @google/genai SDK
// Use FunctionCallingConfigMode.AUTO, FunctionCallingConfigMode.ANY, FunctionCallingConfigMode.NONE

/**
 * Represents a function call made by the agent
 */
export interface AgentFunctionCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Represents the result of a function call
 */
export interface AgentMemoryUpdate {
  extractedFields?: Record<string, AgentMemory['extractedFields'][string]>;
  documentAnalysis?: Partial<AgentMemory['documentAnalysis']>;
  confidence?: number;
  lastUpdated?: number;
  processingHistoryItem?: AgentStep;
}

export interface AgentFunctionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  memoryUpdate?: AgentMemoryUpdate;
}

export interface NormalizedRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  units: 'normalized';
}

/**
 * Represents a step in the agent's reasoning process
 */
export interface AgentStep {
  type: 'thinking' | 'function_call' | 'result' | 'error';
  content: string;
  functionCall?: AgentFunctionCall;
  functionResult?: AgentFunctionResult;
  timestamp: number;
}

/**
 * Runtime Gemini client configuration required by the agent.
 * This keeps the core agent loop independent from the UI settings store.
 */
export interface AgentClientConfig {
  apiKey: string;
  model: GeminiModel;
  thinkingConfig?: ThinkingConfig;
  abortSignal?: AbortSignal;
}

/**
 * Represents the agent's response to a prompt
 */
export interface AgentResponse {
  content: string;
  functionCalls?: AgentFunctionCall[];
  steps: AgentStep[];
  finished: boolean;
}

/**
 * Configuration for the agent's behavior (used by agent loop)
 */
export interface AgentLoopConfig {
  maxIterations: number;
  confidenceThreshold: number;
  temperature: number;
  maxTokens: number;
}

/**
 * Represents the agent's memory/context
 */
export interface AgentMemory {
  sessionId: string;
  documentName: string;
  currentIteration: number;
  extractedFields: Record<string, {
    value: string;
    confidence: number;
    validation_rule?: string;
    location?: NormalizedRegion;
    isValid?: boolean;
    validationMessage?: string;
    extractedAt?: number;
  }>;
  processingHistory: AgentStep[];
  documentAnalysis: {
    pageCount: number;
    documentType: string;
    complexity: 'low' | 'medium' | 'high';
    specialFeatures: string[];
  };
  confidence: number;
  lastUpdated: number;
}

/**
 * Type for progress update callbacks
 */
export type ProgressCallback = (progress: number, message: string) => void;

/**
 * Callback to yield steps from inside executeAgentTurn without async generators
 */
export type StepCallback = (step: AgentStep) => void;

/**
 * Result from a single agent turn (may involve multiple API calls for tool chaining)
 */
export interface AgentTurnResult {
  /** True if the runtime decided the turn has completed extraction */
  finished: boolean;
  /** All steps produced during this turn */
  steps: AgentStep[];
}
