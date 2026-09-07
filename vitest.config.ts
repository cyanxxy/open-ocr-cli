import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/{engine,cli}/src/**/*.{test,spec}.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['packages/{engine,cli}/src/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', 'packages/engine/src/templates/index.ts'],
      thresholds: { branches: 61, functions: 75, lines: 73, statements: 72 },
    },
  },
});
