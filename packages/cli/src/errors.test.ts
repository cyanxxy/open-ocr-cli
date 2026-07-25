import { describe, expect, it } from 'vitest';

import { ProviderApiError } from '../../../src/lib/providers';
import {
  asCliExitError,
  CliExitError,
  cliBatchExitCode,
  cliExitCode,
  cliRunStatusExitCode,
  cliSignalExitCode,
  ocrErrorPayload,
  renderCliError,
} from './errors';

describe('CLI exit errors', () => {
  it('classifies expected runtime failures without changing their message', () => {
    const cause = new Error('Gemini request timed out');
    const error = asCliExitError(cause, 1);
    expect(error).toBeInstanceOf(CliExitError);
    expect(error.message).toBe('Gemini request timed out');
    expect(error.cause).toBe(cause);
    expect(cliExitCode(error)).toBe(1);
  });

  it('redacts credential-like fragments in provider error text', () => {
    const error = asCliExitError(
      new Error('Upstream said Authorization: Bearer sk-live-supersecret-token-value'),
      1,
    );
    expect(error.message).not.toContain('sk-live');
    expect(error.message).not.toContain('supersecret');
    expect(error.message).toContain('[REDACTED');
  });

  it('defaults unexpected command failures to exit code 2', () => {
    expect(cliExitCode(new Error('invalid configuration'))).toBe(2);
  });

  it('uses conventional shell exit codes for interrupts', () => {
    expect(cliSignalExitCode('SIGINT')).toBe(130);
    expect(cliSignalExitCode('SIGTERM')).toBe(143);
  });

  it('exposes stable machine error codes, retryability, and remediation hints', () => {
    expect(ocrErrorPayload(new Error('Gemini request timed out'), 1)).toMatchObject({
      code: 'TIMEOUT',
      category: 'limit',
      retryable: true,
    });
    expect(ocrErrorPayload(new Error('Gemini API key is missing'), 2)).toMatchObject({
      code: 'AUTH_MISSING',
      category: 'authentication',
      retryable: false,
    });
    expect(ocrErrorPayload(new TypeError('fetch failed'), 1)).toMatchObject({
      code: 'PROVIDER_FAILURE',
      category: 'provider',
      retryable: true,
    });
  });

  it('renders typed errors and hints for the human command surface', () => {
    const output = renderCliError(new CliExitError('Missing scan', 2, {
      code: 'INPUT_NOT_FOUND',
      category: 'input',
      retryable: false,
      hint: 'Check the input path.',
    }), 'open-ocr-cli');
    expect(output).toBe(
      'open-ocr-cli: [INPUT_NOT_FOUND] Missing scan\n'
      + 'open-ocr-cli: hint: Check the input path.\n',
    );
  });

  it('does not classify configuration or output prose as a custom-schema failure', () => {
    expect(ocrErrorPayload(new Error('--schema cannot be combined with --preset'), 2)).toMatchObject({
      code: 'CONFIG_INVALID',
      category: 'configuration',
    });
    expect(ocrErrorPayload(new Error('Failed to write schema-looking path'), 2)).toMatchObject({
      code: 'CONFIG_INVALID',
      category: 'configuration',
    });
    expect(ocrErrorPayload(new Error('Output already exists: /tmp/schema-results'), 2)).toMatchObject({
      code: 'OUTPUT_CONFLICT',
      category: 'output',
      hint: 'Choose a new output path or resume a matching job.',
    });
  });

  it('prefers typed provider metadata over misleading message text', () => {
    expect(ocrErrorPayload(new ProviderApiError(
      'Upstream mentioned a cost limit while its service was unavailable',
      503,
    ), 1)).toMatchObject({
      code: 'PROVIDER_FAILURE',
      category: 'provider',
      retryable: true,
    });
    expect(ocrErrorPayload(new ProviderApiError('Unauthorized', 401), 1)).toMatchObject({
      code: 'AUTH_INVALID',
      category: 'authentication',
      retryable: false,
    });
    expect(ocrErrorPayload(new ProviderApiError('Forbidden', 403), 1)).toMatchObject({
      code: 'PERMISSION_DENIED',
      category: 'authorization',
      retryable: false,
    });
    expect(ocrErrorPayload(new ProviderApiError('Conflict', 409), 1)).toMatchObject({
      code: 'PROVIDER_FAILURE',
      category: 'provider',
      retryable: true,
    });
  });

  it('classifies current Gemini credential and RPC error shapes without relying on HTTP 401', () => {
    expect(ocrErrorPayload(Object.assign(
      new Error('API key not valid. Please pass a valid API key.'),
      { name: 'ApiError', status: 400 },
    ), 1)).toMatchObject({
      code: 'AUTH_INVALID',
      category: 'authentication',
      retryable: false,
    });
    expect(ocrErrorPayload(Object.assign(
      new Error('quota exhausted'),
      { code: 'RESOURCE_EXHAUSTED' },
    ), 1)).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    expect(ocrErrorPayload(new ProviderApiError(
      'router capacity exhausted',
      undefined,
      'RATE_LIMITED',
    ), 1)).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    expect(ocrErrorPayload(new ProviderApiError(
      'balance depleted',
      429,
      'exceeded_current_quota_error',
    ), 1)).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: false,
      hint: 'Check the provider account balance and quota before retrying.',
    });
    expect(ocrErrorPayload(new ProviderApiError(
      'incorrect key',
      401,
      'incorrect_api_key_error',
    ), 1)).toMatchObject({
      code: 'AUTH_INVALID',
      retryable: false,
    });
    expect(ocrErrorPayload(new ProviderApiError(
      'router capacity exhausted',
      200,
      'provider_overloaded',
    ), 1)).toMatchObject({
      code: 'RATE_LIMITED',
      category: 'provider',
      retryable: true,
    });
    expect(ocrErrorPayload(new ProviderApiError(
      'could not decode image',
      200,
      'invalid_image',
    ), 1)).toMatchObject({
      code: 'INPUT_INVALID',
      category: 'input',
      retryable: false,
    });
  });

  it('preserves exit code 1 for every incomplete v1 execution', () => {
    expect(cliBatchExitCode({
      total: 2, succeeded: 0, partial: 0, failed: 2, skipped: 0, costLimitReached: false,
    })).toBe(1);
    expect(cliBatchExitCode({
      total: 100, succeeded: 98, partial: 0, failed: 2, skipped: 0, costLimitReached: false,
    })).toBe(1);
    expect(cliRunStatusExitCode('partial')).toBe(1);
    expect(cliRunStatusExitCode('cost_limited')).toBe(1);
    expect(cliRunStatusExitCode('failed')).toBe(1);
  });

  it('preserves typed details through wrapper error causes', () => {
    const inputFailure = new CliExitError('Invalid PDF structure', 2, {
      code: 'INPUT_INVALID',
      category: 'input',
      retryable: false,
    });
    const wrapped = new Error('Invalid PDF structure', { cause: inputFailure });
    expect(ocrErrorPayload(wrapped, 1)).toMatchObject({
      code: 'INPUT_INVALID',
      category: 'input',
      retryable: false,
    });
  });
});
