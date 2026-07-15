export type CliExitCode = 1 | 2 | 130 | 143;
export type CliInterruptSignal = 'SIGINT' | 'SIGTERM';

/** An expected CLI failure with an explicit process exit contract. */
export class CliExitError extends Error {
  constructor(
    message: string,
    readonly exitCode: CliExitCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CliExitError';
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

/** Return the conventional shell exit status for a supported interrupt signal. */
export function cliSignalExitCode(signal: CliInterruptSignal): 130 | 143 {
  return signal === 'SIGINT' ? 130 : 143;
}
