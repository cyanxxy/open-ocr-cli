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
    sourcemap: true,
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
        // Exclude Agentic OCR files (complex AI agent system)
        'src/pages/AgenticOCR.tsx',
        'src/store/useAgenticOcrStore.ts',
        'src/lib/agentGemini.ts',
        'src/lib/agentTools.ts',
        'src/lib/templates/index.ts',
        // Exclude utils that are just for testing
        'src/utils/testGemini.ts',
      ],
      thresholds: {
        // Keep thresholds aligned with the currently covered surface area and
        // ratchet them upward as more runtime and network-adjacent code is tested.
        branches: 50,
        functions: 75,
        lines: 59,
        statements: 60,
      },
    },
  },
});
