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
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          gemini: ['@google/genai'],
          lucide: ['lucide-react'],
          katex: ['katex'],
          zustand: ['zustand'],
          markdown: ['streamdown'],
        },
      },
    },
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/vite-env.d.ts',
        'src/main.tsx',
        'src/setupTests.ts',
        // Large Agentic OCR UI/state surfaces with limited direct unit coverage.
        // The engine logic (agentGemini.ts / agentTools.ts / agentLoop.ts) has
        // dedicated suites and is intentionally NOT excluded any more.
        'src/pages/AgenticOCR.tsx',
        'src/store/useAgenticOcrStore.ts',
        'src/lib/templates/index.ts',
        // Thin live network probe wired to the Settings "Test API key" button —
        // excluded because it is a direct SDK round-trip, not because it is test-only.
        'src/utils/testGemini.ts',
      ],
      thresholds: {
        // Aligned with the actual covered surface (engine files are no longer
        // excluded). Ratchet upward as more runtime/network-adjacent code is tested.
        branches: 60,
        functions: 76,
        lines: 73,
        statements: 72,
      },
    },
  },
});
