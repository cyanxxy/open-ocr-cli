export type CliExitCode = 1 | 2 | 130 | 143;
export type CliInterruptSignal = 'SIGINT' | 'SIGTERM';

export const OCR_ERROR_CODES = [
  'INPUT_NOT_FOUND',
  'INPUT_INVALID',
  'CONFIG_INVALID',
  'AUTH_MISSING',
  'SCHEMA_INVALID',
  'OUTPUT_CONFLICT',
  'RATE_LIMITED',
  'TIMEOUT',
  'COST_LIMIT',
  'CANCELLED',
  'PROVIDER_FAILURE',
  'INTERNAL',
] as const;

export type OcrErrorCode = (typeof OCR_ERROR_CODES)[number];

export type OcrErrorCategory =
  | 'input'
  | 'configuration'
  | 'authentication'
  | 'schema'
  | 'output'
  | 'provider'
  | 'limit'
  | 'cancelled'
  | 'internal';

export interface OcrErrorDetails {
  code: OcrErrorCode;
  category: OcrErrorCategory;
  retryable: boolean;
  hint?: string;
}

export interface OcrErrorPayload extends OcrErrorDetails {
  message: string;
}

interface CliExitErrorOptions extends ErrorOptions, Partial<OcrErrorDetails> {}

function classifyError(message: string, exitCode: CliExitCode): OcrErrorDetails {
  const normalized = message.toLowerCase();
  if (normalized.includes('input does not exist')) {
    return { code: 'INPUT_NOT_FOUND', category: 'input', retryable: false, hint: 'Check the input path and working directory.' };
  }
  if (
    normalized.includes('unsupported document')
    || normalized.includes('unsupported mime')
    || normalized.includes('does not match its declared type')
    || normalized.includes('is empty')
    || normalized.includes('no supported documents')
    || normalized.includes('exceeding --max-files')
    || normalized.includes('exceeding --max-total-mb')
    || (normalized.includes('page') && normalized.includes('maximum'))
  ) {
    return { code: 'INPUT_INVALID', category: 'input', retryable: false, hint: 'Use a supported, non-empty image or PDF within the documented limits.' };
  }
  if (normalized.includes('api key is missing') || (normalized.includes('requires') && normalized.includes('gateway authentication'))) {
    return { code: 'AUTH_MISSING', category: 'authentication', retryable: false, hint: 'Configure the named credential environment variable; never pass a raw key as an argument.' };
  }
  if (
    normalized.startsWith('invalid json schema')
    || normalized.startsWith('invalid json in schema')
    || normalized.startsWith('custom schema')
    || normalized.startsWith('schema path is not a file')
    || normalized.startsWith('schema exceeds')
    || normalized.startsWith('schema nesting exceeds')
    || normalized.startsWith('schema output validation failed')
    || normalized.includes('json schema keyword')
    || normalized.includes('"$ref" must reference this schema document')
  ) {
    return { code: 'SCHEMA_INVALID', category: 'schema', retryable: false, hint: 'Validate the JSON Schema against the supported structured-output subset.' };
  }
  if (normalized.includes('output already exists') || normalized.includes('output path collision') || normalized.includes('batch output directory is already in use')) {
    return { code: 'OUTPUT_CONFLICT', category: 'output', retryable: false, hint: 'Choose a new output path or resume a matching job.' };
  }
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return { code: 'TIMEOUT', category: 'limit', retryable: true, hint: 'Retry with a longer timeout or a smaller document.' };
  }
  if (normalized.includes('cost') && normalized.includes('limit')) {
    return { code: 'COST_LIMIT', category: 'limit', retryable: false, hint: 'Review partial output or explicitly raise the cost ceiling.' };
  }
  if (normalized.includes('rate limit') || normalized.includes('429')) {
    return { code: 'RATE_LIMITED', category: 'provider', retryable: true, hint: 'Retry later or lower request concurrency/rate.' };
  }
  if (normalized.includes('interrupted') || normalized.includes('cancelled') || exitCode === 130 || exitCode === 143) {
    return { code: 'CANCELLED', category: 'cancelled', retryable: true, hint: 'Resume or rerun the interrupted job when ready.' };
  }
  if (exitCode === 1) {
    return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: false };
  }
  if (exitCode === 2) {
    return { code: 'CONFIG_INVALID', category: 'configuration', retryable: false, hint: 'Check the request, command flags, and configuration.' };
  }
  return { code: 'INTERNAL', category: 'internal', retryable: false };
}

/** An expected CLI failure with an explicit process exit contract. */
export class CliExitError extends Error {
  readonly code: OcrErrorCode;
  readonly category: OcrErrorCategory;
  readonly retryable: boolean;
  readonly hint?: string;

  constructor(
    message: string,
    readonly exitCode: CliExitCode,
    options: CliExitErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'CliExitError';
    const classified = classifyError(message, exitCode);
    this.code = options.code ?? classified.code;
    this.category = options.category ?? classified.category;
    this.retryable = options.retryable ?? classified.retryable;
    this.hint = options.hint ?? classified.hint;
  }
}

export function asCliExitError(error: unknown, exitCode: CliExitCode): CliExitError {
  if (error instanceof CliExitError) return error;
  return new CliExitError(
    error instanceof Error ? error.message : String(error),
    exitCode,
    { cause: error },
  );
}

export function cliExitCode(error: unknown): CliExitCode {
  return error instanceof CliExitError ? error.exitCode : 2;
}

export function ocrErrorPayload(error: unknown, fallbackExitCode: CliExitCode = 2): OcrErrorPayload {
  const typed = asCliExitError(error, fallbackExitCode);
  return {
    code: typed.code,
    category: typed.category,
    message: typed.message,
    retryable: typed.retryable,
    ...(typed.hint ? { hint: typed.hint } : {}),
  };
}

/** Return the conventional shell exit status for a supported interrupt signal. */
export function cliSignalExitCode(signal: CliInterruptSignal): 130 | 143 {
  return signal === 'SIGINT' ? 130 : 143;
}
