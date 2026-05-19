/**
 * Type definitions for the Gemini OCR system
 * Extracted from the monolithic gemini.ts file for better organization
 */

/**
 * Represents the content extracted from a document, organized into a title and sections.
 */
export interface ExtractedContent {
  /** The main title of the document, if found */
  title?: string;
  /** An array of sections, each containing a heading and content lines */
  sections: {
    /** The heading for this section */
    heading?: string;
    /** An array of strings, where each string is a line of content within the section */
    content: string[];
  }[];
  /** The full content as a single string */
  content?: string;
  /** Extracted headings from the document */
  headings?: string[];
  /** Extracted tables from the document */
  tables?: Array<{
    headers: string[];
    rows: string[][];
    content: string;
  }>;
  /** Extracted code blocks */
  code?: string[];
  /** Extracted lists */
  lists?: Array<{
    type: 'ordered' | 'unordered';
    items: string[];
  }>;
  /** The content formatted as markdown */
  markdown?: string;
}

/**
 * Options to configure extraction behavior
 */
export interface ExtractionOptions {
  /** If true, attempts to output structured data in JSON format */
  structuredOutput?: boolean;
  /** Specifies the predominant handwriting style */
  handwritingStyle?: 'general' | 'cursive' | 'print' | 'mixed';
  /** Controls the output format */
  outputFormat?: 'markdown' | 'json';
  /** If true, enables image detection */
  detectImages?: boolean;
  /** If true, enables math equation detection */
  detectMathEquations?: boolean;
  /** Level of detail for image descriptions */
  imageDetailLevel?: 'minimal' | 'standard' | 'detailed';
  /** Temperature setting for the model */
  temperature?: number;
  /** Maximum number of tokens to generate */
  maxTokens?: number;
  /** Model name to use */
  model?: string;
  /** Abort signal to cancel the request */
  abortSignal?: AbortSignal;
}

/**
 * Instruction for guiding the extraction process
 */
export interface ExtractionInstruction {
  /** Optional title for the instruction set */
  title?: string;
  /** The specific prompt or instruction */
  prompt: string;
}

/**
 * Callbacks for streaming operations
 */
export interface StreamingCallbacks {
  /** Called when streaming starts */
  onStart?: () => void;
  /** Called for each chunk of data */
  onProgress?: (chunk: string) => void;
  /** Called when streaming completes */
  onComplete?: (content: ExtractedContent) => void;
  /** Called if an error occurs */
  onError?: (error: Error) => void;
}

/**
 * Rule for extracting specific fields
 */
export interface ExtractionRule {
  /** Unique identifier for the rule */
  id: string;
  /** Name of the field to extract */
  field: string;
  /** Description or instruction for extraction */
  description: string;
  /** Expected type of the extracted value */
  type: 'text' | 'number' | 'date' | 'list' | 'boolean' | 'currency' | 'email' | 'url' | 'phone';
  /** Whether this field is required */
  required?: boolean;
  /** Pattern to match (regex) */
  pattern?: string;
  /** Example value */
  example?: string;
}

/**
 * Structured extraction presets built on top of OCR rules.
 */
export interface ExtractionPreset {
  /** Stable preset identifier used across UI, evals, and reports. */
  id: string;
  /** Human-readable preset label shown in the UI. */
  label: string;
  /** Short description of the preset's intended use case. */
  description: string;
  /** Extraction rules that should be applied for this preset. */
  rules: ExtractionRule[];
  /** Whether the preset is primarily record-like or table-like. */
  outputShape: 'record' | 'table';
  /** Optional table columns for presets that should emit CSV rows. */
  tableColumns?: string[];
}

/**
 * Single extracted field in a preset result.
 */
export interface PresetExtractedField {
  /** Field type inherited from the preset rule. */
  type: ExtractionRule['type'];
  /** Extracted value or null when the field could not be found. */
  value: string | number | boolean | string[] | null;
  /** Model confidence score between 0 and 1. */
  confidence: number;
  /** Whether the field is required by the preset. */
  required: boolean;
}

/**
 * Normalized structured output returned by preset extraction.
 */
export interface PresetStructuredOutput {
  /** The preset identifier used to extract this result. */
  presetId: string;
  /** The document type interpreted by the model. */
  documentType: string;
  /** Short model-generated summary of the extracted document. */
  summary: string;
  /** Extracted fields keyed by rule id. */
  fields: Record<string, PresetExtractedField>;
  /** Optional tabular rows for CSV export. */
  rows?: Array<Record<string, string>>;
  /** Extraction warnings or caveats. */
  warnings?: string[];
}

/**
 * Final artifact bundle returned by a preset extraction run.
 */
export interface PresetRunResult {
  /** The preset identifier used to produce these artifacts. */
  presetId: string;
  /** Human-readable markdown summary for display and copy actions. */
  markdown: string;
  /** Normalized machine-readable structured output. */
  json: PresetStructuredOutput;
  /** Optional CSV artifact for table-shaped presets. */
  csv?: string;
}

/**
 * Callbacks for template/preset extraction operations.
 */
export interface PresetStreamingCallbacks {
  /** Called for each streamed chunk of model output. */
  onProgress?: (chunk: string) => void;
  /** Called when a preset run completes successfully. */
  onComplete?: (result: PresetRunResult) => void;
  /** Called if the preset extraction fails. */
  onError?: (error: Error) => void;
}

/**
 * Available Gemini preview models
 */
export type GeminiModel =
  | 'gemini-3.1-pro-preview'
  | 'gemini-3-flash-preview'
  | 'gemini-3.5-flash';

/**
 * Thinking levels for Gemini preview models (use the SDK enum or uppercase strings)
 * - MINIMAL: Lightest reasoning (Gemini 3 Flash only)
 * - LOW: Light reasoning, faster response
 * - MEDIUM: Balanced reasoning
 * - HIGH: Full reasoning capabilities (default)
 *
 * Note: According to official Gemini API docs:
 * - Gemini 3.1 Pro supports: 'LOW', 'MEDIUM', 'HIGH'
 * - Gemini 3 Flash / Gemini 3.5 Flash support: 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'
 * - Thinking isn't fully disabled for Gemini preview models; MINIMAL is the lightest setting
 */
export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Configuration for thinking mode (Gemini preview models only)
 * Uses `thinkingLevel` to control reasoning depth
 * Note: Thinking isn't fully disabled for Gemini preview models; MINIMAL is the lightest setting
 */
export interface ThinkingConfig {
  /** Thinking level - 'MINIMAL'/'LOW'/'MEDIUM'/'HIGH' (availability depends on model) */
  level: ThinkingLevel;
  /** Whether to include thinking content in the response */
  includeThoughts?: boolean;
}

/**
 * Client configuration for Gemini API calls
 * Used for dependency injection to avoid coupling to global state
 */
export interface GeminiClientConfig {
  /** The Gemini API key */
  apiKey: string;
  /** The model to use */
  model: GeminiModel;
  /** Optional thinking configuration */
  thinkingConfig?: ThinkingConfig;
}

/**
 * Error types for OCR operations
 */
export enum OcrErrorType {
  API_KEY_MISSING = 'API_KEY_MISSING',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_RESPONSE = 'INVALID_RESPONSE'
}

/**
 * Custom error class for OCR operations
 */
export class OcrError extends Error {
  constructor(
    public type: OcrErrorType,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OcrError';
  }
}
