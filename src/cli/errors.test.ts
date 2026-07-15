import { describe, expect, it } from 'vitest';

import { asCliExitError, CliExitError, cliExitCode, cliSignalExitCode } from './errors';

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
});
