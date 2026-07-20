export type CliExitCode = 1 | 2 | 130 | 143;
export type CliInterruptSignal = 'SIGINT' | 'SIGTERM';

export const OCR_ERROR_CODES = [
  'INPUT_NOT_FOUND',
  'INPUT_INVALID',
  'CONFIG_INVALID',
  'AUTH_MISSING',
  'AUTH_INVALID',
  'PERMISSION_DENIED',
  'SCHEMA_INVALID',
  'OUTPUT_CONFLICT',
  'RATE_LIMITED',
  'TIMEOUT',
  'COST_LIMIT',
  'CANCELLED',
  'NOT_RUN',
  'PROVIDER_FAILURE',
  'INTERNAL',
] as const;

export type OcrErrorCode = (typeof OCR_ERROR_CODES)[number];

export type OcrErrorCategory =
  | 'input'
  | 'configuration'
  | 'authentication'
  | 'authorization'
  | 'schema'
  | 'output'
  | 'provider'
  | 'limit'
  | 'cancelled'
  | 'execution'
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

function defaultErrorDetails(exitCode: CliExitCode): OcrErrorDetails {
  if (exitCode === 130 || exitCode === 143) {
    return { code: 'CANCELLED', category: 'cancelled', retryable: true, hint: 'Resume or rerun the interrupted job when ready.' };
  }
  if (exitCode === 1) {
    return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: false };
  }
  return { code: 'CONFIG_INVALID', category: 'configuration', retryable: false, hint: 'Check the request, command flags, and configuration.' };
}

/** Legacy inference for untyped third-party or filesystem errors only. */
function classifyErrorMessage(message: string, exitCode: CliExitCode): OcrErrorDetails | undefined {
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
  return undefined;
}

function recordValue(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function numericStatus(value: unknown): number | undefined {
  for (const key of ['status', 'statusCode']) {
    const status = recordValue(value, key);
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }
  const code = recordValue(value, 'code');
  if (typeof code === 'number' && Number.isInteger(code)) return code;
  if (typeof code === 'string' && /^\d{3}$/.test(code)) return Number(code);
  return undefined;
}

function normalizedErrorCode(value: unknown): string | undefined {
  const code = recordValue(value, 'code');
  return typeof code === 'string' && !/^\d{3}$/u.test(code)
    ? code.trim().toUpperCase()
    : undefined;
}

function invalidCredentialMessage(value: unknown): boolean {
  const messageValue = recordValue(value, 'message');
  const message = (typeof messageValue === 'string' ? messageValue : '').toLowerCase();
  return message.includes('api key not valid')
    || message.includes('api key is invalid')
    || message.includes('invalid api key')
    || message.includes('api_key_invalid');
}

function classifyKnownError(error: unknown, exitCode: CliExitCode): OcrErrorDetails | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 8; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current instanceof CliExitError) {
      return {
        code: current.code,
        category: current.category,
        retryable: current.retryable,
        ...(current.hint ? { hint: current.hint } : {}),
      };
    }
    const name = recordValue(current, 'name');
    const providerError = name === 'ProviderApiError';
    const status = numericStatus(current);
    const structuredCode = normalizedErrorCode(current);
    if (name === 'ProviderCostLimitError') {
      return { code: 'COST_LIMIT', category: 'limit', retryable: false, hint: 'Review partial output or explicitly raise the cost ceiling.' };
    }
    if (name === 'AbortError' || name === 'TimeoutError') {
      return name === 'TimeoutError'
        ? { code: 'TIMEOUT', category: 'limit', retryable: true, hint: 'Retry with a longer timeout or a smaller document.' }
        : { code: 'CANCELLED', category: 'cancelled', retryable: true, hint: 'Resume or rerun the interrupted job when ready.' };
    }
    if (
      current instanceof TypeError
      && /\b(?:fetch|network(?: request)?) failed\b|\bsocket (?:closed|hang up)\b/iu.test(current.message)
    ) {
      return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: true, hint: 'Retry with backoff after the transient network failure.' };
    }
    const ocrType = recordValue(current, 'type');
    if (name === 'OcrError' && ocrType === 'API_KEY_MISSING') {
      return { code: 'AUTH_MISSING', category: 'authentication', retryable: false, hint: 'Configure the named credential environment variable; never pass a raw key as an argument.' };
    }
    if (
      structuredCode === 'API_KEY_INVALID'
      || structuredCode === 'UNAUTHENTICATED'
      || structuredCode === 'INVALID_AUTHENTICATION_ERROR'
      || structuredCode === 'INCORRECT_API_KEY_ERROR'
    ) {
      return { code: 'AUTH_INVALID', category: 'authentication', retryable: false, hint: 'Verify the configured provider credential.' };
    }
    if (structuredCode === 'PERMISSION_DENIED' || structuredCode === 'PERMISSION_DENIED_ERROR') {
      return { code: 'PERMISSION_DENIED', category: 'authorization', retryable: false, hint: 'Verify that the credential and project are allowed to use this model or operation.' };
    }
    if (
      structuredCode === 'RESOURCE_EXHAUSTED'
      || structuredCode === 'RATE_LIMITED'
      || structuredCode === 'RATE_LIMIT_EXCEEDED'
      || structuredCode === 'ENGINE_OVERLOADED_ERROR'
      || structuredCode === 'RATE_LIMIT_REACHED_ERROR'
      || structuredCode === 'PROVIDER_OVERLOADED'
    ) {
      return { code: 'RATE_LIMITED', category: 'provider', retryable: true, hint: 'Retry later or lower request concurrency/rate.' };
    }
    if (structuredCode === 'EXCEEDED_CURRENT_QUOTA_ERROR') {
      return { code: 'RATE_LIMITED', category: 'provider', retryable: false, hint: 'Check the provider account balance and quota before retrying.' };
    }
    if (structuredCode === 'DEADLINE_EXCEEDED' || structuredCode === 'TIMEOUT') {
      return { code: 'TIMEOUT', category: 'limit', retryable: true, hint: 'Retry with a longer timeout or a smaller document.' };
    }
    if (structuredCode === 'CANCELLED') {
      return { code: 'CANCELLED', category: 'cancelled', retryable: true, hint: 'Resume or rerun the interrupted job when ready.' };
    }
    if (
      structuredCode === 'UNAVAILABLE'
      || structuredCode === 'PROVIDER_UNAVAILABLE'
      || structuredCode === 'INTERNAL'
      || structuredCode === 'SERVER_ERROR'
      || structuredCode === 'SERVER'
      || structuredCode === 'SERVER_UNAVAILABLE'
      || structuredCode === 'UNEXPECTED_OUTPUT'
      || structuredCode === 'CLIENT_CLOSED_REQUEST'
      || structuredCode === 'UNMAPPED'
    ) {
      return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: true, hint: 'Retry with backoff; the provider reported a transient server failure.' };
    }
    if (
      structuredCode === 'INVALID_IMAGE'
      || structuredCode === 'IMAGE_TOO_LARGE'
      || structuredCode === 'IMAGE_TOO_SMALL'
      || structuredCode === 'INVALID_IMAGE_FORMAT'
      || structuredCode === 'IMAGE_PARSE_ERROR'
    ) {
      return { code: 'INPUT_INVALID', category: 'input', retryable: false, hint: 'Use a supported image format and size for the selected provider.' };
    }
    if (providerError || status !== undefined) {
      if (status === 400 && invalidCredentialMessage(current)) {
        return { code: 'AUTH_INVALID', category: 'authentication', retryable: false, hint: 'Verify the configured provider credential.' };
      }
      if (status === 401) {
        return { code: 'AUTH_INVALID', category: 'authentication', retryable: false, hint: 'Verify the configured provider credential.' };
      }
      if (status === 403) {
        return { code: 'PERMISSION_DENIED', category: 'authorization', retryable: false, hint: 'Verify that the credential and project are allowed to use this model or operation.' };
      }
      if (status === 408 || status === 504) {
        return { code: 'TIMEOUT', category: 'limit', retryable: true, hint: 'Retry with a longer timeout or a smaller document.' };
      }
      if (status === 429) {
        return { code: 'RATE_LIMITED', category: 'provider', retryable: true, hint: 'Retry later or lower request concurrency/rate.' };
      }
      if (status !== undefined && status >= 500) {
        return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: true, hint: 'Retry with backoff; the provider reported a transient server failure.' };
      }
      if (status === 409) {
        return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: true, hint: 'Retry with backoff after the provider conflict.' };
      }
      if (providerError) return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: false };
    }
    const systemCode = recordValue(current, 'code');
    if (systemCode === 'EEXIST') {
      return { code: 'OUTPUT_CONFLICT', category: 'output', retryable: false, hint: 'Choose a new output path or resume a matching job.' };
    }
    if (systemCode === 'ETIMEDOUT') {
      return { code: 'TIMEOUT', category: 'limit', retryable: true, hint: 'Retry with a longer timeout or a smaller document.' };
    }
    if (systemCode === 'ECONNRESET' || systemCode === 'EAI_AGAIN') {
      return { code: 'PROVIDER_FAILURE', category: 'provider', retryable: true, hint: 'Retry with backoff after the transient network failure.' };
    }
    current = recordValue(current, 'cause');
  }
  if (exitCode === 130 || exitCode === 143) return defaultErrorDetails(exitCode);
  return undefined;
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
    const classified = defaultErrorDetails(exitCode);
    this.code = options.code ?? classified.code;
    this.category = options.category ?? classified.category;
    this.retryable = options.retryable ?? classified.retryable;
    this.hint = options.hint ?? classified.hint;
  }
}

/** Strip credential-like fragments from provider/CLI error text before stdout. */
export function redactSensitiveErrorText(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._+=/-]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}/gu, '[REDACTED_KEY]')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/gu, '[REDACTED_KEY]')
    .replace(
      /\b((?:api[_-]?key|token|authorization))\s*[:=]\s*["']?[^\s"',;]+/giu,
      '$1=[REDACTED]',
    );
}

export function asCliExitError(error: unknown, exitCode: CliExitCode): CliExitError {
  if (error instanceof CliExitError) {
    const redacted = redactSensitiveErrorText(error.message);
    if (redacted === error.message) return error;
    return new CliExitError(redacted, error.exitCode, {
      cause: error,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      hint: error.hint,
    });
  }
  const message = redactSensitiveErrorText(
    error instanceof Error ? error.message : String(error),
  );
  const classified = classifyKnownError(error, exitCode)
    ?? classifyErrorMessage(message, exitCode)
    ?? defaultErrorDetails(exitCode);
  return new CliExitError(
    message,
    exitCode,
    { cause: error, ...classified },
  );
}

export interface CliBatchOutcome {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  costLimitReached: boolean;
}

/** Preserve the public v1 contract: every incomplete execution exits with 1. */
export function cliBatchExitCode(outcome: CliBatchOutcome): 0 | 1 {
  if (outcome.costLimitReached || outcome.partial > 0 || outcome.failed > 0) return 1;
  return 0;
}

export function cliRunStatusExitCode(status: string): 0 | 1 {
  if (status === 'succeeded' || status === 'validated') return 0;
  return 1;
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
