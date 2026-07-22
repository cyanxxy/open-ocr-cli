#!/usr/bin/env node

import process from 'node:process';

import { cliExitCode, renderCliError } from './errors';
import { cliBinaryName, main } from './main';

main().catch((error: unknown) => {
  process.stderr.write(renderCliError(error, cliBinaryName()));
  if (process.env.GEMINI_OCR_DEBUG === '1' && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = cliExitCode(error);
});
