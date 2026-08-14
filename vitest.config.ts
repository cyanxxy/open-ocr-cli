import { defineConfig } from 'vitest/config';

// Test-runner config only. This repo ships a Node engine (src/lib, src/constants),
// a CLI/MCP package (packages/cli) and an evals harness — there is no web app and
// therefore no Vite build, dev server or React plugin here.
export default defineConfig({
  test: {
    globals: true,
    // The engine and the CLI both run in Node; a DOM environment would hide a
    // browser-API dependency instead of failing on it (mirrors the no-DOM
    // tsconfig boundary in tsconfig.src.json / packages/cli/tsconfig.json).
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'packages/cli/src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
    ],
    // Bound runaway tests/hooks and cap parallelism so the default gate always
    // terminates instead of hanging forever on a stuck async test (audit Q-01).
    // Vitest v4 already defaults to the 'forks' pool; `maxWorkers` is the v4
    // replacement for the removed `poolOptions.forks.maxForks`.
    testTimeout: 10000,
    hookTimeout: 10000,
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        // Pure re-export barrels (no executable logic of their own).
        'src/lib/templates/index.ts',
        'src/lib/providers/index.ts',
        'src/lib/gemini/index.ts',
        // Not unit-tested here: the evals harness has its own gate
        // (`npm run evals:validate`) and the build/tooling scripts are covered
        // by the smoke targets.
        'evals/**',
        'scripts/**',
        'packages/cli/dist/**',
        '**/*.config.ts',
      ],
      thresholds: {
        // Measured on the engine + CLI surface after the web app was removed
        // (2026-08): statements 84.8 / branches 75.2 / functions 90.2 / lines 88.1.
        // These are well above the pre-removal numbers, which were dragged down
        // by the React UI. A ~1pt buffer below the measured values avoids flaky
        // gate failures; ratchet up as coverage improves.
        branches: 74,
        functions: 89,
        lines: 87,
        statements: 83,
      },
    },
  },
});
