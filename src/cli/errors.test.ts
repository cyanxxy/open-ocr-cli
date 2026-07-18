import { describe, expect, it } from 'vitest';

import { asCliExitError, CliExitError, cliExitCode, cliSignalExitCode, ocrErrorPayload } from './errors';

describe('CLI exit errors', () => {
  it('classifies expected runtime failures without changing their message', () => {
    const cause = new Error('Gemini request timed out');
    const error = asCliExitError(cause, 1);
    expect(error).toBeInstanceOf(CliExitError);
    expect(error.message).toBe('Gemini request timed out');
    expect(error.cause).toBe(cause);
    expect(cliExitCode(error)).toBe(1);
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
});
