#!/usr/bin/env node

import process from 'node:process';

import { cliExitCode, isBrokenPipeError, renderCliError } from './errors';
import { main, PRIMARY_CLI_NAME } from './main';

// Writable streams emit EPIPE asynchronously; it does not reject `main()`.
// Scope the clean exit to stdout itself so an unrelated provider or filesystem
// EPIPE still reaches the ordinary typed-error path.
process.stdout.on('error', (error: Error) => {
  if (isBrokenPipeError(error)) process.exit(0);
  throw error;
});

main().catch((error: unknown) => {
  process.stderr.write(renderCliError(error, PRIMARY_CLI_NAME));
  if (process.env.OPEN_OCR_DEBUG === '1' && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = cliExitCode(error);
});
