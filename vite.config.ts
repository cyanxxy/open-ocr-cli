import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      '@google/genai',
      'zustand',
      'lucide-react',
      'streamdown'
    ],
    esbuildOptions: {
      target: 'esnext',
    },
    exclude: ['fsevents'],
  },
  build: {
    rollupOptions: {
      output: {
        // Only split the large, isolated vendor deps that are clearly worth a
        // separate cacheable chunk. The previous `katex` entry produced a 1-byte
        // JS chunk (katex is only used as a CSS side-effect) and the `lucide`/
        // `zustand` buckets fought Rollup's own tree-shaking — both dropped so
        // Rollup auto-splits the rest by import graph (audit O-01 / O-02).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          gemini: ['@google/genai'],
          markdown: ['streamdown'],
        },
      },
    },
    // Surface bundle-size regressions in CI. The pdfjs worker is emitted as its
    // own asset (loaded lazily) so the warning targets the app/vendor JS chunks
    // (audit O-01).
    chunkSizeWarningLimit: 600,
    // Do not ship source maps with the production bundle (they expose full
    // readable source). Switch to 'hidden' if an error tracker needs them.
    sourcemap: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
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
        'src/vite-env.d.ts',
        'src/main.tsx',
        'src/setupTests.ts',
        // Pure re-export barrel (no executable logic of its own).
        'src/lib/templates/index.ts',
        // Thin live network probe wired to the Settings "Test API key" button —
        // excluded because it is a direct SDK round-trip, not because it is test-only.
        'src/utils/testGemini.ts',
        // The Agentic OCR page/store (AgenticOCR.tsx, useAgenticOcrStore.ts) are
        // NO LONGER excluded — they have dedicated suites and now count toward
        // coverage (audit Q-02).
      ],
      thresholds: {
        // Retuned to the measured covered surface after the Agentic OCR page and
        // store were folded back into coverage (audit Q-02). Measured (2026-06):
        // branches 62.4 / functions 76.2 / lines 74.5 / statements 73.5. A ~1pt
        // buffer below those avoids flaky gate failures; ratchet up as the UI/
        // state layer gets more direct unit coverage (per-feature thresholds TODO).
        branches: 61,
        functions: 75,
        lines: 73,
        statements: 72,
      },
    },
  },
});
