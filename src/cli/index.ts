#!/usr/bin/env node

import process from 'node:process';

import { main } from './main';

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`gemini-ocr: ${message}\n`);
  if (process.env.GEMINI_OCR_DEBUG === '1' && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 2;
});
