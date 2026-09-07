import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

interface CliPackageManifest {
  dependencies?: Record<string, string>;
}

const cliPackage = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as CliPackageManifest;

// The publishable package is the source of truth for runtime dependencies.
// The private workspace engine and Gemini SDK are bundled into the executable.
// Other runtime dependencies, including native modules, remain external.
const external = Object.keys(cliPackage.dependencies ?? {}).filter((name) => name !== '@google/genai').sort();

export default defineConfig({
  entry: ['src/index.ts'],
  tsconfig: 'tsconfig.json',
  format: ['esm'],
  platform: 'node',
  // Bundled Google auth code uses CommonJS requires for Node builtins.
  banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" },
  target: 'node20',
  outDir: 'dist',
  clean: true,
  external,
  noExternal: [/^@open-ocr\/engine(?:\/|$)/, /^@google\/genai(?:\/|$)/],
});
